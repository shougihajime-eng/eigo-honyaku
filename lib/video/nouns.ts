/**
 * 翻訳前の固有名詞抽出
 *
 * 書き起こし（日本語テキスト）から、誤訳しやすい固有名詞・専門用語を Claude で抽出する。
 * 抽出結果は辞書（既知）と未知（要確認）に分類してユーザーに提示する。
 *
 * カテゴリ:
 *  - person: 棋士名（最も慎重に扱う）
 *  - opening: 戦法・囲い
 *  - tournament: 棋戦
 *  - title: 段位・称号
 *  - term: その他将棋用語
 */
import Anthropic from "@anthropic-ai/sdk";
import { SHOGI_DICTIONARY } from "@/lib/shogi-dictionary";
import { fetchUserDictionary } from "@/lib/dictionary/user-store";

export type NounCategory = "person" | "opening" | "tournament" | "title" | "term";

export type ExtractedNoun = {
  jp: string;
  category: NounCategory;
  // 既知（辞書ヒット）ならその英訳。AI推測ならそれ。
  // 信頼できる訳が無いなら "" のままにする
  en: string;
  source: "dictionary" | "ai-confident" | "ai-uncertain" | "unknown";
};

const MODEL = "claude-sonnet-4-6";

const EXTRACT_SYSTEM = `あなたは将棋動画の書き起こし原稿から「固有名詞・専門用語」を抽出する編集者です。日本将棋連盟の公式英語表記に準拠してください。

【抽出対象】
- person: 棋士名（例：羽生善治、藤井聡太、鈴木肇）
- opening: 戦法・囲いの名前（例：四間飛車、穴熊、横歩取り）
- tournament: 棋戦・大会名（例：竜王戦、名人戦、王座戦）
- title: 段位・称号（例：七段、名人、王将、女流棋士）
- term: 上記以外で誤訳しやすい将棋用語

【ルール】
- 同じ語は1回だけ。重複禁止
- 一般語（「対局」「将棋」「先手」など）は抽出しない
- 確信が無い人名・固有名詞は en を空文字 "" にする（推測しない）
- 段位は数字＋"-dan"（例：七段 → "7-dan"、女流二段 → "Women's 2-dan"）
- 棋戦名は公式英語名がある場合のみ出す（無ければ空文字）
- 出力は必ず JSON のみ。前置き禁止`;

function builtinDictMatch(jp: string): string | null {
  const t = SHOGI_DICTIONARY.find((d) => d.jp === jp);
  return t ? t.en : null;
}

/**
 * 書き起こしテキストから固有名詞を抽出
 */
export async function extractNouns(jpText: string): Promise<ExtractedNoun[]> {
  if (!jpText.trim()) return [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が設定されていません。");
  const anthropic = new Anthropic({ apiKey });

  const userContent = `次の書き起こし（将棋動画の日本語セリフ）から、固有名詞・専門用語を抽出してください。

書き起こし:
${jpText.slice(0, 12000)}

出力フォーマット（厳守）:
{
  "nouns": [
    {"jp":"鈴木肇","category":"person","en":"Hajime Suzuki","confidence":"high"},
    {"jp":"四間飛車","category":"opening","en":"Fourth File Rook","confidence":"high"},
    {"jp":"竜王戦","category":"tournament","en":"","confidence":"low"}
  ]
}

confidence:
- "high"  自信あり（公式表記として知られている）
- "low"   自信なし（en は空文字 "" にしてユーザー確認に回す）`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const parsed = extractJson<{
    nouns: Array<{
      jp: string;
      category: NounCategory;
      en: string;
      confidence: "high" | "low";
    }>;
  }>(text);
  if (!parsed?.nouns) return [];

  // 学習辞書（Supabase）を取得し、ユーザー指定を最優先で当てる
  const userDict = await fetchUserDictionary();
  const userMap = new Map(userDict.map((d) => [d.jp, d.en]));

  const out: ExtractedNoun[] = [];
  const seen = new Set<string>();
  for (const n of parsed.nouns) {
    if (!n.jp || seen.has(n.jp)) continue;
    seen.add(n.jp);
    const userEn = userMap.get(n.jp);
    const builtinEn = builtinDictMatch(n.jp);
    if (userEn) {
      out.push({
        jp: n.jp,
        category: n.category,
        en: userEn,
        source: "dictionary",
      });
    } else if (builtinEn) {
      out.push({
        jp: n.jp,
        category: n.category,
        en: builtinEn,
        source: "dictionary",
      });
    } else if (n.en && n.confidence === "high") {
      out.push({
        jp: n.jp,
        category: n.category,
        en: n.en,
        source: "ai-confident",
      });
    } else if (n.en) {
      out.push({
        jp: n.jp,
        category: n.category,
        en: n.en,
        source: "ai-uncertain",
      });
    } else {
      out.push({ jp: n.jp, category: n.category, en: "", source: "unknown" });
    }
  }
  return out;
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
