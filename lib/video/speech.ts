/**
 * Google Cloud Speech-to-Text v2 で日本語音声を書き起こす
 * - latest_long モデル
 * - 将棋用語をフレーズアダプテーションとして渡す
 * - word-level timestamps を取得
 *
 * 認証:
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON 環境変数に
 *   サービスアカウント JSON 全文を入れる（または GOOGLE_APPLICATION_CREDENTIALS に
 *   ファイルパスを入れる）
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SHOGI_DICTIONARY } from "@/lib/shogi-dictionary";

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
 * 音声ファイル（16kHz mono WAV）を文字起こしし、セグメント配列を返す
 */
export async function transcribeJapanese(audioPath: string): Promise<Segment[]> {
  const credsPath = await ensureCredentialsFile();
  const { token, projectId } = await getAccessToken(credsPath);

  const audioBuf = await fs.readFile(audioPath);
  if (audioBuf.length > 9 * 1024 * 1024) {
    // 同期API は ~10MB 制限。長尺対応は将来 GCS+long-running に
    throw new Error(
      "音声が大きすぎます（10MB超）。動画を短くするか、長尺対応版をリクエストしてください。"
    );
  }

  const phrases = SHOGI_DICTIONARY.map((t) => ({ value: t.jp, boost: 15 }));

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
  let idx = 0;
  for (const r of data.results ?? []) {
    const alt = r.alternatives?.[0];
    if (!alt?.transcript) continue;
    const words = alt.words ?? [];
    const start = words.length > 0 ? parseDuration(words[0].startOffset) : 0;
    const end =
      words.length > 0 ? parseDuration(words[words.length - 1].endOffset) : start + 1;
    segments.push({
      index: idx++,
      startSec: start,
      endSec: end,
      jp: alt.transcript.trim(),
    });
  }

  return mergeShortSegments(segments);
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
