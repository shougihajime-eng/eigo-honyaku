import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildTranslationHints } from "@/lib/shogi-dictionary";

export const runtime = "nodejs";

type Mode = "literal" | "natural" | "youtube" | "shogi";

const MODE_INSTRUCTIONS: Record<Mode, string> = {
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
- 出力は英語の翻訳結果のみ。前置きや解説を一切付けない`,
};

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

    if (!text) {
      return NextResponse.json({ error: "翻訳する日本語を入力してください。" }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json({ error: "長すぎます（4000文字まで）。" }, { status: 400 });
    }
    if (!MODE_INSTRUCTIONS[mode]) {
      return NextResponse.json({ error: "不明なモードです。" }, { status: 400 });
    }

    const { hintBlock, hints } = buildTranslationHints(text);
    const system = MODE_INSTRUCTIONS[mode] + hintBlock;

    const anthropic = new Anthropic({ apiKey });
    const completion = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
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
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `翻訳でエラーが発生しました: ${msg}` }, { status: 500 });
  }
}
