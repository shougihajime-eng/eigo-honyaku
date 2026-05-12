import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:py-12">
      <header className="mb-8 text-center sm:mb-12">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          将棋YouTube 英語化ツール
        </h1>
        <p className="mt-2 text-sm text-slate-500 sm:text-base">
          毎日の動画づくりを、最小操作で。
        </p>
      </header>

      <div className="flex flex-col gap-4 sm:gap-5">
        <Link
          href="/subtitle"
          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-900 hover:shadow-md sm:p-6"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white sm:h-14 sm:w-14">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-6 w-6 sm:h-7 sm:w-7"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold sm:text-xl">動画字幕を作る</h2>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                  おすすめ
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                動画ファイルから、英語の字幕ファイル（SRT）を自動で作ります。
                <br className="hidden sm:inline" />
                将棋用語もきちんと訳します。
              </p>
              <div className="mt-3 inline-flex items-center text-sm font-semibold text-slate-900 transition group-hover:translate-x-1">
                始める
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="ml-1 h-4 w-4"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </div>
          </div>
        </Link>

        <Link
          href="/quick"
          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-900 hover:shadow-md sm:p-6"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-white sm:h-14 sm:w-14">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-6 w-6 sm:h-7 sm:w-7"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 5l7 7-7 7M5 12h14"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold sm:text-xl">クイック翻訳</h2>
              <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                タイトル・サムネ文字・概要欄など、テキストをすぐに英訳します。
              </p>
              <div className="mt-3 inline-flex items-center text-sm font-semibold text-slate-900 transition group-hover:translate-x-1">
                始める
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="ml-1 h-4 w-4"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </div>
            </div>
          </div>
        </Link>
      </div>

      <footer className="mt-auto pt-10 text-center text-[11px] text-slate-400">
        将棋YouTuber向け 英語化ツール
      </footer>
    </main>
  );
}
