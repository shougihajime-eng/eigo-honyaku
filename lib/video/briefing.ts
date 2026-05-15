/**
 * 動画ぜんたいの下調べ（briefing）
 *
 * 書き起こし全文から、動画の主題・登場人物・戦法・棋戦・トーン・要約・
 * 翻訳時の注意キーワードを構造化して抽出する。
 *
 * これを各セグメント翻訳のコンテキストとして毎回注入することで、
 * 「文脈に合った訳」「ブレない訳」「世界一の自然さ」を実現する。
 */
import Anthropic from "@anthropic-ai/sdk";

export type BriefingSpeaker = {
  jp: string;
  role: string;
  en?: string;
};

export type VideoBriefing = {
  topic: string;
  speakers: BriefingSpeaker[];
  openings: string[];
  tournament: string;
  tone: string;
  summary: string;
  keyTerms: string[];
};

export const EMPTY_BRIEFING: VideoBriefing = {
  topic: "",
  speakers: [],
  openings: [],
  tournament: "",
  tone: "casual",
  summary: "",
  keyTerms: [],
};

const MODEL = "claude-sonnet-4-6";

const BRIEFING_SYSTEM = `あなたは将棋YouTube動画の翻訳プロデューサーです。書き起こし原稿（日本語）を読み込んで、翻訳チームのために「この動画はどんな動画か」を構造化したブリーフィングを作成します。

【目的】
このブリーフィングは、各セグメントを翻訳するAIが「動画ぜんたいの文脈」を理解した上で訳すために使われます。
正確で簡潔・客観的に。推測で埋めず、自信が無い項目は空のままで構いません。

【出力する項目】
- topic: この動画が「何について」の動画か（1文・25字以内・例：「藤井聡太名人と渡辺九段の竜王戦第3局を解説」）
- speakers: 登場する人物（棋士・解説者・対局者）。各人 jp（日本語）/ role（役割：解説／対局／聞き手 など）/ en（公式英語表記が分かれば。確信なしは空欄）
- openings: 動画で扱われている戦法・囲い・定跡（日本語の正式名称で・最大5個）
- tournament: 棋戦・大会名（無ければ空文字）
- tone: 話し方の全体トーン。次のいずれかから選ぶ：
  · "casual-youtube"  気軽なYouTube解説・友達感
  · "formal-commentary"  プロ解説・落ち着いた口調
  · "educational"  講座・初心者向け
  · "excited"  熱戦・感想戦・実況の盛り上がり
  · "calm-analysis"  静かな研究・読み筋
- summary: 動画の流れを3〜5行で要約（重要展開・狙い・話題の中心）
- keyTerms: この動画で翻訳がブレやすい・誤訳しやすい用語を5〜10個ピックアップ（日本語のまま）

【ルール】
- 推測禁止：書き起こしに無い情報は書かない
- 固有名詞は書き起こしの表記をそのまま使う（勝手にひらく・略す・変えない）
- summary に主観（「面白い」「すごい」など）は入れない
- 出力は必ず JSON のみ。前置き・コメント・コードフェンス禁止`;

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

/**
 * 書き起こしテキストから動画ぜんたいのブリーフィングを生成
 */
export async function generateBriefing(
  jpText: string
): Promise<VideoBriefing> {
  if (!jpText.trim()) return EMPTY_BRIEFING;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  const anthropic = new Anthropic({ apiKey });

  const userContent = `次の将棋YouTube動画の書き起こし（日本語）から、ブリーフィングを作成してください。

書き起こし:
${jpText.slice(0, 16000)}

出力フォーマット（厳守）:
{
  "topic": "...",
  "speakers": [{"jp":"鈴木肇","role":"解説","en":"Hajime Suzuki"}],
  "openings": ["四間飛車", "穴熊"],
  "tournament": "竜王戦" ,
  "tone": "casual-youtube",
  "summary": "...",
  "keyTerms": ["腰掛け銀","角換わり","..."]
}`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0,
    system: BRIEFING_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const parsed = extractJson<Partial<VideoBriefing>>(text);
  if (!parsed) return EMPTY_BRIEFING;

  return {
    topic: typeof parsed.topic === "string" ? parsed.topic : "",
    speakers: Array.isArray(parsed.speakers)
      ? parsed.speakers
          .filter(
            (s): s is BriefingSpeaker =>
              !!s && typeof s.jp === "string" && typeof s.role === "string"
          )
          .map((s) => ({
            jp: s.jp,
            role: s.role,
            en: typeof s.en === "string" ? s.en : "",
          }))
      : [],
    openings: Array.isArray(parsed.openings)
      ? parsed.openings.filter((s): s is string => typeof s === "string")
      : [],
    tournament: typeof parsed.tournament === "string" ? parsed.tournament : "",
    tone:
      typeof parsed.tone === "string" && parsed.tone.length > 0
        ? parsed.tone
        : "casual-youtube",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    keyTerms: Array.isArray(parsed.keyTerms)
      ? parsed.keyTerms.filter((s): s is string => typeof s === "string")
      : [],
  };
}

/**
 * 翻訳プロンプトに注入するための「ブリーフィング ブロック」を整形
 * 各セグメント翻訳のユーザーメッセージ先頭に貼り付ける
 */
export function buildBriefingBlock(briefing: VideoBriefing | null): string {
  if (!briefing) return "";
  const hasContent =
    briefing.topic ||
    briefing.summary ||
    briefing.speakers.length > 0 ||
    briefing.openings.length > 0 ||
    briefing.tournament ||
    briefing.keyTerms.length > 0;
  if (!hasContent) return "";

  const lines: string[] = [
    "# Video-wide context (read first, then translate each line in this context)",
  ];
  if (briefing.topic) lines.push(`- Topic: ${briefing.topic}`);
  if (briefing.summary) lines.push(`- Summary: ${briefing.summary}`);
  if (briefing.tone) lines.push(`- Speaking tone: ${briefing.tone}`);
  if (briefing.tournament) lines.push(`- Tournament: ${briefing.tournament}`);
  if (briefing.openings.length > 0) {
    lines.push(`- Openings discussed: ${briefing.openings.join(", ")}`);
  }
  if (briefing.speakers.length > 0) {
    const speakerLine = briefing.speakers
      .map((s) =>
        s.en ? `${s.jp} (${s.role}) = "${s.en}"` : `${s.jp} (${s.role})`
      )
      .join("; ");
    lines.push(`- Speakers: ${speakerLine}`);
  }
  if (briefing.keyTerms.length > 0) {
    lines.push(
      `- Watch-out terms (use dictionary, never invent): ${briefing.keyTerms.join(", ")}`
    );
  }
  lines.push(
    "- IMPORTANT: every line below comes from this same video. Keep the tone consistent. Use the same English for the same Japanese throughout."
  );
  return "\n\n" + lines.join("\n") + "\n";
}

export function isVideoBriefing(v: unknown): v is VideoBriefing {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.topic === "string" &&
    Array.isArray(b.speakers) &&
    Array.isArray(b.openings) &&
    typeof b.tournament === "string" &&
    typeof b.tone === "string" &&
    typeof b.summary === "string" &&
    Array.isArray(b.keyTerms)
  );
}
