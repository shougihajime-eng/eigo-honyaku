/**
 * 盤面フレームを見せて「指し手の手がかり（boardHint）」を作る。
 *
 * 音声だけだと「ここ」「この歩」「こっち」のような指示語が誰にも訳せない。
 * その瞬間の盤面画像を Claude(vision) に見せ、「どの駒がどこへ動いたか」を
 * 短い英語で言ってもらい、各セグメントにヒントとして添える。
 * このヒントを翻訳プロンプトに渡すと、曖昧な指示語が正確な指し手になる。
 *
 * コストと時間を抑えるため：
 * - 指し手・盤面に触れていそうなセグメントだけを対象にする
 * - 1動画あたりの枚数に上限を設ける
 * - 失敗しても翻訳は止めない（ヒント無しで続行）
 */
import Anthropic from "@anthropic-ai/sdk";
import { extractFrame } from "./frames";
import { buildBriefingBlock, type VideoBriefing } from "./briefing";

const MODEL = "claude-sonnet-4-6";
const PARALLEL_LIMIT = 4;
const MAX_FRAMES = 60; // 1動画あたりの vision 呼び出し上限（コスト保護）

type Seg = { index: number; startSec: number; endSec: number; jp: string };

// 指し手・盤面に触れていそうかの判定。
// 駒・動作の語、または指示語（ここ/こう/これ等）を含むものを候補にする。
const PIECE = /[歩兵角飛車金銀桂香王玉と龍竜馬]/;
const MOVE = /(成|打|取|寄|引|上|下|右|左|跳|突|繰|捨|合|利|効|王手|詰|受|攻め|進|逃|交換|手)/;
const DEICTIC = /(ここ|こう|これ|こっち|この|その|あの|そこ|あそこ)/;

function looksLikeMove(jp: string): boolean {
  const t = jp ?? "";
  if (DEICTIC.test(t) && (PIECE.test(t) || MOVE.test(t))) return true;
  if (PIECE.test(t) && MOVE.test(t)) return true;
  return false;
}

const VISION_SYSTEM = `You look at a single frame from a shogi (Japanese chess) video and the commentator's spoken line, and you state the concrete board fact being referred to.
- Reply with ONE short English phrase naming the move or board fact, e.g. "Pawn to 76", "Bishop takes on 88", "Silver retreats to 78", "King is in check from the rook".
- Use standard numeric shogi coordinates (file 1-9, rank 1-9) when you can read them.
- This is a HINT for a translator to resolve vague words like "here" / "this pawn". Be concrete but brief.
- If the board is not visible or you cannot tell, reply with exactly: (none)
- No preamble, no explanation, just the phrase.`;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) || 1 },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

/**
 * 盤面ヒントを生成して Map<index, hint> で返す。
 * videoPath が無い／API キーが無い場合は空 Map。
 */
export async function generateBoardHints(
  videoPath: string,
  segments: Seg[],
  briefing: VideoBriefing | null = null
): Promise<{ hints: Map<number, string>; capped: number }> {
  const hints = new Map<number, string>();
  if (!process.env.ANTHROPIC_API_KEY) return { hints, capped: 0 };

  const candidates = segments.filter((s) => looksLikeMove(s.jp));
  const capped = Math.max(0, candidates.length - MAX_FRAMES);
  const targets = candidates.slice(0, MAX_FRAMES);
  if (targets.length === 0) return { hints, capped: 0 };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const briefingBlock = buildBriefingBlock(briefing);

  await runWithConcurrency(targets, PARALLEL_LIMIT, async (seg) => {
    const mid = (seg.startSec + seg.endSec) / 2;
    const frame = await extractFrame(videoPath, mid);
    if (!frame) return;
    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 120,
        temperature: 0,
        system: VISION_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: frame.toString("base64"),
                },
              },
              {
                type: "text",
                text: `Commentator says: "${seg.jp}"${briefingBlock}\n\nWhat concrete shogi move or board fact is being referred to? One short phrase, or (none).`,
              },
            ],
          },
        ],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("")
        .trim();
      if (text && !/^\(?none\)?$/i.test(text)) {
        hints.set(seg.index, text.replace(/^["']|["']$/g, ""));
      }
    } catch {
      // この1枚が失敗しても他は続ける
    }
  });

  return { hints, capped };
}
