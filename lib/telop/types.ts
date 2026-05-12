/**
 * テロップ（動画に乗せる字幕）の型定義
 * SRT との違い：テロップは「見た目」も含むので、フォント・色・位置を持つ
 */

export type TelopAlignment = "bottom" | "middle" | "top";

export type TelopBackground =
  | { kind: "none" }
  | { kind: "outline"; outlineColor: string; outlineWidth: number }
  | { kind: "bar"; barColor: string; barOpacity: number };

export type TelopStyle = {
  fontSize: number;
  fontColor: string;
  fontWeight: 400 | 600 | 700 | 800;
  fontFamily: string;
  align: TelopAlignment;
  marginPercent: number;
  maxLineChars: number;
  maxLines: number;
  lineHeight: number;
  background: TelopBackground;
};

export type TelopSegment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
  en: string;
  warning?: string;
  hitTerms: { jp: string; en: string }[];
};

export type TelopWarning = {
  index: number;
  kind: "too-long" | "too-short-duration" | "translation-warning";
  message: string;
};

export type TelopProject = {
  version: 1;
  createdAt: string;
  videoTitle?: string;
  durationSec?: number;
  style: TelopStyle;
  segments: TelopSegment[];
};
