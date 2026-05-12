import type { TelopSegment, TelopStyle, TelopWarning } from "./types";

const MIN_DURATION_SEC = 0.8;
const HARD_MAX_CHARS = 50;

export function checkSegment(
  seg: TelopSegment,
  style: TelopStyle
): TelopWarning[] {
  const out: TelopWarning[] = [];
  const en = (seg.en || "").trim();
  const dur = seg.endSec - seg.startSec;

  if (en.length > HARD_MAX_CHARS) {
    out.push({
      index: seg.index,
      kind: "too-long",
      message: `英文が長すぎます（${en.length}文字 / 上限${HARD_MAX_CHARS}）。短く分けるか言い換えを検討`,
    });
  } else {
    const lines = wrapLines(en, style.maxLineChars);
    if (lines.length > style.maxLines) {
      out.push({
        index: seg.index,
        kind: "too-long",
        message: `${lines.length}行になります（上限${style.maxLines}行）。文字を短くするか1行あたりの文字数を増やしてください`,
      });
    }
  }

  if (dur > 0 && dur < MIN_DURATION_SEC) {
    out.push({
      index: seg.index,
      kind: "too-short-duration",
      message: `表示時間が短すぎます（${dur.toFixed(2)}秒）。読めない可能性があります`,
    });
  }

  if (seg.warning) {
    out.push({
      index: seg.index,
      kind: "translation-warning",
      message: seg.warning,
    });
  }

  return out;
}

export function checkAll(
  segments: TelopSegment[],
  style: TelopStyle
): TelopWarning[] {
  return segments.flatMap((s) => checkSegment(s, style));
}

/**
 * 半角換算で「およそ maxChars 文字」ごとに改行する
 * 単語境界（スペース）で切れることを優先。日本語混じりも一応対応
 */
export function wrapLines(text: string, maxChars: number): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  if (visibleLength(t) <= maxChars) return [t];

  const words = t.split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current + w;
    if (visibleLength(candidate) > maxChars && current.trim().length > 0) {
      lines.push(current.trim());
      current = w.replace(/^\s+/, "");
    } else {
      current = candidate;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function visibleLength(s: string): number {
  let len = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    len += code <= 0xff ? 1 : 2;
  }
  return len;
}
