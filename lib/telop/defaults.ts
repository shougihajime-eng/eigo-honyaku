import type { TelopStyle } from "./types";

export const DEFAULT_STYLE: TelopStyle = {
  fontSize: 44,
  fontColor: "#FFFFFF",
  fontWeight: 700,
  fontFamily: '"Inter", "Noto Sans", "Helvetica Neue", Arial, sans-serif',
  align: "bottom",
  marginPercent: 8,
  maxLineChars: 38,
  maxLines: 2,
  lineHeight: 1.18,
  background: { kind: "outline", outlineColor: "#000000", outlineWidth: 4 },
};

export const STYLE_PRESETS: { id: string; label: string; style: TelopStyle }[] = [
  {
    id: "white-outline",
    label: "白文字＋黒フチ（標準）",
    style: { ...DEFAULT_STYLE },
  },
  {
    id: "black-bar",
    label: "黒帯背景＋白文字",
    style: {
      ...DEFAULT_STYLE,
      background: { kind: "bar", barColor: "#000000", barOpacity: 0.7 },
    },
  },
  {
    id: "yellow-outline",
    label: "黄色文字＋黒フチ（強調）",
    style: {
      ...DEFAULT_STYLE,
      fontColor: "#FFE94A",
      background: { kind: "outline", outlineColor: "#000000", outlineWidth: 5 },
    },
  },
  {
    id: "compact-bar",
    label: "黒帯（小さめ・盤を隠さない）",
    style: {
      ...DEFAULT_STYLE,
      fontSize: 36,
      marginPercent: 5,
      background: { kind: "bar", barColor: "#000000", barOpacity: 0.6 },
    },
  },
];
