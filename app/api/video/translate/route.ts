import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { jobDir } from "@/lib/video/jobs";
import { translateAndReview } from "@/lib/video/translate";
import type { ShogiTerm } from "@/lib/shogi-dictionary";
import {
  type VideoBriefing,
  isVideoBriefing,
} from "@/lib/video/briefing";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { jobId, extraTerms, briefing } = (await req.json()) as {
      jobId?: string;
      // ユーザーが翻訳前画面で確認した固有名詞辞書
      extraTerms?: ShogiTerm[];
      // 動画ぜんたいの下調べ（ユーザーが確認・修正済み）
      briefing?: VideoBriefing;
    };
    if (!jobId)
      return NextResponse.json({ error: "jobId が必要です" }, { status: 400 });
    const dir = jobDir(jobId);
    const raw = await fs.readFile(path.join(dir, "segments.json"), "utf8");
    const segs = JSON.parse(raw) as Array<{
      index: number;
      startSec: number;
      endSec: number;
      jp: string;
    }>;

    // 受け取った briefing を優先。無ければ保存済み briefing.json を読む
    let useBriefing: VideoBriefing | null = null;
    if (briefing && isVideoBriefing(briefing)) {
      useBriefing = briefing;
    } else {
      try {
        const briefRaw = await fs.readFile(
          path.join(dir, "briefing.json"),
          "utf8"
        );
        const parsed = JSON.parse(briefRaw);
        if (isVideoBriefing(parsed)) useBriefing = parsed;
      } catch {
        // 無くてもエラーにしない（briefing 未生成でも翻訳はできる）
      }
    }

    const translated = await translateAndReview(
      segs,
      extraTerms ?? [],
      useBriefing
    );

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
