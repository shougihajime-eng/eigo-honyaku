/**
 * セグメント単位の翻訳（Claude Sonnet 4.6）+ 別プロンプトでの二重チェック
 * - 一度に複数セグメントを JSON でまとめて翻訳（コスト・速度を抑える）
 * - 翻訳結果を再度 Sonnet に渡し、誤訳・違和感を検出させる
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  buildTranslationHints,
  buildReverseTranslationHints,
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
  // 盤面フレームから得た指し手の手がかり（任意）。
  // 「ここ」「この歩」のような曖昧な指示語を正確な指し手に直すために使う。
  boardHint?: string;
};

/** 翻訳の向き。ja2en=日本語→英語（既定） / en2ja=英語→日本語 */
export type Direction = "ja2en" | "en2ja";

const MODEL = "claude-sonnet-4-6";

// 視聴者が無理なく読める速さ（文字／秒）。これを基準に各行の文字予算を決める。
// 英語（半角）はプロ字幕で 15〜17 字/秒が快適、20 超で読みづらい。
// 日本語（全角）は情報密度が高く、約 7 字/秒・1行20字前後が読みやすい目安。
const READ_BUDGET: Record<
  Direction,
  { perSec: number; min: number; max: number }
> = {
  ja2en: { perSec: 15, min: 14, max: 50 },
  en2ja: { perSec: 7, min: 8, max: 22 },
};

/** 表示秒数から「読めるテンポに収まる文字数」を求める（向きで基準を変える） */
function charBudgetFor(durationSec: number, direction: Direction): number {
  const b = READ_BUDGET[direction];
  const raw = Math.floor(Math.max(0, durationSec) * b.perSec);
  return Math.min(b.max, Math.max(b.min, raw));
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

// ─────────────────────────────────────────────────────────────
// 英語 → 日本語（en2ja）用のプロンプト群
// 英語の将棋動画を、日本の視聴者がYouTubeで一目で読める自然な日本語字幕にする。
// ─────────────────────────────────────────────────────────────
const TRANSLATE_SYSTEM_EN2JA = `あなたは将棋YouTube動画の日本語字幕をつくるプロの字幕翻訳者です。
視聴者は日本の将棋ファンで、画面に出る字幕として読みます。教科書調ではなく、自然な話し言葉のテンポで訳してください。

# 最優先：自然な日本語
- 日本語ネイティブの解説者が実際に話すような、自然で読みやすい日本語にする。
- 翻訳調・直訳調は禁止。次のような不自然さを避ける：
  · 「それは〜である」「〜することができる」の多用
  · 主語「私は」「彼は」「それは」を英語のように毎回つける（日本語では省くのが自然）
  · 不要なカタカナ語の乱用（自然な日本語があるならそちらを使う）
  · 「〜という事実」「〜なのです」の機械的な繰り返し
- 隣り合う行が同じ言い回しで始まらないよう、文の形に変化をつける。
- 解説の温度感を保つ：盛り上がっている所は熱く、落ち着いた分析は落ち着いて。

# 正確さの絶対ルール（自然さより優先）
- 棋士名・人名は推測でいじらない。確信が持てない英語名・ローマ字名は、無理に漢字化せず原文（英語表記）のまま残す。
- 段位・称号は省略しない（"7-dan" → 「七段」、"Meijin" → 「名人」、"Ryuo" → 「竜王」 など、対応が明確なものは日本語の称号にする）。
- 将棋用語は日本将棋連盟の定訳どおりの日本語に戻す（提供された対訳ヒントは必ず守る）。
- 確信のない将棋用語は創作せず、カタカナ表記か原語のまま残す。
- 原文にない情報を足さない。ジョークや文脈を「説明」しない。

# プロの字幕として圧縮する（重要）
- 字幕は逐語訳ではなく「意味を、画面に出る時間で読める長さ」にまとめたもの。
- 各行に "secondsOnScreen" と "maxChars"（その行の文字数上限）が付く。maxChars を絶対に超えない。日本語は1秒に約7文字しか読めない。詰め込んで一瞬で消える字幕は最悪。
- 話者が冗長・繰り返し・言い直しをしたら、要点に圧縮する。指し手・名前・評価・感情は残し、重複や埋め草は削る。
- いちばん短く自然な言い回しを選ぶ：「勝勢です」＞「彼は勝っている局面にあるように見えます」。
- 圧縮しても、人名・段位・称号・将棋用語は必ず残す。先に削るのは埋め草。

# 言い淀み・フィラーを落とす
- "um", "uh", "you know", "like", "I mean", "well" のような英語のフィラーは訳さず捨てる。
- 言い直し・自己訂正は最終的に言いたかった一文にまとめる。
- 意味のある語は残す。本当に意味のないフィラーだけ削る。

# 決定論
- 同じ英語入力には毎回同じ日本語を返す。
- 同じ動画内で用語の訳語を揺らさない（辞書の訳語に固定）。

# 出力
- 指定された JSON のみを返す。前置き・コメント・マークダウン禁止。
- 人名・固有名詞に確信が持てない場合は、その index の "en"（日本語訳の格納先）を空文字にする。人間が確認する。`;

const REVIEW_SYSTEM_EN2JA = `あなたは将棋界専門の日本語字幕の校閲者です。英語の原文と日本語訳のペアを見て、誤訳・不適切な箇所を指摘します。

【警告を出すべきケース】
- 棋士名・人名の取り違え、勝手な漢字化（確信なく "Suzuki" を別人の漢字にする等）
- 段位・称号の脱落や誤訳
- 将棋用語の誤訳（定訳と違う訳語、創作カタカナ語）
- 意味が原文と変わっている意訳・情報の欠落
- 翻訳調・機械翻訳っぽい不自然な日本語：
  · 「それは〜である」「〜することができる」の連発
  · 主語「私は/彼は/それは」を英語のように毎回つけている
  · 不要なカタカナ語の乱用
  · 同じ語で連続して始まる隣接行

【スルーしてよいケース】
- 軽微な言い回しの揺れ
- 自然な日本語にするための主語省略・語順の入れ替え
- 直訳ではない自然な意訳（情報が抜け落ちていなければ OK）

【出力】
- 問題なしのときは "ok"
- 警告は短い日本語で具体的に（例："『Meijin』は名人が正"、"翻訳調: 主語の付けすぎ"）
- 出力は必ず指定された JSON 形式のみ`;

const BACK_TRANSLATE_SYSTEM_EN2JA = `あなたは将棋界専門の翻訳検証者です。日本語訳を英語に戻し、元の英語原文と意味が一致しているかを確認します。

【目的】
日本語訳を英語に逆翻訳し、元の英語と比べて、意味のズレや情報の脱落を見つけます。
逆翻訳はあくまで「日本語訳が原文の意味を保っているかの検証」が目的です。

【判定基準】
- "ok": 意味は概ね一致。表現の揺れは許容
- "warn": 重要情報の欠落／意味の変化／棋士名・段位・戦法名の取り違え

【出力】
- 必ず指定 JSON 形式
- note は短い日本語で「何がズレているか」
- back は逆翻訳した英語（できるだけ自然に）`;

function translateSystem(direction: Direction): string {
  return direction === "en2ja" ? TRANSLATE_SYSTEM_EN2JA : TRANSLATE_SYSTEM;
}
function reviewSystem(direction: Direction): string {
  return direction === "en2ja" ? REVIEW_SYSTEM_EN2JA : REVIEW_SYSTEM;
}
function backTranslateSystem(direction: Direction): string {
  return direction === "en2ja" ? BACK_TRANSLATE_SYSTEM_EN2JA : BACK_TRANSLATE_SYSTEM;
}

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
  briefing: VideoBriefing | null,
  direction: Direction,
  contextBefore: string[] = [],
  contextAfter: string[] = []
): Promise<{ index: number; en: string }[]> {
  const anthropic = getAnthropic();
  const joined = batch.map((b) => b.jp).join("\n");
  const allHints =
    direction === "en2ja"
      ? buildReverseTranslationHints(joined, extraTerms)
      : buildTranslationHints(joined, extraTerms);
  const briefingBlock = buildBriefingBlock(briefing);

  // 前後の行を「文脈」として渡す（同じ動画の続きなので話のつながりが切れないように）。
  // これらは訳して出力させない＝あくまで流れを掴むための参考。
  const contextBlock =
    contextBefore.length === 0 && contextAfter.length === 0
      ? ""
      : `\n\nContext from the same video (FOR FLOW ONLY — do NOT translate or output these lines):\n${
          contextBefore.length ? `Just before:\n${contextBefore.map((t) => `  … ${t}`).join("\n")}\n` : ""
        }${contextAfter.length ? `Just after:\n${contextAfter.map((t) => `  … ${t}`).join("\n")}` : ""}`;

  const inputJson = JSON.stringify(
    batch.map((b) => {
      const row: Record<string, unknown> = {
        index: b.index,
        src: b.jp,
        secondsOnScreen: Number(Math.max(0, b.endSec - b.startSec).toFixed(1)),
        maxChars: charBudgetFor(b.endSec - b.startSec, direction),
      };
      // 盤面ヒントがあれば添える（曖昧な指示語の解決用）
      if (b.boardHint && b.boardHint.trim()) row.boardHint = b.boardHint.trim();
      return row;
    }),
    null,
    2
  );

  // 盤面ヒントの使い方を説明（ja2en のみ。en2ja では将棋の盤面語は別扱い）
  const hasBoardHints = batch.some((b) => b.boardHint && b.boardHint.trim());
  const boardHintNote = hasBoardHints
    ? direction === "en2ja"
      ? `\n- "boardHint": その瞬間の盤面から読み取った実際の指し手。「ここ」「この駒」など曖昧な表現は boardHint に従って具体的に訳す。`
      : `\n- "boardHint": the actual move read from the board at that moment. Use it to resolve vague references like "here" / "this pawn" into the concrete move. Trust boardHint over a literal reading when the speaker is pointing at the board.`
    : "";

  const userContent =
    direction === "en2ja"
      ? `次の英語の将棋解説を、日本の視聴者がYouTubeで一目で読める自然な日本語字幕に訳してください。
まず全体を読んで流れを理解し、各行を訳します。同じ動画の連続した場面として扱ってください。${briefingBlock}${contextBlock}

各セグメントの項目：
- "src": 話された英語（フィラーや言い直しを含むことがある。きれいにまとめる）。
- "secondsOnScreen": この字幕が画面に出る秒数。
- "maxChars": その行の文字数の上限。日本語訳は必ず maxChars 以内に収める。意味を圧縮し、絶対に超えない。${boardHintNote}

入力（セグメントの JSON 配列）：
${inputJson}

出力フォーマット（前置き・マークダウン禁止・JSON のみ。"en" に日本語訳を入れる）：
{"translations":[{"index":0,"en":"…"},{"index":1,"en":"…"}]}${allHints.hintBlock}`
      : `Translate the following Japanese shogi commentary lines into natural, native-sounding English subtitles.
Read all lines first to understand the flow, then translate each one. Treat them as consecutive moments in the same video.${briefingBlock}${contextBlock}

Each segment has:
- "src": the spoken Japanese (may include fillers and stammers — clean them up).
- "secondsOnScreen": how long this subtitle is on screen.
- "maxChars": the HARD reading budget. Your English MUST fit within maxChars so a viewer can actually read it in time. Condense the meaning; never exceed it.${boardHintNote}

Input (JSON array of segments):
${inputJson}

Required output format (no preamble, no markdown, JSON only):
{"translations":[{"index":0,"en":"..."},{"index":1,"en":"..."}]}${allHints.hintBlock}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0,
    system: translateSystem(direction),
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
  briefing: VideoBriefing | null,
  direction: Direction
): Promise<{ index: number; back: string; verdict: "ok" | "warn"; note?: string }[]> {
  const anthropic = getAnthropic();
  const briefingBlock = buildBriefingBlock(briefing);
  // pairs: jp=原文（ソース言語） / en=訳文（ターゲット言語）
  const payload = pairs.map((p) => ({ index: p.index, source: p.jp, translation: p.en }));
  const userContent =
    direction === "en2ja"
      ? `各項目は source=英語の原文 / translation=日本語訳です。
translation（日本語訳）を英語に戻し、source（元の英語）と意味が一致しているか判定してください。${briefingBlock}

入力（JSON 配列）:
${JSON.stringify(payload, null, 2)}

出力フォーマット（厳守）:
{"checks":[{"index":0,"back":"逆翻訳した英語","verdict":"ok"},{"index":1,"back":"...","verdict":"warn","note":"段位が抜けている"}]}`
      : `各項目は source=日本語の原文 / translation=英訳です。
translation（英訳）を日本語に戻し、source（元の日本語）と意味が一致しているか判定してください。${briefingBlock}

入力（JSON 配列）:
${JSON.stringify(payload, null, 2)}

出力フォーマット（厳守）:
{"checks":[{"index":0,"back":"逆翻訳した日本語","verdict":"ok"},{"index":1,"back":"...","verdict":"warn","note":"段位が抜けている"}]}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3072,
    temperature: 0,
    system: backTranslateSystem(direction),
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
  briefing: VideoBriefing | null,
  direction: Direction
): Promise<{ index: number; verdict: "ok" | "warn"; note?: string }[]> {
  const anthropic = getAnthropic();
  const briefingBlock = buildBriefingBlock(briefing);
  const payload = pairs.map((p) => ({ index: p.index, source: p.jp, translation: p.en }));

  const userContent =
    direction === "en2ja"
      ? `次の英語→日本語訳ペアを校閲してください（source=英語の原文 / translation=日本語訳）。${briefingBlock}

入力（JSON 配列）:
${JSON.stringify(payload, null, 2)}

出力フォーマット（厳守）:
{"reviews":[{"index":0,"verdict":"ok"},{"index":1,"verdict":"warn","note":"短い指摘文"}]}`
      : `次の日本語→英訳ペアを校閲してください（source=日本語の原文 / translation=英訳）。${briefingBlock}

入力（JSON 配列）:
${JSON.stringify(payload, null, 2)}

出力フォーマット（厳守）:
{"reviews":[{"index":0,"verdict":"ok"},{"index":1,"verdict":"warn","note":"短い指摘文"}]}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    system: reviewSystem(direction),
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

function detectHitTerms(
  src: string,
  direction: Direction
): { jp: string; en: string }[] {
  const hits: { jp: string; en: string }[] = [];
  const seen = new Set<string>();
  if (direction === "en2ja") {
    // ソースは英語。英語の将棋用語を検出する。
    const lower = src.toLowerCase();
    const cand = [...SHOGI_DICTIONARY]
      .map((t) => ({ t, key: t.en.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim() }))
      .filter((c) => c.key.length >= 3)
      .sort((a, b) => b.key.length - a.key.length);
    for (const { t, key } of cand) {
      const lk = key.toLowerCase();
      const re = new RegExp(`\\b${lk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (re.test(lower) && !seen.has(t.en)) {
        hits.push({ jp: t.jp, en: t.en });
        seen.add(t.en);
      }
    }
    return hits;
  }
  const sorted = [...SHOGI_DICTIONARY].sort((a, b) => b.jp.length - a.jp.length);
  for (const t of sorted) {
    if (src.includes(t.jp) && !seen.has(t.jp)) {
      hits.push({ jp: t.jp, en: t.en });
      seen.add(t.jp);
    }
  }
  return hits;
}

export async function translateAndReview(
  segments: InputSegment[],
  extraTerms: ShogiTerm[] = [],
  briefing: VideoBriefing | null = null,
  direction: Direction = "ja2en"
): Promise<TranslatedSegment[]> {
  return translateAndReviewWithProgress(segments, extraTerms, briefing, undefined, direction);
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
  onEvent?: (e: TranslateProgressEvent) => void,
  direction: Direction = "ja2en"
): Promise<TranslatedSegment[]> {
  // 学習済みユーザー辞書をマージ（同じ jp があれば extraTerms（今回確認済み）を優先）
  // 英→日では固有名詞ステップを通らないので extraTerms は空のことが多いが、辞書は活かす。
  const userDict = await fetchUserDictionary();
  const extraJp = new Set(extraTerms.map((t) => t.jp));
  const mergedExtraTerms: ShogiTerm[] = [
    ...extraTerms,
    ...userDict.filter((t) => !extraJp.has(t.jp)),
  ];

  // 1. 秒読みカウントダウンを先に検出（日本語の「いち・に・さん」前提なので ja2en のみ）
  const countdownMap =
    direction === "en2ja"
      ? new Map<number, number>()
      : detectCountdownSegments(segments);

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
      hitTerms: detectHitTerms(s.jp, direction),
      kind: "normal" as const,
    };
  });

  const translatable = segments.filter((s) => !countdownMap.has(s.index));

  // バッチに分けつつ、前後の数行を「文脈」として添える（境目で話のつながりが切れないように）。
  const BATCH_SIZE = 10;
  const CONTEXT_LINES = 2;
  const translateBatches: {
    seg: InputSegment[];
    before: string[];
    after: string[];
  }[] = [];
  for (let i = 0; i < translatable.length; i += BATCH_SIZE) {
    const seg = translatable.slice(i, i + BATCH_SIZE);
    const before = translatable
      .slice(Math.max(0, i - CONTEXT_LINES), i)
      .map((s) => s.jp);
    const after = translatable
      .slice(i + seg.length, i + seg.length + CONTEXT_LINES)
      .map((s) => s.jp);
    translateBatches.push({ seg, before, after });
  }

  // ===== 翻訳フェーズ：並列バッチ実行 =====
  let translateDone = 0;
  onEvent?.({
    type: "phase",
    phase: "translate",
    done: 0,
    total: translateBatches.length,
  });
  await runWithConcurrency(translateBatches, PARALLEL_LIMIT, async ({ seg, before, after }) => {
    const result = await translateBatch(
      seg,
      mergedExtraTerms,
      briefing,
      direction,
      before,
      after
    );
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

  // ===== 名前の表記ブレを動画全体でそろえる（ja2en・正式名がある時だけ）=====
  if (direction === "ja2en") {
    const glossary = [
      ...mergedExtraTerms
        .filter((t) => t.category === "name" && t.en)
        .map((t) => ({ jp: t.jp, en: t.en })),
      ...(briefing?.speakers ?? [])
        .filter((s) => s.en && s.en.trim())
        .map((s) => ({ jp: s.jp, en: s.en as string })),
    ];
    try {
      await enforceNameConsistency(out, glossary);
      onEvent?.({ type: "partial", segments: cloneSegments(out) });
    } catch {
      // 失敗してもそのまま続行
    }
  }

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
      const reviews = await reviewBatch(pairs, briefing, direction);
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
      const checks = await backTranslateBatch(pairs, briefing, direction);
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

  // 再分割は英語の文区切り（. ! ? と小文字つなぎ）前提なので ja2en のみ。
  // 日本語ターゲット（en2ja）はそのまま返す。
  const finalSegments =
    direction === "en2ja" ? out.map((s, i) => ({ ...s, index: i })) : resegmentForReadability(out);

  // ===== 速すぎる字幕を自動でさらに短縮（読めるテンポまで詰める）=====
  try {
    await tightenTooFast(finalSegments, direction);
  } catch {
    // 失敗してもそのまま
  }

  onEvent?.({ type: "done", segments: finalSegments });
  return finalSegments;
}

function cloneSegments(segs: TranslatedSegment[]): TranslatedSegment[] {
  return segs.map((s) => ({ ...s, hitTerms: [...s.hitTerms] }));
}

/** 半角=1・全角=2 で見た目の文字数を数える（読む速さの基準） */
function visibleLength(s: string): number {
  let len = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    len += code <= 0xff ? 1 : 2;
  }
  return len;
}

const NAME_CONSISTENCY_SYSTEM = `You normalize proper-noun spellings in a set of subtitles that all come from ONE video.
You are given a canonical glossary (one name per line as "Japanese = CanonicalEnglish") and a list of subtitle lines.
Your only job: make every person / place / tournament / proper noun match the canonical glossary, and make the SAME name spelled identically across all lines.
- Do NOT rewrite or rephrase the sentence. Only fix the spelling/romanization of proper nouns.
- Keep ranks and titles attached (e.g. "Fujii Meijin", not "Fujii").
- If a line already matches, do not include it.
- Return ONLY JSON, no preamble: {"fixes":[{"index":0,"en":"corrected line"}]}`;

/**
 * 名前の表記ブレを動画全体でそろえる（辞書・登場人物の正式表記に統一）。
 * - ja2en のみ（英語側の人名ローマ字ブレ対策）
 * - 正式名グロッサリが無いときは何もしない（むやみに書き換えない）
 */
async function enforceNameConsistency(
  out: TranslatedSegment[],
  glossary: { jp: string; en: string }[]
): Promise<void> {
  const names = glossary.filter((g) => g.jp?.trim() && g.en?.trim());
  const targets = out.filter((s) => s.kind !== "countdown" && s.en.trim());
  if (names.length === 0 || targets.length === 0) return;

  const glossaryText = names.map((n) => `${n.jp} = ${n.en}`).join("\n");
  const batches = chunk(targets, 20);
  const anthropic = getAnthropic();

  await runWithConcurrency(batches, PARALLEL_LIMIT, async (batch) => {
    const payload = batch.map((s) => ({ index: s.index, en: s.en }));
    const userContent = `Canonical name glossary (Japanese = CanonicalEnglish):
${glossaryText}

Subtitle lines (JSON):
${JSON.stringify(payload, null, 2)}

Fix only proper-noun spellings to match the glossary and to be consistent across lines.
Return ONLY JSON: {"fixes":[{"index":0,"en":"..."}]}`;
    let parsed: { fixes?: { index: number; en: string }[] } | null = null;
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        system: NAME_CONSISTENCY_SYSTEM,
        messages: [{ role: "user", content: userContent }],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");
      parsed = extractJson<{ fixes?: { index: number; en: string }[] }>(text);
    } catch {
      return; // 失敗しても元の訳のまま（安全側）
    }
    for (const f of parsed?.fixes ?? []) {
      if (typeof f.index !== "number" || typeof f.en !== "string" || !f.en.trim()) {
        continue;
      }
      const target = out.find((s) => s.index === f.index);
      if (target) target.en = f.en.trim();
    }
  });
}

const TIGHTEN_SYSTEM_JA2EN = `You shorten English subtitle lines that are too long to read in the time they are on screen.
- Rewrite each line to fit within its "maxChars", keeping the meaning, tone, and ALL names/ranks/shogi terms.
- Natural spoken English, no robotic phrasing. Never drop a player's name or title.
- If a line is already short enough, return it unchanged.
- Return ONLY JSON: {"tightened":[{"index":0,"text":"shorter line"}]}`;

const TIGHTEN_SYSTEM_EN2JA = `あなたは、表示時間に対して長すぎて読めない日本語字幕を短くする校正者です。
- 各行を "maxChars" 以内に収まるよう、意味・トーン・人名/段位/将棋用語をすべて保ったまま短くする。
- 自然な日本語。固有名詞や段位は絶対に落とさない。
- すでに十分短い行はそのまま返す。
- 出力は JSON のみ：{"tightened":[{"index":0,"text":"短くした行"}]}`;

/**
 * 速すぎる字幕（文字数÷表示秒数が大きい）を、意味を保ったまま自動で短縮する。
 * 警告を出すだけでなく実際に読めるテンポまで詰める追撃パス。
 */
async function tightenTooFast(
  out: TranslatedSegment[],
  direction: Direction
): Promise<void> {
  const perSec = READ_BUDGET[direction].perSec;
  const tightenAt = perSec * 1.3; // 余裕を見て、目安の1.3倍を超えたら短縮対象
  const offenders = out.filter((s) => {
    if (s.kind === "countdown" || !s.en.trim()) return false;
    const dur = s.endSec - s.startSec;
    if (dur <= 0) return false;
    return visibleLength(s.en) / dur > tightenAt;
  });
  if (offenders.length === 0) return;

  const batches = chunk(offenders, 15);
  const anthropic = getAnthropic();
  const system = direction === "en2ja" ? TIGHTEN_SYSTEM_EN2JA : TIGHTEN_SYSTEM_JA2EN;

  await runWithConcurrency(batches, PARALLEL_LIMIT, async (batch) => {
    const payload = batch.map((s) => ({
      index: s.index,
      text: s.en,
      maxChars: charBudgetFor(s.endSec - s.startSec, direction),
    }));
    let parsed: { tightened?: { index: number; text: string }[] } | null = null;
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        system,
        messages: [
          {
            role: "user",
            content: `Shorten each line to fit maxChars (keep meaning + all names/terms).
入力（JSON）:
${JSON.stringify(payload, null, 2)}

出力は JSON のみ：{"tightened":[{"index":0,"text":"..."}]}`,
          },
        ],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");
      parsed = extractJson<{ tightened?: { index: number; text: string }[] }>(text);
    } catch {
      return; // 失敗しても元の訳のまま
    }
    for (const t of parsed?.tightened ?? []) {
      if (typeof t.index !== "number" || typeof t.text !== "string" || !t.text.trim()) {
        continue;
      }
      const target = out.find((s) => s.index === t.index);
      // 短くなった時だけ採用（むやみに長くしない）
      if (target && visibleLength(t.text) < visibleLength(target.en)) {
        target.en = t.text.trim();
      }
    }
  });
}
