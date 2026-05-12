/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg.wasm のマルチスレッド版を /subtitle 配下だけで有効にするため、
  // SharedArrayBuffer 必須のヘッダ（COOP / COEP）をパス限定で付与する。
  // 全画面に効かせるとトップ等の外部画像が壊れるため必ずパス限定。
  async headers() {
    return [
      {
        source: "/subtitle/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
