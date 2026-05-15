import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { jobDir } from "@/lib/video/jobs";
import { generateBriefing } from "@/lib/video/briefing";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 書き起こし済みのセグメントから動画ぜんたいの下調べ（briefing）を生成。
 * 主題・登場人物・戦法・棋戦・トーン・要約・注意キーワードを返す。
 *
 * - 翻訳前のユーザー確認画面で表示
 * - 各セグメント翻訳のコンテキストとして注入する
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

    const briefing = await generateBriefing(jpText);

    await fs.writeFile(
      path.join(dir, "briefing.json"),
      JSON.stringify(briefing, null, 2)
    );

    return NextResponse.json({ briefing });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: `動画ぜんたいの下調べに失敗: ${msg}` },
      { status: 500 }
    );
  }
}
