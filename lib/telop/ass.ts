/**
 * TelopStyle を ffmpeg subtitles フィルタの force_style 文字列に変換する
 *
 * 前提: ソース動画は 720p（1280x720）にスケールせず、`fontSize` などは
 *       720p の動画ピクセル単位で指定されているものとして扱う
 */
import type { TelopStyle } from "./types";

/** "#RRGGBB" を ASS 用の "&H00BBGGRR" に変換 */
function toAssColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "&H00FFFFFF";
  const r = m[1].substring(0, 2);
  const g = m[1].substring(2, 4);
  const b = m[1].substring(4, 6);
  const a = alpha.toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

export function isValidTelopStyle(v: unknown): v is TelopStyle {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.fontSize !== "number") return false;
  if (typeof o.fontColor !== "string") return false;
  if (![400, 600, 700, 800].includes(o.fontWeight as number)) return false;
  if (typeof o.fontFamily !== "string") return false;
  if (!["top", "middle", "bottom"].includes(o.align as string)) return false;
  if (typeof o.marginPercent !== "number") return false;
  if (typeof o.maxLineChars !== "number") return false;
  if (typeof o.maxLines !== "number") return false;
  if (typeof o.lineHeight !== "number") return false;
  const bg = o.background as Record<string, unknown>;
  if (!bg || typeof bg !== "object") return false;
  if (!["none", "outline", "bar"].includes(bg.kind as string)) return false;
  return true;
}

/**
 * 動画解像度を渡せばより正確に。デフォルトは 720p。
 */
export function toForceStyle(style: TelopStyle, sourceHeight = 720): string {
  // marginPercent は画面高さに対する % で受け取る
  const marginV = Math.round((style.marginPercent / 100) * sourceHeight);

  // ASS Alignment numpad: 1=BL 2=BC 3=BR / 4=ML 5=MC 6=MR / 7=TL 8=TC 9=TR
  const align = style.align === "top" ? 8 : style.align === "middle" ? 5 : 2;

  const bold = style.fontWeight >= 700 ? 1 : 0;

  // 安全に Arial 系へ寄せる（システムフォントは ffmpeg で見つからないことが多い）
  const fontName = "Arial";

  const parts: string[] = [
    `FontName=${fontName}`,
    `FontSize=${Math.round(style.fontSize)}`,
    `PrimaryColour=${toAssColor(style.fontColor)}`,
    `Bold=${bold}`,
    `Alignment=${align}`,
    `MarginV=${marginV}`,
    "MarginL=20",
    "MarginR=20",
  ];

  const bg = style.background;
  if (bg.kind === "outline") {
    parts.push(`OutlineColour=${toAssColor(bg.outlineColor)}`);
    parts.push("BorderStyle=1");
    parts.push(`Outline=${Math.max(0, Math.round(bg.outlineWidth))}`);
    parts.push("Shadow=0");
  } else if (bg.kind === "bar") {
    // alpha は 0=完全不透明, 255=完全透明（ASS 仕様）
    const alpha = Math.max(0, Math.min(255, Math.round((1 - bg.barOpacity) * 255)));
    parts.push(`BackColour=${toAssColor(bg.barColor, alpha)}`);
    parts.push("BorderStyle=3");
    parts.push("Outline=8"); // 帯のパディング
    parts.push("Shadow=0");
  } else {
    parts.push("BorderStyle=1");
    parts.push("Outline=0");
    parts.push("Shadow=0");
  }

  return parts.join(",");
}
