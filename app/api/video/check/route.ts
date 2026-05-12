import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { TMP_ROOT } from "@/lib/video/jobs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  if (!jobId || !/^[a-f0-9-]{36}$/.test(jobId)) {
    return NextResponse.json({ exists: false, hasVideo: false, hasOutput: false });
  }
  const dir = path.join(TMP_ROOT, jobId);
  try {
    await fs.stat(dir);
  } catch {
    return NextResponse.json({ exists: false, hasVideo: false, hasOutput: false });
  }
  const hasVideo = await exists(path.join(dir, "video.mp4"));
  const hasOutput = await exists(path.join(dir, "output.mp4"));
  return NextResponse.json({ exists: true, hasVideo, hasOutput });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
