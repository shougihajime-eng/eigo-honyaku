import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-6 sm:py-16">
      <Header />

      <section className="mt-14 flex flex-col items-start gap-6 sm:mt-24">
        <span className="chip chip-accent animate-fade">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
          将棋クリエイター向け
        </span>
        <h1 className="animate-fade-in text-[2.5rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-7xl">
          将棋を、
          <br className="sm:hidden" />
          <span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">
            世界へ届ける
          </span>
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-zinc-300 sm:text-xl">
          AIが、あなたの日本語動画を
          <span className="text-white"> 海外視聴者に伝わる英語字幕</span>
          に変えます。
          書き起こし・翻訳・テロップまで、ひとつの画面で。
        </p>
      </section>

      <section className="mt-10 grid animate-fade-in grid-cols-1 gap-4 sm:mt-16 sm:grid-cols-2 sm:gap-6">
        <FeatureCard
          href="/subtitle"
          eyebrow="メイン"
          title="動画字幕を作る"
          description="MP4 ファイルか YouTube URL を入れるだけ。書き起こし → 翻訳 → テロップ調整まで一気通貫。"
          accentDots="from-violet-500/50 via-fuchsia-500/30 to-transparent"
        />
        <FeatureCard
          href="/quick"
          eyebrow="クイック"
          title="テキストを即英訳"
          description="タイトル・サムネ・概要欄・コメント返信を、将棋専門辞書つきの英訳で一瞬。"
          accentDots="from-cyan-500/50 via-sky-500/30 to-transparent"
        />
      </section>

      <section className="mt-10 grid grid-cols-1 gap-3 sm:mt-16 sm:grid-cols-3 sm:gap-4">
        <Stat label="将棋専門辞書" value="100+" sub="駒・戦法・囲い・棋戦名" />
        <Stat label="AI モデル" value="Claude Sonnet 4.6" sub="二段チェックで品質担保" />
        <Stat label="対応端末" value="すべて" sub="PC / iPad / iPhone / Android" />
      </section>

      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between">
      <Link href="/" className="flex items-center gap-2.5">
        <Logo />
        <span className="text-sm font-semibold tracking-tight text-zinc-200">Eigo</span>
      </Link>
      <nav className="flex items-center gap-1">
        <Link href="/quick" className="btn-ghost">
          クイック翻訳
        </Link>
      </nav>
    </header>
  );
}

function Logo() {
  return (
    <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/10">
      <span className="absolute inset-0 bg-gradient-to-br from-violet-500/60 via-fuchsia-500/30 to-cyan-500/40 opacity-90" />
      <span className="relative text-[11px] font-bold text-white">E</span>
    </span>
  );
}

function FeatureCard({
  href,
  eyebrow,
  title,
  description,
  accentDots,
}: {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  accentDots: string;
}) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-3xl border border-white/[0.08] bg-zinc-900/40 p-7 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.18] hover:bg-zinc-900/70 hover:shadow-[0_24px_48px_-16px_rgba(139,92,246,0.35)] sm:p-9 min-h-[180px] sm:min-h-[220px]"
    >
      <div
        className={`pointer-events-none absolute -top-32 right-0 h-72 w-72 rounded-full bg-gradient-to-b ${accentDots} opacity-60 blur-3xl transition-opacity duration-500 group-hover:opacity-100`}
      />
      <div className="relative flex flex-col gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">
          {eyebrow}
        </span>
        <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[2rem]">
          {title}
        </h2>
        <p className="text-base leading-relaxed text-zinc-300 sm:text-lg">
          {description}
        </p>
        <div className="mt-4 inline-flex items-center gap-1.5 text-base font-medium text-white transition-transform duration-300 group-hover:translate-x-1.5">
          始める
          <Arrow />
        </div>
      </div>
    </Link>
  );
}

function Arrow() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 20 20"
      strokeWidth={1.8}
      stroke="currentColor"
      className="h-4 w-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 10h12m0 0l-5-5m5 5l-5 5" />
    </svg>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md sm:p-6">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        {value}
      </div>
      <div className="mt-1 text-sm text-zinc-400">{sub}</div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-auto pt-16 text-center">
      <p className="text-[11px] tracking-wider text-zinc-600">
        EIGO · Powered by Claude &amp; Google Speech
      </p>
    </footer>
  );
}
