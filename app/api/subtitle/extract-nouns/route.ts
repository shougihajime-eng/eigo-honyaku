import { NextRequest, NextResponse } from "next/server";
import { extractNouns } from "@/lib/video/nouns";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * /subtitle 用：書き起こしセグメントを直接受け取り（ファイルシステム不使用）、
 * 固有名詞を抽出して返す。Vercel Serverless でも動く。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      segments?: Array<{ jp: string }>;
    };
    if (!Array.isArray(body.segments)) {
      return NextResponse.json(
        { error: "segments 配列が必要です" },
        { status: 400 }
      );
    }
    const jpText = body.segments
      .map((s) => s.jp ?? "")
      .filter((s) => s.trim().length > 0)
      .join("\n");
    const nouns = await extractNouns(jpText);
    return NextResponse.json({ nouns });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `固有名詞の抽出に失敗: ${msg}` },
      { status: 500 }
    );
  }
}
