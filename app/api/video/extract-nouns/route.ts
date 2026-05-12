import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { jobDir } from "@/lib/video/jobs";
import { extractNouns } from "@/lib/video/nouns";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 書き起こし済みのセグメントから、誤訳しやすい固有名詞を抽出する。
 * 翻訳前にユーザーが確認・修正するための一覧を返す。
 */
export async function POST(req: NextRequest) {
  try {
    const { jobId } = (await req.json()) as { jobId?: string };
    if (!jobId)
      return NextResponse.json({ error: "jobId が必要です" }, { status: 400 });
    const dir = jobDir(jobId);
    const raw = await fs.readFile(path.join(dir, "segments.json"), "utf8");
    const segs = JSON.parse(raw) as Array<{ jp: string }>;
    const jpText = segs.map((s) => s.jp).join("\n");
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
