"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type Direction = "ja2en" | "en2ja";
type Mode = "literal" | "natural" | "youtube" | "shogi" | "comment";

type ModeDef = { value: Mode; label: string; hint: string };

const MODES_BY_DIRECTION: Record<Direction, ModeDef[]> = {
  ja2en: [
    { value: "natural", label: "自然英語", hint: "海外読者に滑らかな英語" },
    { value: "youtube", label: "YouTubeタイトル", hint: "クリックされる短い英語" },
    { value: "shogi", label: "将棋専門", hint: "用語を厳密に英訳" },
    { value: "literal", label: "直訳", hint: "原文に忠実" },
  ],
  en2ja: [
    { value: "natural", label: "自然な日本語", hint: "読みやすい自然な日本語" },
    { value: "comment", label: "コメントを読む", hint: "海外コメントをくだけた日本語に" },
    { value: "shogi", label: "将棋専門", hint: "用語を正しい日本語に" },
    { value: "literal", label: "直訳", hint: "原文に忠実" },
  ],
};

const DIRECTION_META: Record<
  Direction,
  {
    sourceLabel: string;
    targetLabel: string;
    title: string;
    subtitle: string;
    placeholder: string;
    button: string;
    outputPlaceholder: string;
    counterUnit: string;
  }
> = {
  ja2en: {
    sourceLabel: "日本語",
    targetLabel: "英語",
    title: "日本語を、英語に。",
    subtitle: "タイトル・サムネ・概要・コメント返信。すぐ訳します。",
    placeholder: "日本語を貼り付け…",
    button: "英訳する",
    outputPlaceholder: "英訳結果がここに表示されます",
    counterUnit: "日本語",
  },
  en2ja: {
    sourceLabel: "英語",
    targetLabel: "日本語",
    title: "英語を、日本語に。",
    subtitle: "海外コメント・英語タイトル・海外の解説。意味をすぐ把握。",
    placeholder: "英語を貼り付け…",
    button: "日本語にする",
    outputPlaceholder: "日本語訳がここに表示されます",
    counterUnit: "英語",
  },
};

type Hint = { jp: string; en: string };

/** 入力文の言語をざっくり判定（切り替えの提案だけに使う） */
function looksJapanese(text: string): boolean {
  const jp = (text.match(/[぀-ヿ㐀-鿿]/g) || []).length;
  const ascii = (text.match(/[A-Za-z]/g) || []).length;
  return jp > 0 && jp >= ascii * 0.15;
}

export default function QuickPage() {
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<Direction>("ja2en");
  const [mode, setMode] = useState<Mode>("natural");
  const [result, setResult] = useState("");
  const [hints, setHints] = useState<Hint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const meta = DIRECTION_META[direction];
  const modes = MODES_BY_DIRECTION[direction];

  // 入力が今の向きと食い違っていたら、そっと切り替えを提案する
  const suggestFlip = useMemo(() => {
    const t = text.trim();
    if (t.length < 2) return false;
    const isJp = looksJapanese(t);
    return (direction === "ja2en" && !isJp) || (direction === "en2ja" && isJp);
  }, [text, direction]);

  function switchDirection(next: Direction) {
    if (next === direction) return;
    setDirection(next);
    // モードは「直訳」だけ両方向共通なので保てる。それ以外は先頭（自然）に戻す
    const allowed = MODES_BY_DIRECTION[next].map((m) => m.value);
    if (!allowed.includes(mode)) setMode("natural");
    setResult("");
    setHints([]);
    setError(null);
  }

  function flip() {
    switchDirection(direction === "ja2en" ? "en2ja" : "ja2en");
  }

  async function translate() {
    const t = text.trim();
    if (!t || loading) return;
    setLoading(true);
    setError(null);
    setResult("");
    setHints([]);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, mode, direction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "エラーが発生しました");
        return;
      }
      setResult(data.result ?? "");
      setHints(data.hints ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      translate();
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  function clearAll() {
    setText("");
    setResult("");
    setHints([]);
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-7 px-6 py-8 sm:py-12">
      <header className="flex items-center justify-between">
        <Link href="/" className="btn-ghost -ml-2 inline-flex items-center gap-1.5">
          <Back /> Eigo
        </Link>
        <span className="chip">クイック翻訳</span>
      </header>

      <div className="animate-fade-in flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {meta.title}
        </h1>
        <p className="text-sm text-zinc-400">{meta.subtitle}</p>
      </div>

      {/* 方向スイッチ */}
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2">
        <DirectionPill
          active={direction === "ja2en"}
          onClick={() => switchDirection("ja2en")}
          from="日本語"
          to="英語"
        />
        <button
          onClick={flip}
          aria-label="向きを入れ替える"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.09] hover:text-white active:scale-95"
        >
          <Swap />
        </button>
        <DirectionPill
          active={direction === "en2ja"}
          onClick={() => switchDirection("en2ja")}
          from="英語"
          to="日本語"
        />
      </div>

      {/* 入力言語が逆っぽいときの、そっとした提案 */}
      {suggestFlip && (
        <button
          onClick={flip}
          className="animate-fade -mt-2 flex items-center justify-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-2.5 text-sm text-amber-200 transition hover:bg-amber-400/[0.12]"
        >
          <span>
            {direction === "ja2en"
              ? "英語が入力されているみたいです。"
              : "日本語が入力されているみたいです。"}
          </span>
          <span className="font-semibold underline underline-offset-2">
            {direction === "ja2en" ? "英語→日本語に切り替える" : "日本語→英語に切り替える"}
          </span>
        </button>
      )}

      {/* モード選択 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {modes.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`rounded-xl border px-3.5 py-3 text-left transition-all duration-200 ${
                active
                  ? "border-white/15 bg-white/[0.08] shadow-[0_0_0_1px_rgba(139,92,246,0.25)_inset]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
              }`}
            >
              <div
                className={`text-sm font-semibold ${
                  active ? "text-white" : "text-zinc-200"
                }`}
              >
                {m.label}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">{m.hint}</div>
            </button>
          );
        })}
      </div>

      {/* 入力 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            {meta.sourceLabel}
          </span>
          <span className="text-[11px] text-zinc-500">{text.length} / 4000</span>
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={meta.placeholder}
          rows={5}
          className="field resize-y text-base leading-relaxed"
        />
        <div className="flex items-center justify-end">
          <span className="hidden text-[11px] text-zinc-500 sm:inline">
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
              Ctrl
            </kbd>{" "}
            +{" "}
            <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
              Enter
            </kbd>{" "}
            で翻訳
          </span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={translate}
          disabled={loading || !text.trim()}
          className="btn-primary flex-1"
        >
          {loading ? "翻訳中…" : meta.button}
        </button>
        <button onClick={clearAll} className="btn-secondary">
          クリア
        </button>
      </div>

      {/* 出力 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            {meta.targetLabel}
          </span>
          {result && (
            <button
              onClick={copyResult}
              className="text-[11px] text-zinc-400 transition hover:text-white"
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
          )}
        </div>
        <div
          className={`min-h-[140px] whitespace-pre-wrap rounded-xl border px-4 py-3.5 text-base leading-relaxed transition ${
            error
              ? "border-rose-500/30 bg-rose-500/[0.06] text-rose-200"
              : "border-white/[0.06] bg-white/[0.02] text-zinc-100"
          }`}
        >
          {error ?? (result || <span className="text-zinc-600">{meta.outputPlaceholder}</span>)}
        </div>
      </div>

      {hints.length > 0 && (
        <div className="animate-fade rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-4">
          <div className="text-xs font-medium text-violet-200">将棋辞書を適用</div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {hints.map((h) => (
              <li
                key={h.jp}
                className="rounded-md border border-violet-500/20 bg-violet-500/[0.08] px-2 py-0.5 text-[11px] text-violet-100"
              >
                {direction === "ja2en" ? h.jp : h.en}
                <span className="mx-1 text-violet-400/60">→</span>
                {direction === "ja2en" ? h.en : h.jp}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

function DirectionPill({
  active,
  onClick,
  from,
  to,
}: {
  active: boolean;
  onClick: () => void;
  from: string;
  to: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200 ${
        active
          ? "bg-white/[0.10] text-white shadow-[0_0_0_1px_rgba(139,92,246,0.3)_inset]"
          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      }`}
    >
      <span>{from}</span>
      <span className={active ? "text-violet-300" : "text-zinc-600"}>→</span>
      <span>{to}</span>
    </button>
  );
}

function Swap() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      className="h-4 w-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h12m0 0l-3-3m3 3l-3 3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 13H4m0 0l3-3m-3 3l3 3" />
    </svg>
  );
}

function Back() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-4 w-4"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16l-5-6 5-6" />
    </svg>
  );
}
