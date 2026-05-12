/**
 * Google Cloud Speech-to-Text v2 で日本語音声を書き起こす（Buffer 直渡し版）。
 * 既存 `lib/video/speech.ts` は一時ファイルパス前提だったため、
 * Vercel Serverless で使えるように Buffer 直接受け取り版を作る。
 *
 * 認証: GOOGLE_APPLICATION_CREDENTIALS_JSON 環境変数に
 *       サービスアカウント JSON 全文をそのまま入れる。
 * Vercel Serverless では一時ファイルを書かずメモリ完結。
 */

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

type Credentials = {
  client_email: string;
  private_key: string;
  project_id: string;
};

let cachedCreds: Credentials | null = null;

function loadCredentials(): Credentials {
  if (cachedCreds) return cachedCreds;
  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS_JSON が設定されていません。Vercel の環境変数または .env.local を確認してください。"
    );
  }
  let parsed: Credentials;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `GOOGLE_APPLICATION_CREDENTIALS_JSON の JSON パースに失敗: ${e instanceof Error ? e.message : "unknown"}`
    );
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS_JSON に必須フィールドがありません");
  }
  cachedCreds = parsed;
  return parsed;
}

async function getAccessToken(): Promise<{ token: string; projectId: string }> {
  const creds = loadCredentials();

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

const SYNC_LIMIT_BYTES = 9 * 1024 * 1024; // Speech v2 同期 API は ~10MB 上限

/**
 * 音声 Buffer を Speech v2 同期 API に送って文字起こしする
 */
export async function transcribeAudioBuffer(audioBuf: Buffer): Promise<Segment[]> {
  if (audioBuf.length > SYNC_LIMIT_BYTES) {
    throw new Error(
      `音声が大きすぎます（${Math.round(audioBuf.length / 1024 / 1024)}MB / 上限約9MB）。動画を短くするか、低ビットレートで再エンコードしてください。`
    );
  }

  const { token, projectId } = await getAccessToken();
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
        phraseSets: [{ inlinePhraseSet: { phrases } }],
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
