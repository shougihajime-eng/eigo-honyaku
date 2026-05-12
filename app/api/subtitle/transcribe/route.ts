import { NextRequest, NextResponse } from "next/server";
import { transcribeAudioBuffer } from "@/lib/audio/speech-v2";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 音声バイナリ（multipart/form-data の "audio" フィールド）を受け取り、
 * Google Speech-to-Text v2 で日本語に文字起こしする。
 * 結果は { segments: [...] } で返す。
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "audio フィールドにファイルを入れてください" },
        { status: 400 }
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const segments = await transcribeAudioBuffer(buf);

    return NextResponse.json({ segments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `書き起こしに失敗: ${msg}` }, { status: 500 });
  }
}
