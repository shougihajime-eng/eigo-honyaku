"use client";

import { useEffect, useRef, useState } from "react";
import { TelopRender } from "./TelopRender";
import type { TelopStyle } from "@/lib/telop/types";

type Props = {
  text: string;
  style: TelopStyle;
  backgroundUrl?: string | null;
};

/**
 * 16:9 のプレビュー枠の中にテロップを乗せて表示
 * - 背景は単色 or 任意の画像（はじめさんが将棋盤の代表フレームを差し替えられるよう）
 * - 「将棋盤の目安エリア」を薄く出して、テロップが盤を隠していないか視覚化
 */
export function TelopPreviewFrame({ text, style, backgroundUrl }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-900 shadow-md"
      style={
        backgroundUrl
          ? {
              backgroundImage: `url(${backgroundUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {!backgroundUrl && <ShogiBoardMock />}
      <BoardSafeZone />
      <TelopRender text={text} style={style} containerWidth={width} />
    </div>
  );
}

/** 背景画像が無いときに表示する、将棋盤を模した中央のマス */
function ShogiBoardMock() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="aspect-square h-[68%] rounded-md bg-amber-100 shadow-inner"
        style={{
          backgroundImage:
            "linear-gradient(#0001 1px, transparent 1px), linear-gradient(90deg, #0001 1px, transparent 1px)",
          backgroundSize: "calc(100%/9) calc(100%/9)",
        }}
        aria-label="将棋盤の代わりのモック"
      />
    </div>
  );
}

/** 「ここに将棋盤がある可能性が高い」という枠を、薄く点線で示す */
function BoardSafeZone() {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 aspect-square h-[72%] -translate-x-1/2 -translate-y-1/2 rounded border border-dashed border-white/20"
      title="将棋盤の目安"
    />
  );
}
