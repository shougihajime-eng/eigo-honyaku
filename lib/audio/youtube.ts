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
 * - cookies が無くても IOS / TV クライアントとして偽装することで
 *   多くの場合 bot 判定を回避できる。
 */

import ytdl from "@distube/ytdl-core";

const MAX_DURATION_SEC = 20 * 60; // 安全側で 20 分まで

type PlayerClient = "WEB_EMBEDDED" | "TV" | "IOS" | "ANDROID" | "WEB";

const PLAYER_CLIENTS: PlayerClient[] = (
  process.env.YOUTUBE_PLAYER_CLIENTS ?? "TV,IOS"
)
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter((s): s is PlayerClient =>
    ["WEB_EMBEDDED", "TV", "IOS", "ANDROID", "WEB"].includes(s)
  );

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
  const info = await ytdl.getInfo(url, {
    playerClients: PLAYER_CLIENTS,
    ...(agent ? { agent } : {}),
  });
  const durationSec = parseInt(info.videoDetails.lengthSeconds || "0", 10);

  if (durationSec > 0 && durationSec > MAX_DURATION_SEC) {
    throw new Error(
      `動画が長すぎます（${Math.round(durationSec / 60)} 分）。${Math.floor(
        MAX_DURATION_SEC / 60
      )} 分以下の動画でお試しください。`
    );
  }

  // audio-only を優先、無ければ audio+video から最小サイズを選ぶ
  const audioOnly = info.formats.filter((f) => f.hasAudio && !f.hasVideo && f.url);
  const audioAny = info.formats.filter((f) => f.hasAudio && f.url);
  const usableFormats = audioOnly.length > 0 ? audioOnly : audioAny;
  if (usableFormats.length === 0) {
    const summary = info.formats
      .slice(0, 6)
      .map((f) => `${f.itag}:audio=${f.hasAudio}:video=${f.hasVideo}:url=${!!f.url}:cipher=${!!(f as { signatureCipher?: string }).signatureCipher}`)
      .join(" | ");
    throw new Error(
      `音声フォーマット無し [total=${info.formats.length}, withUrl=0] sample: ${summary}`
    );
  }
  let chosen;
  try {
    chosen = ytdl.chooseFormat(usableFormats, { quality: "lowestaudio" });
  } catch (e) {
    const summary = usableFormats
      .slice(0, 5)
      .map((f) => `${f.itag}:${f.container}:${f.audioBitrate}kbps`)
      .join(" | ");
    throw new Error(
      `chooseFormat 失敗 [usable=${usableFormats.length}]: ${(e as Error).message} | ${summary}`
    );
  }
  const stream = ytdl.downloadFromInfo(info, {
    format: chosen,
    playerClients: PLAYER_CLIENTS,
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
