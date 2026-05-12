import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { jobDir } from "@/lib/video/jobs";

export const runtime = "nodejs";
export const maxDuration = 30;

type SegmentInput = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
};

/**
 * ユーザーが「書き起こし確認画面」で編集した日本語テキストを保存する。
 * 翻訳前に書き起こしを正しく直すことで、誤訳の元を断つ。
 */
export async function POST(req: NextRequest) {
  try {
    const { jobId, segments } = (await req.json()) as {
      jobId?: string;
      segments?: SegmentInput[];
    };
    if (!jobId)
      return NextResponse.json({ error: "jobId が必要です" }, { status: 400 });
    if (!Array.isArray(segments))
      return NextResponse.json(
        { error: "segments 配列が必要です" },
        { status: 400 }
      );

    const cleaned: SegmentInput[] = segments.map((s) => ({
      index: s.index,
      startSec: Number(s.startSec) || 0,
      endSec: Number(s.endSec) || 0,
      jp: String(s.jp ?? "").trim(),
    }));

    const dir = jobDir(jobId);
    await fs.writeFile(
      path.join(dir, "segments.json"),
      JSON.stringify(cleaned, null, 2)
    );

    return NextResponse.json({ ok: true, count: cleaned.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `書き起こしの保存に失敗: ${msg}` },
      { status: 500 }
    );
  }
}
