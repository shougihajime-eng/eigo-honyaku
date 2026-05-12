import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { jobDir } from "@/lib/video/jobs";

export const runtime = "nodejs";

type Kind = "srt" | "mp4" | "source";

const KIND_MAP: Record<
  Kind,
  { filename: string; contentType: string; downloadName: string; inline: boolean }
> = {
  srt: {
    filename: "english.srt",
    contentType: "text/plain; charset=utf-8",
    downloadName: "english-subtitles.srt",
    inline: false,
  },
  mp4: {
    filename: "output.mp4",
    contentType: "video/mp4",
    downloadName: "video-with-english-subs.mp4",
    inline: false,
  },
  source: {
    filename: "video.mp4",
    contentType: "video/mp4",
    downloadName: "source.mp4",
    inline: true, // プレビュー再生用にインライン
  },
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");
    const kind = searchParams.get("kind") as Kind | null;
    if (!jobId) return NextResponse.json({ error: "jobId が必要です" }, { status: 400 });
    if (!kind || !KIND_MAP[kind]) {
      return NextResponse.json({ error: "kind は srt / mp4 / source" }, { status: 400 });
    }

    const conf = KIND_MAP[kind];
    const dir = jobDir(jobId);
    const filePath = path.join(dir, conf.filename);
    const stat = await fs.stat(filePath);
    const total = stat.size;

    const disposition = conf.inline
      ? "inline"
      : `attachment; filename="${conf.downloadName}"`;

    const range = req.headers.get("range");
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
        if (start <= end && start < total) {
          const stream = createReadStream(filePath, { start, end });
          const webStream = nodeStreamToWebStream(stream);
          return new NextResponse(webStream, {
            status: 206,
            headers: {
              "Content-Type": conf.contentType,
              "Content-Disposition": disposition,
              "Content-Length": String(end - start + 1),
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Accept-Ranges": "bytes",
              "Cache-Control": "private, no-cache",
            },
          });
        }
      }
    }

    // 全体配信
    const stream = createReadStream(filePath);
    const webStream = nodeStreamToWebStream(stream);
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": conf.contentType,
        "Content-Disposition": disposition,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function nodeStreamToWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer | string) => {
        const buf =
          typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
        controller.enqueue(new Uint8Array(buf));
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      (nodeStream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
    },
  });
}
