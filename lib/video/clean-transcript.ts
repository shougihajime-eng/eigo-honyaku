/**
 * 書き起こしのAI清書（翻訳前のクリーニング）
 *
 * 音声認識（Google Speech）の生テキストには、聞き間違い・誤変換・
 * おかしな区切り・句読点抜けが混じる。翻訳の前にこれを文脈で直すことで、
 * 後段の翻訳・校閲・逆翻訳すべての精度が底上げされる（誤訳を元から断つ）。
 *
 * 重要な制約：
 * - セグメントの数・index・タイムコードは変えない（1対1で清書する）
 * - 意味は変えない。あくまで「聞き間違いの修正・読みやすい日本語化」
 * - 自信が無いセグメントは原文のまま返す（勝手な創作はしない）
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  buildTranslationHints,
  type ShogiTerm,
} from "@/lib/shogi-dictionary";
import { fetchUserDictionary } from "@/lib/dictionary/user-store";

const MODEL = "claude-sonnet-4-6";
const PARALLEL_LIMIT = 4;
const BATCH_SIZE = 15;

export type CleanSegment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
};

const CLEAN_SYSTEM = `あなたは将棋YouTube動画の書き起こし校正者です。音声認識（自動文字起こし）が出した日本語の生テキストを、翻訳にかける前にきれいに整えます。

【あなたの仕事】
- 音声認識の聞き間違い・誤変換を、将棋の文脈から判断して直す
  例：「角買わり」→「角換わり」、「四間美濃」→「四間飛車」など、明らかな誤認識のみ
- 句読点を補い、読みやすい自然な日本語にする
- 不自然にくっついた／切れた語をなめらかにする（ただし文の意味は変えない）

【絶対に守るルール】
- セグメントの index は絶対に変えない。入力に来た index すべてに対して、必ず1つ清書文を返す
- 意味を足したり削ったりしない。要約しない。説明を加えない
- 確信が持てない箇所は、無理に直さず原文のまま残す（創作・推測での書き換えは禁止）
- 棋士名・固有名詞は、提示された辞書に一致するものだけ正す。辞書に無い名前は原文のまま
- フィラー（えー・あの等）はここでは消さない。あくまで誤認識の修正と読みやすさだけ

【出力】
- 必ず指定の JSON のみ。前置き・コメント・コードフェンス禁止`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) || 1 },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

function extractJson<T>(text: string): T | null {
  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function cleanBatch(
  batch: CleanSegment[],
  extraTerms: ShogiTerm[]
): Promise<Map<number, string>> {
  const anthropic = getAnthropic();
  const hints = buildTranslationHints(
    batch.map((b) => b.jp).join("\n"),
    extraTerms
  );

  const userContent = `次の将棋動画の書き起こし（音声認識の生テキスト・日本語）を清書してください。
各行を読み、聞き間違いと句読点を直して、読みやすい自然な日本語にしてください。意味は変えないこと。

入力（JSON 配列）:
${JSON.stringify(
  batch.map((b) => ({ index: b.index, jp: b.jp })),
  null,
  2
)}

出力フォーマット（厳守・no preamble, JSON only）:
{"cleaned":[{"index":0,"jp":"清書した日本語"},{"index":1,"jp":"..."}]}${hints.hintBlock}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: CLEAN_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  const parsed = extractJson<{ cleaned: { index: number; jp: string }[] }>(text);

  const map = new Map<number, string>();
  for (const c of parsed?.cleaned ?? []) {
    if (typeof c.index === "number" && typeof c.jp === "string" && c.jp.trim()) {
      map.set(c.index, c.jp.trim());
    }
  }
  return map;
}

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  return new Anthropic({ apiKey });
}

/**
 * 書き起こしセグメントをAIで清書する。
 * - index・タイムコードは保持し、jp だけ差し替える
 * - 失敗した／返ってこなかったセグメントは原文のまま（安全側）
 * - ANTHROPIC_API_KEY が無ければ何もせず原文を返す
 */
export async function cleanTranscript(
  segments: CleanSegment[]
): Promise<CleanSegment[]> {
  if (segments.length === 0) return segments;
  if (!process.env.ANTHROPIC_API_KEY) return segments;

  let extraTerms: ShogiTerm[] = [];
  try {
    extraTerms = await fetchUserDictionary();
  } catch {
    extraTerms = [];
  }

  const batches = chunk(segments, BATCH_SIZE);
  const maps = await runWithConcurrency(batches, PARALLEL_LIMIT, (batch) =>
    cleanBatch(batch, extraTerms)
  );

  const merged = new Map<number, string>();
  for (const m of maps) for (const [k, v] of m) merged.set(k, v);

  return segments.map((s) => {
    const fixed = merged.get(s.index);
    return fixed ? { ...s, jp: fixed } : s;
  });
}
