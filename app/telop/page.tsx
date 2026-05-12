"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { TelopPreviewFrame } from "@/components/TelopPreviewFrame";
import { TelopStyleEditor } from "@/components/TelopStyleEditor";
import { DEFAULT_STYLE } from "@/lib/telop/defaults";
import { checkAll, wrapLines } from "@/lib/telop/quality";
import type { TelopProject, TelopSegment, TelopStyle } from "@/lib/telop/types";
import { toSrt } from "@/lib/video/srt";

const SAMPLE_SEGMENTS: TelopSegment[] = [
  {
    index: 0,
    startSec: 0,
    endSec: 3.4,
    jp: "今日は居飛車穴熊の仕掛けをご紹介します。",
    en: "Today I'll show you a Static Rook Anaguma attack.",
    hitTerms: [{ jp: "居飛車穴熊", en: "Static Rook Anaguma" }],
  },
  {
    index: 1,
    startSec: 3.5,
    endSec: 7.1,
    jp: "まず角を交換して、銀をぐいっと前に出します。",
    en: "First, trade bishops, then push the silver forward.",
    hitTerms: [
      { jp: "角", en: "Bishop" },
      { jp: "銀", en: "Silver General" },
    ],
  },
  {
    index: 2,
    startSec: 7.2,
    endSec: 9.8,
    jp: "ここで王手飛車取りが見えますね。",
    en: "Here you can see a fork on the king and rook.",
    hitTerms: [{ jp: "王手飛車取り", en: "Fork king and rook" }],
  },
  {
    index: 3,
    startSec: 9.9,
    endSec: 11.0,
    jp: "そして詰みです！",
    en: "And it's checkmate!",
    hitTerms: [{ jp: "詰み", en: "Checkmate" }],
    warning: "「！」を残すかは好み。海外向けは不要かも",
  },
];

type ImportedShape = TelopProject | { segments: TelopSegment[] };

function isProject(x: unknown): x is TelopProject {
  return (
    !!x &&
    typeof x === "object" &&
    (x as TelopProject).version === 1 &&
    Array.isArray((x as TelopProject).segments)
  );
}

function isSegmentArray(x: unknown): x is { segments: TelopSegment[] } {
  return !!x && typeof x === "object" && Array.isArray((x as { segments?: unknown }).segments);
}

export default function TelopPage() {
  const [style, setStyle] = useState<TelopStyle>(DEFAULT_STYLE);
  const [segments, setSegments] = useState<TelopSegment[]>(SAMPLE_SEGMENTS);
  const [activeIdx, setActiveIdx] = useState(0);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (bgUrl) URL.revokeObjectURL(bgUrl);
    };
  }, [bgUrl]);

  const active = segments[activeIdx] ?? null;
  const warnings = useMemo(() => checkAll(segments, style), [segments, style]);
  const warningsForActive = active ? warnings.filter((w) => w.index === active.index) : [];
  const totalWarn = warnings.length;

  function pickBackground(f: File | null) {
    if (!f) return;
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    setBgUrl(URL.createObjectURL(f));
  }

  function clearBackground() {
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    setBgUrl(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadText(filename: string, text: string, mime: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadSrt() {
    const srt = toSrt(
      segments.map((s) => ({
        index: s.index,
        startSec: s.startSec,
        endSec: s.endSec,
        text: wrapLines(s.en, style.maxLineChars).slice(0, style.maxLines).join("\n"),
      }))
    );
    downloadText("telop.srt", srt, "application/x-subrip");
  }

  function downloadProject() {
    const project: TelopProject = {
      version: 1,
      createdAt: new Date().toISOString(),
      style,
      segments,
    };
    downloadText("telop-project.json", JSON.stringify(project, null, 2), "application/json");
  }

  function tryImport() {
    setImportError(null);
    try {
      const parsed: unknown = JSON.parse(importText);
      let next: TelopSegment[] | null = null;
      let nextStyle: TelopStyle | null = null;
      if (isProject(parsed)) {
        next = parsed.segments;
        nextStyle = parsed.style;
      } else if (isSegmentArray(parsed)) {
        next = parsed.segments;
      } else if (Array.isArray(parsed)) {
        next = parsed as TelopSegment[];
      }
      if (!next || next.length === 0) throw new Error("セグメントが見つかりません");

      const validated: TelopSegment[] = next.map((s, i) => ({
        index: typeof s.index === "number" ? s.index : i,
        startSec: Number(s.startSec) || 0,
        endSec: Number(s.endSec) || 0,
        jp: String(s.jp ?? ""),
        en: String(s.en ?? ""),
        hitTerms: Array.isArray(s.hitTerms) ? s.hitTerms : [],
        warning: s.warning,
      }));
      setSegments(validated);
      if (nextStyle) setStyle(nextStyle);
      setActiveIdx(0);
      setImportOpen(false);
      setImportText("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "JSON が不正です");
    }
  }

  function loadSample() {
    setSegments(SAMPLE_SEGMENTS);
    setActiveIdx(0);
  }

  function updateActiveEn(en: string) {
    if (!active) return;
    setSegments((prev) => prev.map((s) => (s.index === active.index ? { ...s, en } : s)));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="btn-ghost -ml-2 inline-flex items-center gap-1.5">
          <Back /> Eigo
        </Link>
        <span className="chip">テロップ調整</span>
      </header>

      <div className="animate-fade-in flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          英語テロップを整える
        </h1>
        <p className="text-sm text-zinc-400">
          見え方・色・大きさを調整して、SRT と「テロッププロジェクト」を書き出します。
        </p>
      </div>

      {/* 操作ヘッダー */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={() => setImportOpen((o) => !o)}
          className="btn-secondary text-xs sm:text-sm"
        >
          字幕を読み込む
        </button>
        <button onClick={loadSample} className="btn-secondary text-xs sm:text-sm">
          サンプルに戻す
        </button>
        <label className="btn-secondary cursor-pointer text-xs sm:text-sm">
          背景画像を変える
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => pickBackground(e.target.files?.[0] ?? null)}
          />
        </label>
        {bgUrl && (
          <button onClick={clearBackground} className="btn-ghost text-xs">
            背景を戻す
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-zinc-500">
          字幕 {segments.length} 件
          {totalWarn > 0 && <span className="chip chip-warn">⚠ {totalWarn} 件</span>}
        </span>
      </div>

      {importOpen && (
        <div className="card animate-fade-in flex flex-col gap-2 p-4 text-sm">
          <p className="text-zinc-400">
            <code className="rounded bg-white/[0.06] px-1 text-zinc-200">/subtitle</code>{" "}
            や <code className="rounded bg-white/[0.06] px-1 text-zinc-200">/video</code>{" "}
            で作った字幕を JSON として貼り付けると読み込めます。
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder='{"segments":[{"index":0,"startSec":0,"endSec":3,"jp":"...","en":"...","hitTerms":[]}]}'
            className="field font-mono text-xs"
          />
          {importError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-2 text-xs text-rose-200">
              {importError}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={tryImport} className="btn-primary text-sm">
              読み込む
            </button>
            <button
              onClick={() => {
                setImportOpen(false);
                setImportText("");
                setImportError(null);
              }}
              className="btn-ghost text-sm"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* プレビュー */}
        <div className="flex flex-col gap-3 lg:col-span-3">
          <TelopPreviewFrame
            text={active?.en ?? ""}
            style={style}
            backgroundUrl={bgUrl}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
              disabled={activeIdx <= 0}
              className="btn-secondary text-sm disabled:opacity-40"
            >
              ◀ 前
            </button>
            <select
              value={activeIdx}
              onChange={(e) => setActiveIdx(Number(e.target.value))}
              className="flex-1 text-sm"
            >
              {segments.map((s, i) => (
                <option key={s.index} value={i}>
                  {fmtTime(s.startSec)} — {s.en.slice(0, 40) || "(空)"}
                </option>
              ))}
            </select>
            <button
              onClick={() => setActiveIdx((i) => Math.min(segments.length - 1, i + 1))}
              disabled={activeIdx >= segments.length - 1}
              className="btn-secondary text-sm disabled:opacity-40"
            >
              次 ▶
            </button>
          </div>

          {active && (
            <div className="card p-4 text-sm">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>
                  {fmtTime(active.startSec)} → {fmtTime(active.endSec)}（
                  {(active.endSec - active.startSec).toFixed(2)}秒）
                </span>
                <span>{active.en.length} 文字</span>
              </div>
              <div className="mt-1.5 text-xs text-zinc-400">日本語: {active.jp}</div>
              <textarea
                value={active.en}
                onChange={(e) => updateActiveEn(e.target.value)}
                rows={2}
                className="field mt-2 text-sm"
              />
              {warningsForActive.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-300/90">
                  {warningsForActive.map((w, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-2 py-1"
                    >
                      ⚠ {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button onClick={downloadSrt} className="btn-primary flex-1">
              SRT を書き出す（YouTube用）
            </button>
            <button onClick={downloadProject} className="btn-secondary flex-1">
              テロップ プロジェクトJSON
            </button>
          </div>

          <p className="text-[11px] text-zinc-500">
            プロジェクトJSONには字幕＋見た目（フォント／色／位置／背景）が全部入ります。
          </p>
        </div>

        {/* スタイル編集 */}
        <div className="lg:col-span-2">
          <TelopStyleEditor style={style} onChange={setStyle} />
        </div>
      </div>
    </main>
  );
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
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
