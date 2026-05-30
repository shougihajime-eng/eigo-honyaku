/**
 * セグメント単位の翻訳（Claude Sonnet 4.6）+ 別プロンプトでの二重チェック
 * - 一度に複数セグメントを JSON でまとめて翻訳（コスト・速度を抑える）
 * - 翻訳結果を再度 Sonnet に渡し、誤訳・違和感を検出させる
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  buildTranslationHints,
  SHOGI_DICTIONARY,
  type ShogiTerm,
} from "@/lib/shogi-dictionary";
import { fetchUserDictionary } from "@/lib/dictionary/user-store";
import { detectCountdownSegments } from "./countdown";
import { resegmentForReadability } from "./resegment";
import { buildBriefingBlock, type VideoBriefing } from "./briefing";

export type TranslatedSegment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
  en: string;
  warning?: string;
  hitTerms: { jp: string; en: string }[];
  kind?: "normal" | "countdown";
  countdownValue?: number;
  // 逆翻訳チェック：英訳を日本語に戻したもの。意味乖離検出用
  backJp?: string;
};

type InputSegment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
};

const MODEL = "claude-sonnet-4-6";

// 視聴者が無理なく読める速さ（半角文字／秒）。これを基準に各行の文字予算を決める。
// プロの字幕（Netflix 等）は英語で 15〜17 字/秒が快適、20 超で読みづらい。
const READ_CHARS_PER_SEC = 15;
const MIN_CHAR_BUDGET = 14; // 一瞬の短い行でも最低これだけは許す
const MAX_CHAR_BUDGET = 50; // 1行字幕の上限（quality.ts の HARD_MAX_CHARS と一致）

/** 表示秒数から「読めるテンポに収まる文字数」を求める */
function charBudgetFor(durationSec: number): number {
  const raw = Math.floor(Math.max(0, durationSec) * READ_CHARS_PER_SEC);
  return Math.min(MAX_CHAR_BUDGET, Math.max(MIN_CHAR_BUDGET, raw));
}

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  return new Anthropic({ apiKey });
}

const TRANSLATE_SYSTEM = `You are a professional English subtitle translator for shogi YouTube videos.
Your audience is overseas shogi fans watching on YouTube. The output is on-screen subtitles, so it must read like real spoken English, not like a textbook.

# Top priority: natural native English
- Write the way a native English commentator would actually speak.
- Match the spoken rhythm of YouTube subtitles — short, punchy, conversational.
- Never use stiff, robotic, machine-translation patterns. The following are BANNED:
  · "Now then," / "Well then," at the start of every line
  · "It is ..." / "There is ..." when a verb-led sentence is more natural
  · "I think that ~" / "It seems that ~" as filler
  · Over-formal "Indeed," "Furthermore," "Moreover," in casual narration
  · Literal calques like "the white player" for 後手 when context is clear
- Vary sentence structure. Two adjacent lines should not start with the same word.
- Use contractions ("it's", "we'll", "let's") in casual narration. Drop them in formal commentary.
- Prefer concrete verbs over abstract nouns. "He attacks the king" > "An attack on the king is launched".

# Hard accuracy rules (do not break, even at cost of fluency)
- NEVER guess a person's name. If a name is not in the provided dictionary and you are not 100% sure, output the original Japanese (kanji) instead of inventing a romanization.
- Do NOT silently invent kanji readings. 鈴木肇 = Hajime Suzuki, never "Suzuki Hajimu" or any other variant.
- Keep ranks and titles intact: 七段 → "7-dan", 名人 → "Meijin", 王座 → "Oza", 竜王 → "Ryuo". Do not drop them.
- Use the Japan Shogi Federation (JSF) official English terms for shogi vocabulary. Honor every term in the provided dictionary verbatim.
- For unknown shogi vocabulary, do NOT translate creatively. Romanize or keep the original term.

# Style for subtitles
- One line should be readable at a glance: target ~40 half-width chars, max 50.
- Sentence-level punctuation only. Don't end every line with a period if the sentence continues into the next segment.
- Match the speaker's tone: excited commentary stays excited, calm analysis stays calm.
- Do not add information that isn't in the source. Do not "explain" jokes or context.

# Condense like a pro subtitler (CRITICAL — this is what separates great subs from machine output)
- Subtitles are NOT a word-for-word transcript. They carry the MEANING, short enough to read in the time on screen.
- Each input line includes "secondsOnScreen" and "maxChars" — the hard reading budget for that line. NEVER exceed maxChars. A viewer reads only ~15 English characters per second; a wall of text that flashes by is worse than a short, clear line.
- When the speaker rambles, repeats themselves, or over-explains, compress to the essential point. Keep what matters (moves, names, evaluation, emotion); cut redundancy and padding.
- Prefer the shortest natural phrasing: "He's winning" > "It appears that he is in a winning position".
- Preserve ALL hard-accuracy info while condensing (player names, ranks, titles, shogi terms). Never drop a name or title just to save space — cut filler words first.
- Shorter and clear always beats complete and unreadable.

# Drop fillers and false starts (clean spoken Japanese into clean subtitles)
- Do NOT translate verbal fillers / hesitation sounds. Treat these as noise and remove them: えー, えーっと, ええと, あのー, あの, そのー, まあ, まぁ, なんか (when used as filler), うーん, んー, こう (as filler), はい (as a verbal tic).
- Smooth out stammers and self-corrections into ONE clean sentence. If the speaker restarts ("歩を…いや、角を打ちます"), translate only the final intended version ("He drops the bishop").
- Drop meaningless sentence-end tics (ね, よ, さ, わけです as filler) — render the clean statement instead.
- Keep real content words: only remove genuine filler that adds no meaning. If なんか / まあ / やっぱり actually carries meaning in context, keep it.

# Determinism
- Given the same Japanese input, you must produce the same English output every time.
- Do not flip between "King" and "Gyoku", or between "Bishop" and "Kaku", on the same video. Lock to the dictionary's choice.

# Output
- Return ONLY the requested JSON. No preamble, no comments, no markdown fences.
- If you are NOT confident about a name or proper noun, set that index's "en" to an empty string. A human will review.`;

const BACK_TRANSLATE_SYSTEM = `あなたは将棋界専門の翻訳検証者です。英語字幕を日本語に逆翻訳し、原文と意味が一致しているかを確認します。

【目的】
英→日に戻したテキストを元の日本語と比べて、意味のズレや情報の脱落を見つけます。
逆翻訳はあくまで「英訳が原文の意味を保っているかの検証」が目的です。

【判定基準】
- "ok": 意味は概ね一致。表現の揺れは許容
- "warn": 重要情報の欠落／意味の変化／棋士名・段位・戦法名の取り違え

【出力】
- 必ず指定 JSON 形式
- note は短い日本語で「何がズレているか」
- back は逆翻訳した日本語（できるだけ自然に）`;

const REVIEW_SYSTEM = `あなたは将棋界専門の英語字幕の校閲者です。日本語原文と英訳のペアを見て、誤訳・不適切な箇所を指摘します。

【警告を出すべきケース】
- 棋士名の表記揺れ・誤変換（例：「鈴木肇」が "Suzuki Hajimu" になっているなど）
- 段位・称号の脱落や誤訳
- 将棋用語の誤訳（辞書と違う訳語）
- 意味が原文と変わっている意訳
- AI／機械翻訳っぽい不自然な英語：
  · "Now then," "Well then," から始まる定型ロボ調
  · "It is ..." "There is ..." の連発
  · "I think that" "It seems that" の不要なフィラー
  · "Indeed," "Furthermore," "Moreover," など過剰にフォーマルな副詞
  · 同じ語で連続して始まる隣接行
- 存在しない英単語・カタカナ英語の創作

【スルーしてよいケース】
- 軽微な言い回しの揺れ
- 自然な英語にするための語順の入れ替え・主語省略
- 直訳ではない自然な意訳（情報が抜け落ちていなければ OK）

【出力】
- 問題なしのときは "ok"
- 警告は短い日本語で具体的に（例："『鈴木肇』は Hajime Suzuki が正"、"機械翻訳調: Now then で始まる"）
- 出力は必ず指定された JSON 形式のみ`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * 並列度を絞って Promise を実行（API レート制限対策）
 */
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

const PARALLEL_LIMIT = 4;

export type TranslateProgressEvent =
  | {
      type: "phase";
      phase: "translate" | "review" | "back-translate";
      done: number;
      total: number;
    }
  | { type: "partial"; segments: TranslatedSegment[] }
  | { type: "done"; segments: TranslatedSegment[] }
  | { type: "error"; message: string };

async function translateBatch(
  batch: InputSegment[],
  extraTerms: ShogiTerm[],
  briefing: VideoBriefing | null
): Promise<{ index: number; en: string }[]> {
  const anthropic = getAnthropic();
  const allHints = buildTranslationHints(
    batch.map((b) => b.jp).join("\n"),
    extraTerms
  );
  const briefingBlock = buildBriefingBlock(briefing);

  const userContent = `Translate the following Japanese shogi commentary lines into natural, native-sounding English subtitles.
Read all lines first to understand the flow, then translate each one. Treat them as consecutive moments in the same video.${briefingBlock}

Each segment has:
- "jp": the spoken Japanese (may include fillers and stammers — clean them up).
- "secondsOnScreen": how long this subtitle is on screen.
- "maxChars": the HARD reading budget. Your English MUST fit within maxChars so a viewer can actually read it in time. Condense the meaning; never exceed it.

Input (JSON array of segments):
${JSON.stringify(
  batch.map((b) => ({
    index: b.index,
    jp: b.jp,
    secondsOnScreen: Number(Math.max(0, b.endSec - b.startSec).toFixed(1)),
    maxChars: charBudgetFor(b.endSec - b.startSec),
  })),
  null,
  2
)}

Required output format (no preamble, no markdown, JSON only):
{"translations":[{"index":0,"en":"..."},{"index":1,"en":"..."}]}${allHints.hintBlock}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: TRANSLATE_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  const parsed = extractJson<{ translations: { index: number; en: string }[] }>(text);
  if (!parsed?.translations) throw new Error(`翻訳結果のパースに失敗: ${text.slice(0, 200)}`);
  return parsed.translations;
}

async function backTranslateBatch(
  pairs: { index: number; jp: string; en: string }[],
  briefing: VideoBriefing | null
): Promise<{ index: number; back: string; verdict: "ok" | "warn"; note?: string }[]> {
  const anthropic = getAnthropic();
  const briefingBlock = buildBriefingBlock(briefing);
  const userContent = `次の英訳を日本語に戻し、原文と意味が一致しているか判定してください。${briefingBlock}

入力（JSON 配列）:
${JSON.stringify(pairs, null, 2)}

出力フォーマット（厳守）:
{"checks":[{"index":0,"back":"逆翻訳した日本語","verdict":"ok"},{"index":1,"back":"...","verdict":"warn","note":"段位が抜けている"}]}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3072,
    temperature: 0,
    system: BACK_TRANSLATE_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  const parsed = extractJson<{
    checks: {
      index: number;
      back: string;
      verdict: "ok" | "warn";
      note?: string;
    }[];
  }>(text);
  return parsed?.checks ?? [];
}

async function reviewBatch(
  pairs: { index: number; jp: string; en: string }[],
  briefing: VideoBriefing | null
): Promise<{ index: number; verdict: "ok" | "warn"; note?: string }[]> {
  const anthropic = getAnthropic();
  const briefingBlock = buildBriefingBlock(briefing);

  const userContent = `次の日本語→英訳ペアを校閲してください。${briefingBlock}

入力（JSON 配列）:
${JSON.stringify(pairs, null, 2)}

出力フォーマット（厳守）:
{"reviews":[{"index":0,"verdict":"ok"},{"index":1,"verdict":"warn","note":"短い指摘文"}]}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    system: REVIEW_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  const parsed = extractJson<{
    reviews: { index: number; verdict: "ok" | "warn"; note?: string }[];
  }>(text);
  return parsed?.reviews ?? [];
}

function extractJson<T>(text: string): T | null {
  // モデルがコードフェンス付きで返した場合に剥がす
  const cleaned = text
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 最初の { から最後の } までを切り出して再挑戦
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

function detectHitTerms(jp: string): { jp: string; en: string }[] {
  const sorted = [...SHOGI_DICTIONARY].sort((a, b) => b.jp.length - a.jp.length);
  const hits: { jp: string; en: string }[] = [];
  const seen = new Set<string>();
  for (const t of sorted) {
    if (jp.includes(t.jp) && !seen.has(t.jp)) {
      hits.push({ jp: t.jp, en: t.en });
      seen.add(t.jp);
    }
  }
  return hits;
}

export async function translateAndReview(
  segments: InputSegment[],
  extraTerms: ShogiTerm[] = [],
  briefing: VideoBriefing | null = null
): Promise<TranslatedSegment[]> {
  return translateAndReviewWithProgress(segments, extraTerms, briefing);
}

/**
 * 並列バッチ実行＋途中経過コールバックつきの翻訳パイプライン
 *
 * - 翻訳・レビュー・逆翻訳バッチを最大 PARALLEL_LIMIT 並列で実行
 * - onEvent コールバックがあれば各フェーズの進捗をリアルタイム通知
 * - resegmentation は最後に1回だけ実行
 */
export async function translateAndReviewWithProgress(
  segments: InputSegment[],
  extraTerms: ShogiTerm[] = [],
  briefing: VideoBriefing | null = null,
  onEvent?: (e: TranslateProgressEvent) => void
): Promise<TranslatedSegment[]> {
  // 学習済みユーザー辞書をマージ（同じ jp があれば extraTerms（今回確認済み）を優先）
  const userDict = await fetchUserDictionary();
  const extraJp = new Set(extraTerms.map((t) => t.jp));
  const mergedExtraTerms: ShogiTerm[] = [
    ...extraTerms,
    ...userDict.filter((t) => !extraJp.has(t.jp)),
  ];

  // 1. 秒読みカウントダウンを先に検出
  const countdownMap = detectCountdownSegments(segments);

  const out: TranslatedSegment[] = segments.map((s) => {
    const cd = countdownMap.get(s.index);
    if (cd != null) {
      return {
        index: s.index,
        startSec: s.startSec,
        endSec: s.endSec,
        jp: s.jp,
        en: String(cd),
        hitTerms: [],
        kind: "countdown" as const,
        countdownValue: cd,
      };
    }
    return {
      index: s.index,
      startSec: s.startSec,
      endSec: s.endSec,
      jp: s.jp,
      en: "",
      hitTerms: detectHitTerms(s.jp),
      kind: "normal" as const,
    };
  });

  const translatable = segments.filter((s) => !countdownMap.has(s.index));
  const translateBatches = chunk(translatable, 10);

  // ===== 翻訳フェーズ：並列バッチ実行 =====
  let translateDone = 0;
  onEvent?.({
    type: "phase",
    phase: "translate",
    done: 0,
    total: translateBatches.length,
  });
  await runWithConcurrency(translateBatches, PARALLEL_LIMIT, async (batch) => {
    const result = await translateBatch(batch, mergedExtraTerms, briefing);
    for (const r of result) {
      const target = out.find((s) => s.index === r.index);
      if (target) target.en = r.en;
    }
    translateDone += 1;
    onEvent?.({
      type: "phase",
      phase: "translate",
      done: translateDone,
      total: translateBatches.length,
    });
    // 部分結果も流す（UIですぐ見せられる）
    onEvent?.({ type: "partial", segments: cloneSegments(out) });
  });

  // ===== レビュー & 逆翻訳：並列で同時実行 =====
  const reviewable = out.filter((s) => s.kind !== "countdown" && s.en);
  const checkBatches = chunk(reviewable, 10);

  let reviewDone = 0;
  let backDone = 0;
  onEvent?.({
    type: "phase",
    phase: "review",
    done: 0,
    total: checkBatches.length,
  });
  onEvent?.({
    type: "phase",
    phase: "back-translate",
    done: 0,
    total: checkBatches.length,
  });

  const reviewTask = runWithConcurrency(
    checkBatches,
    PARALLEL_LIMIT,
    async (batch) => {
      const pairs = batch.map((s) => ({
        index: s.index,
        jp: s.jp,
        en: s.en,
      }));
      const reviews = await reviewBatch(pairs, briefing);
      for (const r of reviews) {
        if (r.verdict === "warn") {
          const target = out.find((s) => s.index === r.index);
          if (target) target.warning = r.note ?? "要確認";
        }
      }
      reviewDone += 1;
      onEvent?.({
        type: "phase",
        phase: "review",
        done: reviewDone,
        total: checkBatches.length,
      });
    }
  );

  const backTask = runWithConcurrency(
    checkBatches,
    PARALLEL_LIMIT,
    async (batch) => {
      const pairs = batch.map((s) => ({
        index: s.index,
        jp: s.jp,
        en: s.en,
      }));
      const checks = await backTranslateBatch(pairs, briefing);
      for (const c of checks) {
        const target = out.find((s) => s.index === c.index);
        if (!target) continue;
        target.backJp = c.back;
        if (c.verdict === "warn") {
          const note = `逆翻訳ズレ: ${c.note ?? "原文と意味が違う可能性"}`;
          target.warning = target.warning
            ? `${target.warning} / ${note}`
            : note;
        }
      }
      backDone += 1;
      onEvent?.({
        type: "phase",
        phase: "back-translate",
        done: backDone,
        total: checkBatches.length,
      });
    }
  );

  await Promise.all([reviewTask, backTask]);

  const finalSegments = resegmentForReadability(out);
  onEvent?.({ type: "done", segments: finalSegments });
  return finalSegments;
}

function cloneSegments(segs: TranslatedSegment[]): TranslatedSegment[] {
  return segs.map((s) => ({ ...s, hitTerms: [...s.hitTerms] }));
}
