import { NextRequest, NextResponse } from "next/server";
import { translateAndReview, type Direction } from "@/lib/video/translate";
import type { ShogiTerm } from "@/lib/shogi-dictionary";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 文字起こし結果のセグメント配列を受け取り、Claude Sonnet 4.6 で翻訳 + 二重チェックする。
 * direction（ja2en=日本語→英語 / en2ja=英語→日本語）で向きを切り替える。既定は ja2en。
 * リクエスト/レスポンスは JSON のみ。ファイルシステム不使用なので Vercel Serverless で動く。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      segments?: Array<{
        index: number;
        startSec: number;
        endSec: number;
        jp: string;
      }>;
      extraTerms?: ShogiTerm[];
      direction?: Direction;
    };
    if (!Array.isArray(body.segments)) {
      return NextResponse.json(
        { error: "segments 配列が必要です" },
        { status: 400 }
      );
    }
    const direction: Direction = body.direction === "en2ja" ? "en2ja" : "ja2en";
    const translated = await translateAndReview(
      body.segments,
      body.extraTerms ?? [],
      null,
      direction
    );
    return NextResponse.json({ segments: translated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `翻訳に失敗: ${msg}` }, { status: 500 });
  }
}
