import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { jobDir } from "@/lib/video/jobs";
import { transcribeJapanese } from "@/lib/video/speech";
import { cleanTranscript } from "@/lib/video/clean-transcript";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { jobId } = (await req.json()) as { jobId?: string };
    if (!jobId) return NextResponse.json({ error: "jobId が必要です" }, { status: 400 });
    const dir = jobDir(jobId);
    const audioPath = path.join(dir, "audio.wav");
    const raw = await transcribeJapanese(audioPath);

    // 翻訳前にAIで清書（聞き間違い・句読点・区切りを文脈で修正）。
    // 失敗しても生の書き起こしで続行する（機能を止めない）。
    let segments = raw;
    try {
      segments = await cleanTranscript(raw);
    } catch (e) {
      console.warn("[transcribe] clean skipped:", e);
    }

    // セッション保存
    await fs.writeFile(path.join(dir, "segments.json"), JSON.stringify(segments, null, 2));

    return NextResponse.json({ segments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `書き起こしに失敗: ${msg}` }, { status: 500 });
  }
}
