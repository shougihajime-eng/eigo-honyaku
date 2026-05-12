import type { TelopStyle } from "./types";

// ====================================================================
// 【永続ルール／CLAUDE.md と連動】
//   1. 黒帯に収まる場合は黒帯へ → DEFAULT は bar(黒・75%)
//   2. 黒帯が無い場合は画面下部へ → align="bottom" + marginPercent 6
//   3. 中央配置は禁止 → align は "bottom" 既定。"middle" を既定値にしない
//   4. 見やすさ最優先 → 太字・大きめ・濃いめ帯で最大コントラスト
//   この既定値はチャンネル統一感と最高の視認性のため変更しない。
// ====================================================================
export const DEFAULT_STYLE: TelopStyle = {
  fontSize: 44,
  fontColor: "#FFFFFF",
  fontWeight: 700,
  fontFamily: '"Inter", "Noto Sans", "Helvetica Neue", Arial, sans-serif',
  align: "bottom",
  marginPercent: 6,
  maxLineChars: 38,
  maxLines: 2,
  lineHeight: 1.18,
  background: { kind: "bar", barColor: "#000000", barOpacity: 0.75 },
};

export const STYLE_PRESETS: { id: string; label: string; style: TelopStyle }[] = [
  {
    id: "black-bar",
    label: "黒帯＋白文字（標準・推奨）",
    style: { ...DEFAULT_STYLE },
  },
  {
    id: "compact-bar",
    label: "黒帯（小さめ・盤を隠さない）",
    style: {
      ...DEFAULT_STYLE,
      fontSize: 36,
      marginPercent: 4,
      background: { kind: "bar", barColor: "#000000", barOpacity: 0.7 },
    },
  },
  {
    id: "white-outline",
    label: "白文字＋黒フチ（帯なし）",
    style: {
      ...DEFAULT_STYLE,
      background: { kind: "outline", outlineColor: "#000000", outlineWidth: 4 },
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
];
