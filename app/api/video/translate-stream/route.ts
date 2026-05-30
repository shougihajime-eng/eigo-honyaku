import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { jobDir } from "@/lib/video/jobs";
import {
  translateAndReviewWithProgress,
  type TranslateProgressEvent,
} from "@/lib/video/translate";
import { generateBoardHints } from "@/lib/video/board-hints";
import type { ShogiTerm } from "@/lib/shogi-dictionary";
import {
  type VideoBriefing,
  isVideoBriefing,
} from "@/lib/video/briefing";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * ストリーミング翻訳：NDJSON 形式で進捗イベントを逐次返す。
 * 1行 = 1イベント:
 *   {"type":"phase","phase":"translate","done":2,"total":5}
 *   {"type":"partial","segments":[...]}
 *   {"type":"done","segments":[...]}
 *   {"type":"error","message":"..."}
 *
 * 並列バッチ実行で待ち時間は最大 1/4。
 */
export async function POST(req: NextRequest) {
  const { jobId, extraTerms, briefing } = (await req.json()) as {
    jobId?: string;
    extraTerms?: ShogiTerm[];
    briefing?: VideoBriefing;
  };

  if (!jobId) {
    return new Response(
      JSON.stringify({ error: "jobId が必要です" }) + "\n",
      { status: 400, headers: { "Content-Type": "application/x-ndjson" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (e: TranslateProgressEvent | { type: "error"; message: string }) => {
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        const dir = jobDir(jobId);
        const raw = await fs.readFile(
          path.join(dir, "segments.json"),
          "utf8"
        );
        const segs = JSON.parse(raw) as Array<{
          index: number;
          startSec: number;
          endSec: number;
          jp: string;
          boardHint?: string;
        }>;

        // briefing：リクエスト優先、無ければ保存済みを読む
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
            // briefing 無くても続行
          }
        }

        // 盤面ヒント：元動画(video.mp4)があれば、指し手の手がかりを抽出して
        // 各セグメントに添える（「ここ」「この歩」を正確な指し手に直すため）。
        // 失敗・動画なしでも翻訳は続行する。
        const videoPath = path.join(dir, "video.mp4");
        if (existsSync(videoPath)) {
          try {
            const { hints } = await generateBoardHints(videoPath, segs, useBriefing);
            if (hints.size > 0) {
              for (const s of segs) {
                const h = hints.get(s.index);
                if (h) s.boardHint = h;
              }
              // ヒント入りで保存し直す（再実行時に再抽出しないで済む）
              await fs.writeFile(
                path.join(dir, "segments.json"),
                JSON.stringify(segs, null, 2)
              );
            }
          } catch (e) {
            console.warn("[translate-stream] board hints skipped:", e);
          }
        }

        const final = await translateAndReviewWithProgress(
          segs,
          extraTerms ?? [],
          useBriefing,
          (e) => write(e)
        );

        await fs.writeFile(
          path.join(dir, "translated.json"),
          JSON.stringify(final, null, 2)
        );

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        write({ type: "error", message: `翻訳に失敗: ${msg}` });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
