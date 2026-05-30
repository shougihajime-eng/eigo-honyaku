import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildTranslationHints,
  buildReverseTranslationHints,
} from "@/lib/shogi-dictionary";

export const runtime = "nodejs";

type Direction = "ja2en" | "en2ja";
type Mode = "literal" | "natural" | "youtube" | "shogi" | "comment";

/** 各方向で使えるモードの一覧（画面側と必ず一致させる） */
const MODES_BY_DIRECTION: Record<Direction, Mode[]> = {
  ja2en: ["natural", "youtube", "shogi", "literal"],
  en2ja: ["natural", "comment", "shogi", "literal"],
};

// ── 日本語 → 英語 ──────────────────────────────────────────────
const JA2EN: Record<string, string> = {
  literal: `あなたは日本語→英語の翻訳者です。
ルール:
- できる限り原文に忠実に直訳すること
- 意訳・装飾・補足を加えない
- 一文一文を素直に英訳する
- 出力は英語の翻訳結果のみ。前置きや解説を一切付けない`,

  natural: `あなたは日本語→英語の翻訳者です。
ルール:
- 海外読者にとって自然で読みやすい英語にする
- 文法的に正しく、不自然な直訳を避ける
- 元の意味は保ちつつ、英語として滑らかに整える
- "Now then,..." "It is..." のような機械翻訳っぽい定型ロボ調は禁止
- 出力は英語の翻訳結果のみ。前置きや解説を一切付けない`,

  youtube: `あなたはYouTube動画タイトルを英訳する専門ライターです。海外視聴者がクリックしたくなる英語タイトルを作ります。
ルール:
- 短く、インパクトのある英語
- 海外視聴者にも内容が一発で伝わる
- 必要なら強調語（INSANE / SHOCKING / The BEST / You Won't Believe など）を控えめに使う
- ただし安っぽい釣りタイトルにはしない
- 将棋専門用語は英語版の正式名（Static Rook など）を使う
- 出力は英語タイトルのみ。前置きや解説を一切付けない
- 候補が複数浮かんだ場合でも、最も良い1つだけを出す`,

  shogi: `あなたは将棋の解説を英訳する専門翻訳者です。
ルール:
- 将棋用語は必ず英語版の正式名（Static Rook, Ranging Rook, Mino Castle など）を使う
- 海外の将棋ファンに通じる英語にする
- 直訳しすぎず、かといって意訳しすぎない
- 段位・称号・棋士名・棋戦名は推測で変えない。確信がなければ原文を残す
- 出力は英語の翻訳結果のみ。前置きや解説を一切付けない`,
};

// ── 英語 → 日本語 ──────────────────────────────────────────────
const EN2JA: Record<string, string> = {
  literal: `あなたは英語→日本語の翻訳者です。
ルール:
- できる限り原文に忠実に直訳すること
- 意訳・装飾・補足を加えない
- 一文一文を素直に日本語にする
- 出力は日本語の翻訳結果のみ。前置きや解説を一切付けない`,

  natural: `あなたは英語→日本語の翻訳者です。
ルール:
- 日本語ネイティブが読んでも自然で読みやすい日本語にする
- 直訳調・翻訳調（「それは〜である」「〜することができる」の多用）を避ける
- 元の意味とニュアンス・温度感を保ちつつ、日本語として滑らかに整える
- 不自然なカタカナ語の乱用は避け、一般的な日本語表現を選ぶ
- 出力は日本語の翻訳結果のみ。前置きや解説を一切付けない`,

  comment: `あなたは将棋YouTubeチャンネルの運営者を助ける翻訳者です。海外視聴者から届いた英語のコメントを、運営者がすぐ意味を把握できる自然な日本語に訳します。
ルール:
- くだけた話し言葉・スラング・絵文字的なノリも、日本語の自然な口語に置き換える（堅い翻訳調にしない）
- 称賛・冗談・皮肉などの感情やトーンを保つ
- 意味が分かりにくい部分は、無理に直訳せず日本語として通じる表現にする
- 将棋の話題なら専門用語は日本語の定訳（穴熊・美濃囲い・手筋 など）を使う
- 出力は日本語の翻訳結果のみ。前置きや解説を一切付けない`,

  shogi: `あなたは将棋の英語解説を日本語に訳す専門翻訳者です。
ルール:
- 将棋用語は必ず日本語の定訳（Anaguma→穴熊, Mino Castle→美濃囲い, Ranging Rook→振り飛車, Tesuji→手筋 など）に戻す
- 日本の将棋ファンが読んで自然な日本語にする
- 直訳しすぎず、かといって意訳しすぎない
- 棋士名・棋戦名・段位は推測で変えない。確信がなければ原文（英語）を残す
- 出力は日本語の翻訳結果のみ。前置きや解説を一切付けない`,
};

const INSTRUCTIONS: Record<Direction, Record<string, string>> = {
  ja2en: JA2EN,
  en2ja: EN2JA,
};

/** 入力の言語をざっくり自動判別（日本語の文字が一定割合あれば日本語とみなす） */
function detectDirection(text: string): Direction {
  const jp = (text.match(/[぀-ヿ㐀-鿿]/g) || []).length;
  const ascii = (text.match(/[A-Za-z]/g) || []).length;
  // 日本語文字が1つでも多めにあれば日本語入力 → 英語へ
  if (jp > 0 && jp >= ascii * 0.15) return "ja2en";
  return "en2ja";
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY が設定されていません。.env.local を確認してください。" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const text: string = (body.text ?? "").toString().trim();
    const mode: Mode = (body.mode ?? "natural") as Mode;
    const rawDirection = (body.direction ?? "auto").toString();
    const direction: Direction =
      rawDirection === "ja2en" || rawDirection === "en2ja"
        ? rawDirection
        : detectDirection(text);

    if (!text) {
      return NextResponse.json({ error: "翻訳する文を入力してください。" }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json({ error: "長すぎます（4000文字まで）。" }, { status: 400 });
    }
    if (!MODES_BY_DIRECTION[direction].includes(mode)) {
      return NextResponse.json({ error: "不明なモードです。" }, { status: 400 });
    }

    // 辞書ヒント（方向に応じて向きを変える）
    const { hintBlock, hints } =
      direction === "ja2en"
        ? buildTranslationHints(text)
        : buildReverseTranslationHints(text);

    const system = INSTRUCTIONS[direction][mode] + hintBlock;

    const anthropic = new Anthropic({ apiKey });
    const completion = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: text }],
    });

    const out = completion.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n")
      .trim();

    return NextResponse.json({
      result: out,
      hints: hints.map((h) => ({ jp: h.jp, en: h.en })),
      mode,
      direction,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `翻訳でエラーが発生しました: ${msg}` }, { status: 500 });
  }
}
