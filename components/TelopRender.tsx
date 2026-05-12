"use client";

import type { CSSProperties } from "react";
import { wrapLines } from "@/lib/telop/quality";
import { countdownColor } from "@/lib/video/countdown";
import type { TelopStyle } from "@/lib/telop/types";

type Props = {
  text: string;
  style: TelopStyle;
  containerWidth: number;
  // 秒読みカウントダウンとして大きく色付きで表示するか
  countdownValue?: number;
};

/**
 * テロップ1枚を実際の見た目で描画
 * - containerWidth は親の動画フレーム幅(px)。fontSize はそれに対するスケーリングをしない（指定値そのまま使う）
 *   ※ 親側で fontSize の意味を「実動画解像度に対する％」として管理する場合は、別途換算する
 * - countdownValue が指定された時は通常字幕とは別の演出（大きな数字＋緊張感のある色）
 */
export function TelopRender({ text, style, containerWidth, countdownValue }: Props) {
  if (typeof countdownValue === "number") {
    return (
      <CountdownNumber value={countdownValue} containerWidth={containerWidth} />
    );
  }
  const lines = wrapLines(text || "", style.maxLineChars).slice(0, style.maxLines);
  const verticalAlign =
    style.align === "top"
      ? "flex-start"
      : style.align === "middle"
        ? "center"
        : "flex-end";

  const margin = (style.marginPercent / 100) * containerWidth * (9 / 16);

  const wrapperStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: verticalAlign,
    alignItems: "center",
    paddingTop: margin,
    paddingBottom: margin,
    pointerEvents: "none",
  };

  const bg = style.background;
  // プレビュー領域(=containerWidth)を 1280px(=720p の横幅)基準でスケーリングし、
  // ffmpeg で 720p に焼き込んだときと同じ見た目になるよう近づける
  const scale = containerWidth / 1280;
  const fontSize = Math.max(10, style.fontSize * scale);

  const textBlockStyle: CSSProperties = {
    fontSize,
    color: style.fontColor,
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily,
    lineHeight: style.lineHeight,
    textAlign: "center",
    maxWidth: "92%",
    whiteSpace: "pre-line",
    ...(bg.kind === "bar"
      ? {
          backgroundColor: bgRgba(bg.barColor, bg.barOpacity),
          padding: `${Math.round(fontSize * 0.18)}px ${Math.round(fontSize * 0.45)}px`,
          borderRadius: 6,
        }
      : {}),
    ...(bg.kind === "outline"
      ? {
          textShadow: outlineShadow(
            bg.outlineColor,
            Math.max(1, bg.outlineWidth * scale)
          ),
        }
      : {}),
  };

  if (lines.length === 0) return null;

  return (
    <div style={wrapperStyle}>
      <div style={textBlockStyle}>{lines.join("\n")}</div>
    </div>
  );
}

function bgRgba(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${opacity})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${opacity})`;
}

function outlineShadow(color: string, width: number): string {
  const w = Math.max(1, Math.round(width));
  const offsets = [
    [-w, -w],
    [0, -w],
    [w, -w],
    [-w, 0],
    [w, 0],
    [-w, w],
    [0, w],
    [w, w],
  ];
  return offsets.map(([dx, dy]) => `${dx}px ${dy}px 0 ${color}`).join(", ");
}

/**
 * 秒読みカウントダウンの数字を、画面右上に大きく色付きで表示
 * - 10〜6: 白
 * -  5〜3: 黄
 * -  2〜1: 赤
 * 通常字幕とは別エリアに置くので、本来の字幕と重ならず両方読める。
 */
function CountdownNumber({
  value,
  containerWidth,
}: {
  value: number;
  containerWidth: number;
}) {
  const color = countdownColor(value);
  const size = Math.max(36, Math.round(containerWidth * 0.16));
  const pad = Math.max(8, Math.round(containerWidth * 0.02));
  const wrap: CSSProperties = {
    position: "absolute",
    top: pad,
    right: pad,
    pointerEvents: "none",
  };
  const numStyle: CSSProperties = {
    fontSize: size,
    fontWeight: 900,
    color,
    lineHeight: 1,
    fontFamily:
      '"Inter", "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", sans-serif',
    textShadow: outlineShadow("#000000", Math.max(2, Math.round(size * 0.05))),
    letterSpacing: "-0.04em",
  };
  return (
    <div style={wrap}>
      <div style={numStyle}>{value}</div>
    </div>
  );
}
