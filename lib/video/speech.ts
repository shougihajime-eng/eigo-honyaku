/**
 * Google Cloud Speech-to-Text v2 で日本語音声を書き起こす
 * - latest_long モデル
 * - 将棋用語をフレーズアダプテーションとして渡す
 * - word-level timestamps を取得
 * - 9MB を超える音声は ffmpeg で 4 分ごとに分割して順番に処理
 *
 * 認証:
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON 環境変数に
 *   サービスアカウント JSON 全文を入れる（または GOOGLE_APPLICATION_CREDENTIALS に
 *   ファイルパスを入れる）
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SHOGI_DICTIONARY } from "@/lib/shogi-dictionary";
import { fetchUserDictionary } from "@/lib/dictionary/user-store";
import { findBinary } from "./binaries";

const execFileP = promisify(execFile);

export type Segment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
};

type GoogleSpeechResponse = {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string;
      words?: Array<{
        word?: string;
        startOffset?: string;
        endOffset?: string;
      }>;
    }>;
  }>;
};

// 同期APIの上限は10MB かつ 60秒以下のインライン音声のみ
// 60秒を超えると Google が "Audio can be of a maximum of 60 seconds" を返すので
// 55秒（安全マージン）で分割し、複数回呼び出す
const MAX_SYNC_BYTES = 9 * 1024 * 1024;
const MAX_SYNC_SECONDS = 55;
const CHUNK_SECONDS = 55;

let cachedCredsPath: string | null = null;

async function ensureCredentialsFile(): Promise<string> {
  if (cachedCredsPath) return cachedCredsPath;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    cachedCredsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    return cachedCredsPath;
  }

  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON が設定されていません。.env.local に Google Cloud サービスアカウントの JSON を貼り付けてください。"
    );
  }
  // JSON 文字列が改行を含むので一時ファイルに書き出す
  const tmp = path.join(os.tmpdir(), `eigo-honyaku-gcp-${process.pid}.json`);
  await fs.writeFile(tmp, json, "utf8");
  cachedCredsPath = tmp;
  return tmp;
}

async function getAccessToken(credsPath: string): Promise<{ token: string; projectId: string }> {
  const raw = await fs.readFile(credsPath, "utf8");
  const creds = JSON.parse(raw) as {
    client_email: string;
    private_key: string;
    project_id: string;
  };

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const base64url = (b: Buffer) =>
    b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const enc = (o: object) => base64url(Buffer.from(JSON.stringify(o)));
  const signingInput = `${enc(header)}.${enc(claim)}`;

  const { createSign } = await import("node:crypto");
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = base64url(signer.sign(creds.private_key));
  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Google 認証失敗: ${await tokenRes.text()}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string };
  return { token: tokenJson.access_token, projectId: creds.project_id };
}

function parseDuration(s: string | undefined): number {
  if (!s) return 0;
  return parseFloat(s.replace("s", ""));
}

/**
 * 1チャンクを Google Speech 同期API に送って書き起こす
 * offsetSec は チャンクの開始時刻（元音声における秒数）。タイムスタンプを補正するために使う
 */
type SpeechPhrase = { value: string; boost: number };

/**
 * 聞き取りヒント（フレーズアダプテーション）を組み立てる。
 * - 将棋辞書の用語：boost 15
 * - 棋士名（辞書の name + 学習済みユーザー辞書）：boost 20（名前の聞き間違いを最優先で防ぐ）
 * Google Speech v2 の boost は 0〜20 が目安。長すぎ・1文字語は誤検出のもとなので除外。
 */
async function buildSpeechPhrases(): Promise<SpeechPhrase[]> {
  const map = new Map<string, number>();
  const add = (jp: string, boost: number) => {
    const v = (jp ?? "").trim();
    if (v.length < 2 || v.length > 20) return; // 1文字・長すぎは弾く
    const cur = map.get(v);
    if (cur == null || boost > cur) map.set(v, boost);
  };

  for (const t of SHOGI_DICTIONARY) {
    add(t.jp, t.category === "name" ? 20 : 15);
  }

  // 学習済みユーザー辞書（過去に確定した固有名詞）。名前は特に高boost。
  try {
    const userDict = await fetchUserDictionary();
    for (const t of userDict) {
      add(t.jp, t.category === "name" ? 20 : 16);
    }
  } catch {
    // 取得失敗（Supabase未接続など）でも聞き取り自体は続行
  }

  return Array.from(map, ([value, boost]) => ({ value, boost }));
}

async function transcribeOneChunk(
  audioPath: string,
  offsetSec: number,
  token: string,
  projectId: string,
  phrases: SpeechPhrase[]
): Promise<Segment[]> {
  const audioBuf = await fs.readFile(audioPath);
  if (audioBuf.length > 10 * 1024 * 1024) {
    throw new Error(
      `内部エラー: 分割後のチャンクが10MBを超えました（${audioBuf.length}B）。CHUNK_SECONDS を短くしてください。`
    );
  }

  const body = {
    config: {
      autoDecodingConfig: {},
      languageCodes: ["ja-JP"],
      model: "latest_long",
      features: {
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
      },
      adaptation: {
        phraseSets: [
          {
            inlinePhraseSet: { phrases },
          },
        ],
      },
    },
    content: audioBuf.toString("base64"),
  };

  const endpoint = `https://speech.googleapis.com/v2/projects/${projectId}/locations/global/recognizers/_:recognize`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Google Speech エラー: ${await res.text()}`);
  }
  const data = (await res.json()) as GoogleSpeechResponse;

  const segments: Segment[] = [];
  for (const r of data.results ?? []) {
    const alt = r.alternatives?.[0];
    if (!alt?.transcript) continue;
    const words = alt.words ?? [];
    const start = words.length > 0 ? parseDuration(words[0].startOffset) : 0;
    const end =
      words.length > 0 ? parseDuration(words[words.length - 1].endOffset) : start + 1;
    segments.push({
      index: 0, // あとで振り直す
      startSec: start + offsetSec,
      endSec: end + offsetSec,
      jp: alt.transcript.trim(),
    });
  }

  return segments;
}

/**
 * ffmpeg の segment muxer で WAV を時間ごとに分割する
 * 出力は同じディレクトリに `<basename>-chunk-000.wav`, `-001.wav`, ... の連番
 */
async function splitAudio(audioPath: string, chunkSec: number): Promise<string[]> {
  const ffmpeg = findBinary("ffmpeg");
  const dir = path.dirname(audioPath);
  const base = path.basename(audioPath, path.extname(audioPath));
  const prefix = `${base}-chunk-`;
  const pattern = path.join(dir, `${prefix}%03d.wav`);

  // 既存の同名チャンクが残っていれば消す
  const existing = (await fs.readdir(dir)).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".wav")
  );
  await Promise.all(existing.map((f) => fs.unlink(path.join(dir, f)).catch(() => {})));

  await execFileP(
    ffmpeg,
    [
      "-y",
      "-i",
      audioPath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkSec),
      "-c",
      "copy",
      pattern,
    ],
    { maxBuffer: 1024 * 1024 * 20 }
  );

  const files = (await fs.readdir(dir))
    .filter((f) => f.startsWith(prefix) && f.endsWith(".wav"))
    .sort();
  return files.map((f) => path.join(dir, f));
}

/**
 * ffprobe で音声の長さ（秒）を取得
 */
async function probeDurationSec(audioPath: string): Promise<number> {
  const ffprobe = findBinary("ffprobe");
  const { stdout } = await execFileP(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ],
    { maxBuffer: 1024 * 1024 }
  );
  const sec = parseFloat(stdout.trim());
  return Number.isFinite(sec) ? sec : 0;
}

/**
 * 音声ファイル（16kHz mono WAV）を文字起こしし、セグメント配列を返す
 * - 60秒以下かつ 9MB 以下: 1回の同期API呼び出し
 * - それ以外: ffmpeg で 55秒ごとに分割し、順番に書き起こして結合
 */
export async function transcribeJapanese(audioPath: string): Promise<Segment[]> {
  const credsPath = await ensureCredentialsFile();
  const { token, projectId } = await getAccessToken(credsPath);
  const phrases = await buildSpeechPhrases();

  const stat = await fs.stat(audioPath);
  const duration = await probeDurationSec(audioPath);

  if (stat.size <= MAX_SYNC_BYTES && duration <= MAX_SYNC_SECONDS) {
    const segs = await transcribeOneChunk(audioPath, 0, token, projectId, phrases);
    return mergeShortSegments(segs.map((s, i) => ({ ...s, index: i })));
  }

  // 60秒 or 9MB を超えるので分割
  const chunks = await splitAudio(audioPath, CHUNK_SECONDS);
  if (chunks.length === 0) {
    throw new Error("音声の分割に失敗しました（ffmpeg がチャンクを生成できませんでした）");
  }

  try {
    const all: Segment[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const offset = i * CHUNK_SECONDS;
      const segs = await transcribeOneChunk(chunks[i], offset, token, projectId, phrases);
      all.push(...segs);
    }
    return mergeShortSegments(all.map((s, i) => ({ ...s, index: i })));
  } finally {
    await Promise.all(chunks.map((c) => fs.unlink(c).catch(() => {})));
  }
}

/**
 * 字幕として読みやすい長さに合うようにマージ
 * - 0.5秒以下のギャップで連続する短文をくっつける
 * - 1セグメントが 8秒 / 50文字を超えないように
 */
function mergeShortSegments(input: Segment[]): Segment[] {
  if (input.length === 0) return input;
  const out: Segment[] = [];
  let cur = { ...input[0] };
  for (let i = 1; i < input.length; i++) {
    const next = input[i];
    const gap = next.startSec - cur.endSec;
    const wouldDuration = next.endSec - cur.startSec;
    const wouldLen = cur.jp.length + next.jp.length;
    if (gap <= 0.5 && wouldDuration <= 8 && wouldLen <= 50) {
      cur.jp = `${cur.jp}${next.jp}`;
      cur.endSec = next.endSec;
    } else {
      out.push(cur);
      cur = { ...next };
    }
  }
  out.push(cur);
  return out.map((s, i) => ({ ...s, index: i }));
}
