import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { jobDir } from "@/lib/video/jobs";
import { toSrt, SrtSegment } from "@/lib/video/srt";
import { burnSubtitles } from "@/lib/video/burn";
import { isValidTelopStyle } from "@/lib/telop/ass";
import { DEFAULT_STYLE } from "@/lib/telop/defaults";

export const runtime = "nodejs";
// Vercel Hobby プランの上限が 300 秒のため。ローカル ffmpeg 焼き込みは時間がかかるが、
// もともと Vercel ではバイナリ非対応で動かないため Hobby 上限に合わせる（ローカルでは十分）。
export const maxDuration = 300;

type EditedSegment = {
  index: number;
  startSec: number;
  endSec: number;
  en: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      jobId?: string;
      segments?: EditedSegment[];
      style?: unknown;
    };
    const { jobId, segments } = body;
    if (!jobId || !segments) {
      return NextResponse.json({ error: "jobId と segments が必要です" }, { status: 400 });
    }
    const style = isValidTelopStyle(body.style) ? body.style : DEFAULT_STYLE;
    const dir = jobDir(jobId);

    const srtSegs: SrtSegment[] = segments.map((s) => ({
      index: s.index,
      startSec: s.startSec,
      endSec: s.endSec,
      text: s.en,
    }));
    const srt = toSrt(srtSegs);
    await fs.writeFile(path.join(dir, "english.srt"), srt, "utf8");

    const videoPath = path.join(dir, "video.mp4");
    const srtPath = path.join(dir, "english.srt");
    const outPath = path.join(dir, "output.mp4");
    await burnSubtitles(videoPath, srtPath, outPath, style);

    return NextResponse.json({
      ok: true,
      srtUrl: `/api/video/file?jobId=${jobId}&kind=srt`,
      mp4Url: `/api/video/file?jobId=${jobId}&kind=mp4`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `書き出しに失敗: ${msg}` }, { status: 500 });
  }
}
