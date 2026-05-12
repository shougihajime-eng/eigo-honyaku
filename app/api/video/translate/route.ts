import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { jobDir } from "@/lib/video/jobs";
import { translateAndReview } from "@/lib/video/translate";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { jobId } = (await req.json()) as { jobId?: string };
    if (!jobId) return NextResponse.json({ error: "jobId が必要です" }, { status: 400 });
    const dir = jobDir(jobId);
    const raw = await fs.readFile(path.join(dir, "segments.json"), "utf8");
    const segs = JSON.parse(raw) as Array<{
      index: number;
      startSec: number;
      endSec: number;
      jp: string;
    }>;
    const translated = await translateAndReview(segs);

    await fs.writeFile(
      path.join(dir, "translated.json"),
      JSON.stringify(translated, null, 2)
    );

    return NextResponse.json({ segments: translated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `翻訳に失敗: ${msg}` }, { status: 500 });
  }
}
