/**
 * ffmpeg で SRT 字幕を MP4 動画に焼き込む
 * テロップスタイル（フォント・色・位置・背景）を ffmpeg subtitles フィルタに反映
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { findBinary } from "./binaries";
import type { TelopStyle } from "@/lib/telop/types";
import { toForceStyle } from "@/lib/telop/ass";
import { DEFAULT_STYLE } from "@/lib/telop/defaults";

const exec = promisify(execFile);

/**
 * ffmpeg の subtitles フィルタは Windows パスの ":" や "\" を含む文字列を
 * そのまま渡すとパース崩れを起こす。
 * 同じ作業フォルダに置いたファイル名（拡張子のみ）で呼ぶことで回避する。
 */
export async function burnSubtitles(
  videoPath: string,
  srtPath: string,
  outputPath: string,
  style: TelopStyle = DEFAULT_STYLE
): Promise<void> {
  const ffmpeg = findBinary("ffmpeg");
  const cwd = path.dirname(videoPath);
  const srtName = path.basename(srtPath);
  const videoName = path.basename(videoPath);
  const outName = path.basename(outputPath);

  const force = toForceStyle(style);

  await exec(
    ffmpeg,
    [
      "-y",
      "-i",
      videoName,
      "-vf",
      `subtitles=${srtName}:force_style='${force}'`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "copy",
      outName,
    ],
    { cwd, maxBuffer: 1024 * 1024 * 20 }
  );
}
