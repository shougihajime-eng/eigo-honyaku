"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Mode = "literal" | "natural" | "youtube" | "shogi";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "natural", label: "自然英語", hint: "海外読者に滑らかな英語" },
  { value: "youtube", label: "YouTubeタイトル", hint: "クリックされる短い英語" },
  { value: "shogi", label: "将棋専門", hint: "用語を厳密に英訳" },
  { value: "literal", label: "直訳", hint: "原文に忠実" },
];

type Hint = { jp: string; en: string };

export default function QuickPage() {
  const [text, setText] = useState("");
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
        body: JSON.stringify({ text: t, mode }),
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
          日本語を、英語に。
        </h1>
        <p className="text-sm text-zinc-400">
          タイトル・サムネ・概要・コメント返信。すぐ訳します。
        </p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MODES.map((m) => {
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

      {/* Input */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            日本語
          </span>
          <span className="text-[11px] text-zinc-500">
            {text.length} / 4000
          </span>
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="日本語を貼り付け…"
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
          {loading ? "翻訳中…" : "英訳する"}
        </button>
        <button onClick={clearAll} className="btn-secondary">
          クリア
        </button>
      </div>

      {/* Output */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            英語
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
          {error ?? (result || <span className="text-zinc-600">英訳結果がここに表示されます</span>)}
        </div>
      </div>

      {hints.length > 0 && (
        <div className="animate-fade rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-4">
          <div className="text-xs font-medium text-violet-200">
            将棋辞書を適用
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {hints.map((h) => (
              <li
                key={h.jp}
                className="rounded-md border border-violet-500/20 bg-violet-500/[0.08] px-2 py-0.5 text-[11px] text-violet-100"
              >
                {h.jp}
                <span className="mx-1 text-violet-400/60">→</span>
                {h.en}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
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
