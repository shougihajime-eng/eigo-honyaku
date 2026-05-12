import { toSrt, type SrtSegment } from "@/lib/video/srt";
import type { TelopProject, TelopSegment, TelopStyle } from "./types";

export type BuildProjectArgs = {
  videoTitle?: string;
  durationSec?: number;
  style: TelopStyle;
  segments: TelopSegment[];
};

/**
 * テロッププロジェクト JSON を組み立てる
 * 将来 ffmpeg drawtext / ASS で焼き込みに使う中間フォーマット
 */
export function buildTelopProject(args: BuildProjectArgs): TelopProject {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    videoTitle: args.videoTitle,
    durationSec: args.durationSec,
    style: args.style,
    segments: args.segments,
  };
}

/**
 * 日本語SRT を作る
 */
export function buildJapaneseSrt(segments: TelopSegment[]): string {
  const srtSegments: SrtSegment[] = segments.map((s) => ({
    index: s.index,
    startSec: s.startSec,
    endSec: s.endSec,
    text: s.jp,
  }));
  return toSrt(srtSegments);
}

/**
 * 英語SRT を作る
 */
export function buildEnglishSrt(segments: TelopSegment[]): string {
  const srtSegments: SrtSegment[] = segments.map((s) => ({
    index: s.index,
    startSec: s.startSec,
    endSec: s.endSec,
    text: s.en,
  }));
  return toSrt(srtSegments);
}

/**
 * 文字列を Blob にして a タグでダウンロードさせる
 */
export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
