import type { MetadataRoute } from "next";

// スマホの「ホーム画面に追加」で、本物のアプリのように全画面で開くための設定
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "英語翻訳｜動画字幕・翻訳",
    short_name: "英語翻訳",
    description:
      "日本語動画を、海外視聴者に届く美しい英語字幕に。AIで字幕づくりと翻訳をまとめてお手伝いします。",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07070a",
    theme_color: "#09090b",
    lang: "ja",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
