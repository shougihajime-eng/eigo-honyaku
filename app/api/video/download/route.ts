import { NextRequest, NextResponse } from "next/server";
import { createJobDir } from "@/lib/video/jobs";
import { downloadVideoAndAudio, isValidYouTubeUrl } from "@/lib/video/ytdlp";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url || !isValidYouTubeUrl(url)) {
      return NextResponse.json({ error: "YouTube の URL を入力してください。" }, { status: 400 });
    }

    const { jobId, dir } = createJobDir();
    const result = await downloadVideoAndAudio(url, dir, { maxDurationSec: 30 * 60 });

    return NextResponse.json({
      jobId,
      title: result.title,
      durationSec: result.duration,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `動画の取得に失敗: ${msg}` }, { status: 500 });
  }
}
