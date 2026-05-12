"use client";

/**
 * ブラウザ内で MP4 動画から音声(MP3 mono 16kHz 64kbps)を抽出する。
 * - Vercel Serverless では FFmpeg バイナリが使えないため、すべてブラウザ側で処理する。
 * - 抽出した MP3 をそのまま API へ POST し、Google Speech-to-Text に渡す。
 *
 * 注意: 同期 API の上限が約 10MB のため、
 *       10MB を超える長尺は本MVPでは未対応 (8〜10分以下を推奨)。
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

async function getFFmpeg(onLog?: (line: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on("log", ({ message }) => onLog(message));
    }
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
}

export type ExtractProgress = {
  phase: "loading" | "extracting" | "done";
  ratio?: number;
};

export type ExtractResult = {
  audioBytes: Uint8Array;
  contentType: string;
  filename: string;
};

/**
 * MP4 から MP3 (mono, 16kHz, 64kbps) を抽出する。
 * 結果はそのまま Speech-to-Text の inline content に使える。
 */
export async function extractAudioFromVideo(
  file: File,
  onProgress?: (p: ExtractProgress) => void
): Promise<ExtractResult> {
  onProgress?.({ phase: "loading" });
  const ffmpeg = await getFFmpeg();

  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress({ phase: "extracting", ratio: progress });
    });
  }

  const inputName = "input.mp4";
  const outputName = "output.mp3";

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  // -vn: 映像を捨てる / -ac 1: モノラル / -ar 16000: サンプリング 16kHz
  // -c:a libmp3lame -b:a 64k: MP3 64kbps
  await ffmpeg.exec([
    "-i",
    inputName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    outputName,
  ]);

  const data = (await ffmpeg.readFile(outputName)) as Uint8Array;
  // 後始末
  try {
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
  } catch {
    // ignore
  }

  onProgress?.({ phase: "done" });

  return {
    audioBytes: data,
    contentType: "audio/mpeg",
    filename: "audio.mp3",
  };
}

/**
 * 動画の長さを <video>.duration から取得する
 */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("動画の長さを取得できませんでした"));
    };
  });
}
