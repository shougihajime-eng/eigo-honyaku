/**
 * 動画字幕ジョブの一時保存ディレクトリ管理
 * 各ジョブは UUID 名のフォルダを持ち、その中に音声・動画・字幕などが置かれる
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const TMP_ROOT = path.join(process.cwd(), "tmp", "video-jobs");

export function ensureRoot() {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
}

export function createJobDir(): { jobId: string; dir: string } {
  ensureRoot();
  const jobId = randomUUID();
  const dir = path.join(TMP_ROOT, jobId);
  mkdirSync(dir, { recursive: true });
  return { jobId, dir };
}

export function jobDir(jobId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) {
    throw new Error("不正なジョブID");
  }
  const dir = path.join(TMP_ROOT, jobId);
  if (!existsSync(dir)) throw new Error("ジョブが見つかりません");
  return dir;
}

export function jobFile(jobId: string, name: string): string {
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("不正なファイル名");
  }
  return path.join(jobDir(jobId), name);
}
