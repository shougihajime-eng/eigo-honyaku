/**
 * YouTube から音声のみを取得する（Vercel Serverless 用）。
 * @distube/ytdl-core で audioonly ストリームを Buffer に落とす。
 *
 * 利用先: app/api/subtitle/youtube/route.ts
 *
 * 注意:
 * - 同期 Speech v2 の上限が約 9MB のため、lowestaudio (≒48kbps webm/opus) を選ぶ。
 *   10〜15 分の動画ならおおよそ 4〜6MB に収まる。
 * - Google Speech v2 は autoDecodingConfig で WEBM_OPUS を受け付ける。
 * - bot 判定回避のため、環境変数 YOUTUBE_COOKIES_JSON に
 *   ログイン済み Cookie の JSON 配列を入れておくと自動で渡される。
 */

import ytdl from "@distube/ytdl-core";

const MAX_DURATION_SEC = 20 * 60; // 安全側で 20 分まで

let cachedAgent: ReturnType<typeof ytdl.createAgent> | undefined;

function getAgent(): ReturnType<typeof ytdl.createAgent> | undefined {
  if (cachedAgent) return cachedAgent;
  const raw = process.env.YOUTUBE_COOKIES_JSON;
  if (!raw) return undefined;
  try {
    const text = raw.trim().startsWith("[")
      ? raw
      : Buffer.from(raw, "base64").toString("utf-8");
    const cookies = JSON.parse(text);
    if (!Array.isArray(cookies)) return undefined;
    cachedAgent = ytdl.createAgent(cookies);
    return cachedAgent;
  } catch (e) {
    console.warn("[youtube] failed to parse YOUTUBE_COOKIES_JSON:", e);
    return undefined;
  }
}

export type YouTubeAudio = {
  audio: Buffer;
  title: string;
  videoId: string;
  durationSec: number;
};

export function isValidYouTubeUrl(url: string): boolean {
  try {
    return ytdl.validateURL(url);
  } catch {
    return false;
  }
}

export function extractVideoId(url: string): string | null {
  try {
    return ytdl.getURLVideoID(url);
  } catch {
    return null;
  }
}

export async function downloadYouTubeAudio(url: string): Promise<YouTubeAudio> {
  if (!isValidYouTubeUrl(url)) {
    throw new Error("YouTube の URL ではないようです");
  }

  const agent = getAgent();
  const info = await ytdl.getInfo(url, agent ? { agent } : undefined);
  const durationSec = parseInt(info.videoDetails.lengthSeconds || "0", 10);

  if (durationSec > 0 && durationSec > MAX_DURATION_SEC) {
    throw new Error(
      `動画が長すぎます（${Math.round(durationSec / 60)} 分）。${Math.floor(
        MAX_DURATION_SEC / 60
      )} 分以下の動画でお試しください。`
    );
  }

  const stream = ytdl.downloadFromInfo(info, {
    quality: "lowestaudio",
    filter: "audioonly",
    ...(agent ? { agent } : {}),
  });

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const audio = Buffer.concat(chunks);

  return {
    audio,
    title: info.videoDetails.title || "untitled",
    videoId: info.videoDetails.videoId,
    durationSec,
  };
}
