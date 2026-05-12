/**
 * 秒読みカウントダウンの検出
 *
 * 将棋動画では「1, 2, 3...」または「いち、に、さん…」のように
 * 残り秒数を読み上げる「秒読み」が頻出する。
 * これを音声翻訳すると "one" "two" のようになり海外視聴者に伝わりにくく、
 * かつ書き起こしの揺れで誤訳しやすい。
 *
 * そこで「明らかに秒読みっぽい連続短セグメント」を検出して、
 * テキストを数字に置き換え、テロップ側で色付き演出する。
 *
 * 検出条件：
 *  - そのセグメントの日本語が「1〜10の数字（漢数字／ひらがな読み／半角数字）」だけ
 *  - そのセグメントの長さが 1.8 秒以下（秒読みは短く読み上げる）
 *  - 同条件のセグメントが 3つ以上 連続している（単発の "1" は秒読みではない）
 */
import type { Segment } from "./speech";

const NUMBER_MAP: Record<string, number> = {
  // 半角数字
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  // 全角数字
  "１": 1,
  "２": 2,
  "３": 3,
  "４": 4,
  "５": 5,
  "６": 6,
  "７": 7,
  "８": 8,
  "９": 9,
  "１０": 10,
  // 漢数字
  "一": 1,
  "二": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
  "十": 10,
  // ひらがな読み
  "いち": 1,
  "に": 2,
  "さん": 3,
  "よん": 4,
  "し": 4,
  "ご": 5,
  "ろく": 6,
  "しち": 7,
  "なな": 7,
  "はち": 8,
  "きゅう": 9,
  "く": 9,
  "じゅう": 10,
};

const MAX_COUNTDOWN_DURATION = 1.8;
const MIN_RUN_LENGTH = 3;

/**
 * セグメントの日本語テキストが「秒読みで使う数字」だけかを判定し、
 * その値（1-10）を返す。違えば null
 */
export function asCountdownValue(jp: string): number | null {
  if (!jp) return null;
  const normalized = jp
    .replace(/[\s、。!,.！？・「」 　]/g, "")
    .trim();
  if (!normalized) return null;
  const v = NUMBER_MAP[normalized];
  return typeof v === "number" ? v : null;
}

/**
 * 検出結果：そのセグメントが秒読みなら countdownValue を返す Map
 */
export function detectCountdownSegments(
  segments: Pick<Segment, "index" | "startSec" | "endSec" | "jp">[]
): Map<number, number> {
  const result = new Map<number, number>();

  // 1. 各セグメントについて「数字単体 かつ 短い」かを判定
  const numericFlags: { index: number; value: number | null }[] = segments.map(
    (s) => {
      const dur = s.endSec - s.startSec;
      if (dur > MAX_COUNTDOWN_DURATION) return { index: s.index, value: null };
      return { index: s.index, value: asCountdownValue(s.jp) };
    }
  );

  // 2. 連続するランを探す
  let i = 0;
  while (i < numericFlags.length) {
    if (numericFlags[i].value == null) {
      i++;
      continue;
    }
    let j = i;
    while (j < numericFlags.length && numericFlags[j].value != null) j++;
    const runLen = j - i;
    if (runLen >= MIN_RUN_LENGTH) {
      for (let k = i; k < j; k++) {
        result.set(numericFlags[k].index, numericFlags[k].value as number);
      }
    }
    i = j;
  }

  return result;
}

/**
 * カウントダウン値に応じた色（残り時間の緊張感）
 *  10〜6 = 白 / 5〜3 = 黄 / 2〜1 = 赤
 */
export function countdownColor(value: number): string {
  if (value <= 2) return "#FF3030"; // 赤
  if (value <= 5) return "#FFD400"; // 黄
  return "#FFFFFF"; // 白
}
