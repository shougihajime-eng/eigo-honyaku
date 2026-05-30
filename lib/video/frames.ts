/**
 * 動画から指定時刻の静止画（フレーム）を1枚抜き出す。
 *
 * 盤面を翻訳AI（vision）に見せて「ここ」「この歩」のような曖昧な指示語を
 * 正確な指し手に直すために使う。トークン節約のため幅を縮めて JPEG で返す。
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { findBinary } from "./binaries";

const execFileP = promisify(execFile);

/**
 * videoPath の atSec 秒地点のフレームを1枚抜き出し、JPEG の Buffer を返す。
 * 失敗時は null（盤面ヒントは無くても翻訳は続行できる）。
 */
export async function extractFrame(
  videoPath: string,
  atSec: number,
  width = 640
): Promise<Buffer | null> {
  const ffmpeg = findBinary("ffmpeg");
  const tmp = path.join(os.tmpdir(), `eigo-frame-${randomUUID()}.jpg`);
  const ss = Math.max(0, atSec).toFixed(2);
  try {
    await execFileP(
      ffmpeg,
      [
        "-y",
        "-ss",
        ss,
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:-1`,
        "-q:v",
        "4",
        tmp,
      ],
      { maxBuffer: 1024 * 1024 * 20 }
    );
    const buf = await fs.readFile(tmp);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
