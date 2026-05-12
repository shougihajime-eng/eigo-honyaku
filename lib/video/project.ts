/**
 * 動画字幕プロジェクト（保存・読み込み用）
 *
 * 既存の TelopProject にビデオ復旧用フィールドを足した拡張版。
 * 同じセッション内: jobId が活きていれば動画プレビューもそのまま復旧。
 * 別セッション・別端末: youtubeUrl を使って同じ動画を再取得する流れになる。
 */
import type { TelopProject, TelopSegment, TelopStyle } from "@/lib/telop/types";
import { DEFAULT_STYLE } from "@/lib/telop/defaults";

export type VideoProject = TelopProject & {
  kind: "eigo-honyaku-video-project";
  youtubeUrl?: string;
  jobId?: string;
};

export function makeProject(input: {
  jobId: string | null;
  youtubeUrl: string;
  videoTitle: string;
  durationSec: number;
  style: TelopStyle;
  segments: TelopSegment[];
}): VideoProject {
  return {
    kind: "eigo-honyaku-video-project",
    version: 1,
    createdAt: new Date().toISOString(),
    videoTitle: input.videoTitle,
    durationSec: input.durationSec,
    youtubeUrl: input.youtubeUrl || undefined,
    jobId: input.jobId || undefined,
    style: input.style,
    segments: input.segments,
  };
}

export function isVideoProject(x: unknown): x is VideoProject {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (!Array.isArray(o.segments)) return false;
  if (typeof o.style !== "object" || o.style === null) return false;
  return true;
}

export function safeFilename(title: string | undefined): string {
  const base = (title || "eigo-honyaku-project").replace(/[\\/:*?"<>|]/g, "_");
  return `${base.slice(0, 60)}.eigo-honyaku.json`;
}

export function projectToJsonBlob(p: VideoProject): Blob {
  return new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
}

const DRAFT_KEY = "eigo-honyaku:video-draft:v1";

export type Draft = VideoProject;

export function saveDraft(d: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // 容量超過などは黙って諦める
  }
}

export function loadDraft(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    if (!s) return null;
    const v = JSON.parse(s);
    return isVideoProject(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export function applyProjectDefaults(p: VideoProject): VideoProject {
  return {
    ...p,
    style: { ...DEFAULT_STYLE, ...p.style },
  };
}
