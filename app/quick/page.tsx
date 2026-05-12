"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Mode = "literal" | "natural" | "youtube" | "shogi";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "natural", label: "自然英語", hint: "海外読者に自然な英語" },
  { value: "youtube", label: "YouTubeタイトル", hint: "クリックされる英語タイトル" },
  { value: "shogi", label: "将棋専門", hint: "解説向け正確翻訳" },
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
      // ignore
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-4 py-5 sm:py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
            aria-label="トップへ戻る"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold sm:text-2xl">クイック翻訳</h1>
        </div>
        <span className="text-xs text-slate-500">日本語 → 英語</span>
      </header>

      {/* モード選択 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MODES.map((m) => {
          const active = mode === m.value;
          return (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`rounded-xl border px-3 py-2 text-left transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white hover:border-slate-400"
              }`}
            >
              <div className="text-sm font-semibold">{m.label}</div>
              <div className={`text-[11px] ${active ? "text-slate-300" : "text-slate-500"}`}>
                {m.hint}
              </div>
            </button>
          );
        })}
      </div>

      {/* 入力欄 */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-slate-700">日本語</label>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="ここに日本語を貼り付けて、翻訳ボタン or Ctrl+Enter"
          rows={5}
          className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-base leading-relaxed shadow-sm outline-none focus:border-slate-900"
        />
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{text.length} / 4000 文字</span>
          <span className="hidden sm:inline">Ctrl + Enter で翻訳</span>
        </div>
      </div>

      {/* ボタン */}
      <div className="flex gap-2">
        <button
          onClick={translate}
          disabled={loading || !text.trim()}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? "翻訳中..." : "英訳する"}
        </button>
        <button
          onClick={clearAll}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          クリア
        </button>
      </div>

      {/* 結果 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700">英語</label>
          {result && (
            <button
              onClick={copyResult}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:border-slate-400"
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
          )}
        </div>
        <div
          className={`min-h-[120px] whitespace-pre-wrap rounded-xl border p-3 text-base leading-relaxed ${
            error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-slate-200 bg-white text-slate-900"
          }`}
        >
          {error ?? (result || <span className="text-slate-400">翻訳結果がここに表示されます</span>)}
        </div>
      </div>

      {/* 辞書ヒット表示 */}
      {hints.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="mb-1 font-semibold text-amber-800">将棋辞書を適用しました</div>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-amber-900">
            {hints.map((h) => (
              <li key={h.jp} className="rounded bg-amber-100 px-2 py-0.5 text-xs">
                {h.jp} → {h.en}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-auto pt-6 text-center text-[11px] text-slate-400">
        将棋専門 + YouTubeタイトル対応 / Claude API
      </footer>
    </main>
  );
}
