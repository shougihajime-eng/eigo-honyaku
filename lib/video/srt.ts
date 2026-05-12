/**
 * セグメント配列を SRT 字幕ファイル形式に変換
 */
export type SrtSegment = {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
};

function fmtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(segments: SrtSegment[]): string {
  return segments
    .map((s, i) => {
      const text = (s.text || "").trim();
      if (!text) return null;
      return `${i + 1}\n${fmtTime(s.startSec)} --> ${fmtTime(s.endSec)}\n${text}\n`;
    })
    .filter(Boolean)
    .join("\n");
}
