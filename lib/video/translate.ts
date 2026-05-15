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

async function translateBatch(
  batch: InputSegment[],
  extraTerms: ShogiTerm[]
): Promise<{ index: number; en: string }[]> {
  const anthropic = getAnthropic();
  const allHints = buildTranslationHints(
    batch.map((b) => b.jp).join("\n"),
    extraTerms
  );

  const userContent = `Translate the following Japanese shogi commentary lines into natural, native-sounding English subtitles.
Read all lines first to understand the flow, then translate each one. Treat them as consecutive moments in the same video.

Input (JSON array of segments):
${JSON.stringify(
  batch.map((b) => ({ index: b.index, jp: b.jp })),
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
  pairs: { index: number; jp: string; en: string }[]
): Promise<{ index: number; back: string; verdict: "ok" | "warn"; note?: string }[]> {
  const anthropic = getAnthropic();
  const userContent = `次の英訳を日本語に戻し、原文と意味が一致しているか判定してください。

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
  extraTerms: ShogiTerm[] = []
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
    const result = await translateBatch(batch, mergedExtraTerms);
    for (const r of result) {
      const target = out.find((s) => s.index === r.index);
      if (target) target.en = r.en;
    }
  }

  // 二重チェック（秒読み以外）
  const reviewable = out.filter((s) => s.kind !== "countdown" && s.en);
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

  // 逆翻訳チェック（英→日に戻して意味乖離を検出）
  for (const batch of chunk(reviewable, 10)) {
    const pairs = batch.map((s) => ({ index: s.index, jp: s.jp, en: s.en }));
    const checks = await backTranslateBatch(pairs);
    for (const c of checks) {
      const target = out.find((s) => s.index === c.index);
      if (!target) continue;
      target.backJp = c.back;
      if (c.verdict === "warn") {
        const note = `逆翻訳ズレ: ${c.note ?? "原文と意味が違う可能性"}`;
        target.warning = target.warning ? `${target.warning} / ${note}` : note;
      }
    }
  }

  // 英語として自然な区切りに整え直す（文頭マージ＋文単位分割）
  return resegmentForReadability(out);
}
