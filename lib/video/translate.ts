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
import { detectCountdownSegments } from "./countdown";

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
};

type InputSegment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
};

const MODEL = "claude-sonnet-4-6";

function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  return new Anthropic({ apiKey });
}

const TRANSLATE_SYSTEM = `あなたは将棋界専門の英語字幕翻訳者です。これは一般翻訳ではなく「将棋YouTube動画の海外向けローカライズ」です。

【最重要】
- 棋士名を絶対に間違えない。漢字を勝手に変えない。推測でローマ字変換しない
- 不明な人名・固有名詞は無理に英訳せず、原文（漢字）のまま残すか、確信のあるローマ字だけ使う
- 将棋用語は与えられた辞書を厳守。辞書にない用語は無理に意訳しない
- 段位・称号（七段、名人、王座 等）は省略せず維持する（例：「藤井七段」→ "Fujii 7-dan"、「藤井名人」→ "Fujii Meijin"）
- 日本将棋連盟の公式英語表記を優先する
- 自然な英語よりも「正確性」を優先する

【禁止】
- 名前の勝手な漢字変換・読み変換
- 意味を変える意訳
- AIっぽい大げさな表現・装飾
- 存在しない英単語の創作
- 不明点を推測で埋めること

【字幕としての品質】
- 1行で読み切れる長さに整える（半角40文字目安、長くても50文字以内）
- 砕けすぎず、固すぎず、視聴者に語りかける自然な口調
- 句読点や区切りで読むテンポを作る

【出力】
- 必ず指定された JSON 形式のみ。前置き・解説を一切付けない
- 確信が持てない人名・固有名詞があれば、その index の en を空文字列にして翻訳を保留してよい（後で人間が確認する）`;

const REVIEW_SYSTEM = `あなたは将棋界専門の英語字幕の校閲者です。日本語原文と英訳のペアを見て、誤訳・不適切な箇所を指摘します。

【警告を出すべきケース】
- 棋士名の表記揺れ・誤変換（例：「鈴木肇」が "Suzuki Hajimu" になっているなど）
- 段位・称号の脱落や誤訳
- 将棋用語の誤訳（辞書と違う訳語）
- 意味が原文と変わっている意訳
- AIっぽい大げさな表現・装飾
- 存在しない英単語

【スルーしてよいケース】
- 軽微な言い回しの揺れ
- 自然な英語にするための語順の入れ替え

【出力】
- 問題なしのときは "ok"
- 警告は短い日本語で具体的に（例："『鈴木肇』は Hajime Suzuki が正"）
- 出力は必ず指定された JSON 形式のみ`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function translateBatch(
  batch: InputSegment[],
  extraTerms: ShogiTerm[]
): Promise<{ index: number; en: string }[]> {
  const anthropic = getAnthropic();
  const allHints = buildTranslationHints(
    batch.map((b) => b.jp).join("\n"),
    extraTerms
  );

  const userContent = `次の日本語セリフを英訳してください。各セリフを1行ずつ、JSONで返してください。

入力（JSON 配列）:
${JSON.stringify(
  batch.map((b) => ({ index: b.index, jp: b.jp })),
  null,
  2
)}

出力フォーマット（厳守）:
{"translations":[{"index":0,"en":"..."},{"index":1,"en":"..."}]}${allHints.hintBlock}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
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

async function reviewBatch(
  pairs: { index: number; jp: string; en: string }[]
): Promise<{ index: number; verdict: "ok" | "warn"; note?: string }[]> {
  const anthropic = getAnthropic();

  const userContent = `次の日本語→英訳ペアを校閲してください。

入力（JSON 配列）:
${JSON.stringify(pairs, null, 2)}

出力フォーマット（厳守）:
{"reviews":[{"index":0,"verdict":"ok"},{"index":1,"verdict":"warn","note":"短い指摘文"}]}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
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
  extraTerms: ShogiTerm[] = []
): Promise<TranslatedSegment[]> {
  // 1. 秒読みカウントダウンを先に検出
  const countdownMap = detectCountdownSegments(segments);

  const out: TranslatedSegment[] = segments.map((s) => {
    const cd = countdownMap.get(s.index);
    if (cd != null) {
      // 秒読みは翻訳せず、数字をそのままテキストにする
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

  // 2. 通常セグメントだけを翻訳対象にする
  const translatable = segments.filter((s) => !countdownMap.has(s.index));

  // 翻訳（10セグメントずつバッチ）
  for (const batch of chunk(translatable, 10)) {
    const result = await translateBatch(batch, extraTerms);
    for (const r of result) {
      const target = out.find((s) => s.index === r.index);
      if (target) target.en = r.en;
    }
  }

  // 二重チェック（秒読み以外）
  const reviewable = out.filter((s) => s.kind !== "countdown");
  for (const batch of chunk(reviewable, 10)) {
    const pairs = batch.map((s) => ({ index: s.index, jp: s.jp, en: s.en }));
    const reviews = await reviewBatch(pairs);
    for (const r of reviews) {
      if (r.verdict === "warn") {
        const target = out.find((s) => s.index === r.index);
        if (target) target.warning = r.note ?? "要確認";
      }
    }
  }

  return out;
}
