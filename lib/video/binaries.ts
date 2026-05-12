/**
 * yt-dlp / ffmpeg の実行ファイルを探す
 * PATH に通っていなければ winget の既定インストール先を fallback で見る
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const WINGET_BASE = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "Microsoft",
  "WinGet",
  "Packages"
);

const FALLBACKS = {
  "yt-dlp": [
    path.join(
      WINGET_BASE,
      "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "yt-dlp.exe"
    ),
  ],
  ffmpeg: [
    path.join(
      WINGET_BASE,
      "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "ffmpeg-8.1.1-full_build",
      "bin",
      "ffmpeg.exe"
    ),
  ],
  ffprobe: [
    path.join(
      WINGET_BASE,
      "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
      "ffmpeg-8.1.1-full_build",
      "bin",
      "ffprobe.exe"
    ),
  ],
} as const;

type Tool = keyof typeof FALLBACKS;

const cache: Partial<Record<Tool, string>> = {};

function tryPath(name: Tool): string | null {
  try {
    const cmd = process.platform === "win32" ? `${name}.exe` : name;
    const which = process.platform === "win32" ? "where.exe" : "which";
    const out = execFileSync(which, [cmd], { encoding: "utf8" });
    const first = out.split(/\r?\n/).find((l) => l.trim().length > 0);
    if (first && existsSync(first.trim())) return first.trim();
  } catch {
    // not in PATH
  }
  return null;
}

export function findBinary(name: Tool): string {
  if (cache[name]) return cache[name]!;
  const inPath = tryPath(name);
  if (inPath) {
    cache[name] = inPath;
    return inPath;
  }
  for (const candidate of FALLBACKS[name]) {
    if (existsSync(candidate)) {
      cache[name] = candidate;
      return candidate;
    }
  }
  throw new Error(
    `${name} が見つかりません。PowerShell で 'winget install ${
      name === "yt-dlp" ? "yt-dlp.yt-dlp" : "Gyan.FFmpeg"
    }' を実行してください。`
  );
}
