import { NextRequest, NextResponse } from "next/server";
import { downloadYouTubeAudio, isValidYouTubeUrl } from "@/lib/audio/youtube";
import { transcribeAudioBuffer } from "@/lib/audio/speech-v2";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * YouTube URL を受け取り、サーバーで音声をダウンロードして
 * そのまま Google Speech v2 で日本語に文字起こしする。
 * 返り値の形は /api/subtitle/transcribe と同じ。
 */
export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url?: string };
    if (!url || !isValidYouTubeUrl(url)) {
      return NextResponse.json(
        { error: "YouTube の URL を入力してください" },
        { status: 400 }
      );
    }

    const { audio, title, videoId, durationSec } = await downloadYouTubeAudio(url);

    // Speech v2 同期 API は ~10MB 上限
    if (audio.length > 9 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: `音声が大きすぎます（${Math.round(
            audio.length / 1024 / 1024
          )}MB / 上限約9MB）。短めの動画でお試しください。`,
        },
        { status: 413 }
      );
    }

    const segments = await transcribeAudioBuffer(audio);

    return NextResponse.json({
      segments,
      title,
      videoId,
      durationSec,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `YouTube からの取り込みに失敗: ${msg}` },
      { status: 500 }
    );
  }
}
