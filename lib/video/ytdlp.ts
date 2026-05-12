/**
 * YouTube URL から動画 (mp4) と音声 (wav) を取得する
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { findBinary } from "./binaries";

const exec = promisify(execFile);

export function isValidYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname);
  } catch {
    return false;
  }
}

export async function probeYouTube(url: string): Promise<{
  title: string;
  duration: number;
  uploader?: string;
}> {
  if (!isValidYouTubeUrl(url)) throw new Error("YouTube の URL ではありません");
  const ytdlp = findBinary("yt-dlp");
  const { stdout } = await exec(
    ytdlp,
    ["-J", "--no-warnings", "--skip-download", url],
    { maxBuffer: 1024 * 1024 * 20 }
  );
  const meta = JSON.parse(stdout);
  return {
    title: meta.title ?? "",
    duration: Number(meta.duration ?? 0),
    uploader: meta.uploader,
  };
}

/**
 * 動画と音声を別ファイルで取得
 * - video.mp4 ... 焼き込み元の動画（最大 720p）
 * - audio.wav ... 16kHz mono の WAV（Google Speech 用）
 */
export async function downloadVideoAndAudio(
  url: string,
  jobDir: string,
  opts?: { maxDurationSec?: number }
): Promise<{ videoPath: string; audioPath: string; title: string; duration: number }> {
  const meta = await probeYouTube(url);
  if (opts?.maxDurationSec && meta.duration > opts.maxDurationSec) {
    throw new Error(
      `動画が長すぎます（${Math.round(meta.duration / 60)}分）。${Math.round(
        opts.maxDurationSec / 60
      )}分以内の動画でお試しください。`
    );
  }

  const ytdlp = findBinary("yt-dlp");
  const ffmpeg = findBinary("ffmpeg");
  const videoPath = path.join(jobDir, "video.mp4");
  const audioPath = path.join(jobDir, "audio.wav");

  // 動画ダウンロード（720p まで、mp4 にまとめる）
  await exec(
    ytdlp,
    [
      "-f",
      "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]",
      "--merge-output-format",
      "mp4",
      "--ffmpeg-location",
      path.dirname(ffmpeg),
      "-o",
      videoPath,
      "--no-warnings",
      "--no-playlist",
      url,
    ],
    { maxBuffer: 1024 * 1024 * 20 }
  );

  // 音声を 16kHz mono WAV に抽出
  await exec(
    ffmpeg,
    [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      audioPath,
    ],
    { maxBuffer: 1024 * 1024 * 20 }
  );

  return {
    videoPath,
    audioPath,
    title: meta.title,
    duration: meta.duration,
  };
}
