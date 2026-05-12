"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TelopRender } from "@/components/TelopRender";
import { TelopStyleEditor } from "@/components/TelopStyleEditor";
import { DEFAULT_STYLE } from "@/lib/telop/defaults";
import type { TelopSegment, TelopStyle, TelopWarning } from "@/lib/telop/types";
import type { ExtractedNoun, NounCategory } from "@/lib/video/nouns";
import type { ShogiTerm } from "@/lib/shogi-dictionary";
import { checkAll } from "@/lib/telop/quality";
import { toSrt } from "@/lib/video/srt";
import {
  Draft,
  VideoProject,
  applyProjectDefaults,
  clearDraft,
  isVideoProject,
  loadDraft,
  makeProject,
  projectToJsonBlob,
  safeFilename,
  saveDraft,
} from "@/lib/video/project";

type Step =
  | "input"
  | "downloading"
  | "transcribing"
  | "noun-check"
  | "translating"
  | "review"
  | "rendering"
  | "done";

const STEP_ORDER: Step[] = [
  "input",
  "downloading",
  "transcribing",
  "noun-check",
  "translating",
  "review",
  "rendering",
  "done",
];

const STEP_LABEL: Record<Step, string> = {
  input: "URL",
  downloading: "取り込み",
  transcribing: "書き起こし",
  "noun-check": "固有名詞確認",
  translating: "翻訳",
  review: "確認・編集",
  rendering: "焼き込み",
  done: "完成",
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoPage() {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState<TelopSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<{ srtUrl: string; mp4Url: string } | null>(
    null
  );
  const [style, setStyle] = useState<TelopStyle>(DEFAULT_STYLE);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasSourceVideo, setHasSourceVideo] = useState(true);
  const [draft, setDraftState] = useState<Draft | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [nouns, setNouns] = useState<ExtractedNoun[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = loadDraft();
    if (d) setDraftState(d);
  }, []);

  useEffect(() => {
    if (step !== "review" || !jobId) return;
    const proj = makeProject({
      jobId,
      youtubeUrl: url,
      videoTitle: title,
      durationSec: duration,
      style,
      segments,
    });
    saveDraft(proj);
  }, [step, jobId, url, title, duration, style, segments]);

  async function start() {
    setError(null);
    setOutputs(null);
    setInfo(null);
    setNouns([]);
    if (!url.trim()) return;

    try {
      setStep("downloading");
      const r1 = await fetch("/api/video/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error);
      setJobId(d1.jobId);
      setTitle(d1.title);
      setDuration(d1.durationSec);

      setStep("transcribing");
      const r2 = await fetch("/api/video/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: d1.jobId }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error);

      // 翻訳前に固有名詞を抽出して、ユーザーに確認してもらう
      setStep("noun-check");
      const rn = await fetch("/api/video/extract-nouns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: d1.jobId }),
      });
      const dn = await rn.json();
      if (!rn.ok) throw new Error(dn.error);
      setNouns((dn.nouns as ExtractedNoun[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("input");
    }
  }

  /** 固有名詞確認 → 翻訳を実行 */
  async function runTranslate() {
    if (!jobId) return;
    setError(null);
    try {
      const extraTerms: ShogiTerm[] = nouns
        .filter((n) => n.en && n.en.trim().length > 0)
        .map((n) => ({
          jp: n.jp,
          en: n.en.trim(),
          category:
            n.category === "person"
              ? "name"
              : n.category === "opening"
                ? "opening"
                : ("general" as const),
        }));

      setStep("translating");
      const r3 = await fetch("/api/video/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, extraTerms }),
      });
      const d3 = await r3.json();
      if (!r3.ok) throw new Error(d3.error);

      setSegments(d3.segments as TelopSegment[]);
      setHasSourceVideo(true);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("noun-check");
    }
  }

  function updateNoun(jp: string, en: string) {
    setNouns((prev) =>
      prev.map((n) => (n.jp === jp ? { ...n, en } : n))
    );
  }

  function updateEn(index: number, en: string) {
    setSegments((prev) => prev.map((s) => (s.index === index ? { ...s, en } : s)));
  }

  async function render() {
    if (!jobId || !hasSourceVideo) return;
    setError(null);
    setStep("rendering");
    try {
      const r = await fetch("/api/video/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          segments: segments.map((s) => ({
            index: s.index,
            startSec: s.startSec,
            endSec: s.endSec,
            en: s.en,
          })),
          style,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setOutputs({ srtUrl: d.srtUrl, mp4Url: d.mp4Url });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("review");
    }
  }

  function reset() {
    setStep("input");
    setUrl("");
    setJobId(null);
    setTitle("");
    setDuration(0);
    setSegments([]);
    setOutputs(null);
    setError(null);
    setStyle(DEFAULT_STYLE);
    setCurrentTime(0);
    setHasSourceVideo(true);
    setInfo(null);
    clearDraft();
    setDraftState(null);
  }

  async function resumeFromDraft(d: Draft) {
    setError(null);
    setInfo(null);
    if (!d.jobId) {
      enterReviewWithoutVideo(d);
      return;
    }
    const ok = await checkJob(d.jobId);
    if (!ok.exists || !ok.hasVideo) {
      setUrl(d.youtubeUrl ?? "");
      setInfo(
        "前回の動画ファイルが期限切れでした。同じURLで再生成すると動画プレビュー付きで続きから編集できます。"
      );
      return;
    }
    setJobId(d.jobId);
    setUrl(d.youtubeUrl ?? "");
    setTitle(d.videoTitle ?? "");
    setDuration(d.durationSec ?? 0);
    setStyle(applyProjectDefaults(d).style);
    setSegments(d.segments);
    setHasSourceVideo(true);
    setStep("review");
  }

  function enterReviewWithoutVideo(p: VideoProject) {
    setJobId(p.jobId ?? null);
    setUrl(p.youtubeUrl ?? "");
    setTitle(p.videoTitle ?? "");
    setDuration(p.durationSec ?? 0);
    setStyle(applyProjectDefaults(p).style);
    setSegments(p.segments);
    setHasSourceVideo(false);
    setInfo(
      "動画ファイルは利用できません（プレビュー再生・MP4焼き込み不可）。SRTの書き出しと編集は可能です。"
    );
    setStep("review");
  }

  async function openFromFile(file: File) {
    setError(null);
    setInfo(null);
    try {
      const text = await file.text();
      const v = JSON.parse(text);
      if (!isVideoProject(v)) {
        setError("このファイルは保存ファイルとして認識できません。");
        return;
      }
      const p = applyProjectDefaults(v as VideoProject);
      if (p.jobId) {
        const ok = await checkJob(p.jobId);
        if (ok.exists && ok.hasVideo) {
          setJobId(p.jobId);
          setUrl(p.youtubeUrl ?? "");
          setTitle(p.videoTitle ?? "");
          setDuration(p.durationSec ?? 0);
          setStyle(p.style);
          setSegments(p.segments);
          setHasSourceVideo(true);
          setStep("review");
          return;
        }
      }
      enterReviewWithoutVideo(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ファイルを読み込めませんでした");
    }
  }

  function downloadProject() {
    if (!segments.length) return;
    const proj = makeProject({
      jobId,
      youtubeUrl: url,
      videoTitle: title,
      durationSec: duration,
      style,
      segments,
    });
    const blob = projectToJsonBlob(proj);
    const a = document.createElement("a");
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = safeFilename(title);
    a.click();
    URL.revokeObjectURL(objUrl);
  }

  function downloadSrt() {
    if (!segments.length) return;
    const srt = toSrt(
      segments.map((s) => ({
        index: s.index,
        startSec: s.startSec,
        endSec: s.endSec,
        text: s.en,
      }))
    );
    const blob = new Blob([srt], { type: "text/plain; charset=utf-8" });
    const a = document.createElement("a");
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = "english-subtitles.srt";
    a.click();
    URL.revokeObjectURL(objUrl);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8 sm:py-12">
      <header className="flex items-center justify-between">
        <Link href="/" className="btn-ghost -ml-2 inline-flex items-center gap-1.5">
          <Back /> Eigo
        </Link>
        <span className="chip">動画字幕</span>
      </header>

      <div className="animate-fade-in flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          動画字幕をつくる
        </h1>
        <p className="text-sm text-zinc-400">
          YouTube URL → 書き起こし → 翻訳 → テロップ → 完成MP4。
        </p>
      </div>

      <Stepper step={step} />

      {error && (
        <div className="animate-fade rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      {info && (
        <div className="animate-fade rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-4 py-3 text-sm text-sky-200">
          {info}
        </div>
      )}

      {step === "input" && (
        <InputSection
          url={url}
          setUrl={setUrl}
          draft={draft}
          onResume={resumeFromDraft}
          onClearDraft={() => {
            clearDraft();
            setDraftState(null);
          }}
          onStart={start}
          onOpenFile={() => fileInputRef.current?.click()}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFromFile(f);
          e.target.value = "";
        }}
      />

      {(step === "downloading" ||
        step === "transcribing" ||
        step === "translating" ||
        step === "rendering") && <ProcessingState step={step} />}

      {step === "noun-check" && (
        <NounCheckSection
          nouns={nouns}
          onChange={updateNoun}
          onConfirm={runTranslate}
          onCancel={() => setStep("input")}
        />
      )}

      {step === "review" && (
        <ReviewSection
          jobId={jobId}
          title={title}
          duration={duration}
          segments={segments}
          style={style}
          hasSourceVideo={hasSourceVideo}
          onStyleChange={setStyle}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          onEditEn={updateEn}
          onRender={render}
          onReset={reset}
          onSaveProject={downloadProject}
          onSaveSrt={downloadSrt}
        />
      )}

      {step === "done" && outputs && (
        <DoneSection
          outputs={outputs}
          onSaveProject={downloadProject}
          onReset={reset}
        />
      )}
    </main>
  );
}

/* ===================== Stepper ===================== */

function Stepper({ step }: { step: Step }) {
  const curIdx = STEP_ORDER.indexOf(step);
  return (
    <ol className="flex w-full items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2">
      {STEP_ORDER.map((s, i) => {
        const sIdx = i;
        const done = sIdx < curIdx;
        const active = sIdx === curIdx;
        return (
          <li key={s} className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors duration-300 sm:h-7 sm:w-7 sm:text-xs ${
                active
                  ? "bg-white text-zinc-950"
                  : done
                  ? "bg-violet-500/20 text-violet-200"
                  : "bg-white/[0.04] text-zinc-600"
              }`}
            >
              {done ? <Check /> : i + 1}
            </span>
            <span
              className={`text-[11px] sm:text-xs ${
                active ? "font-medium text-white" : "text-zinc-500"
              }`}
            >
              {STEP_LABEL[s]}
            </span>
            {i < STEP_ORDER.length - 1 && (
              <span
                aria-hidden
                className={`mx-1 h-px w-4 transition-colors duration-300 sm:w-8 ${
                  done ? "bg-violet-500/40" : "bg-white/10"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ===================== Input ===================== */

function InputSection({
  url,
  setUrl,
  draft,
  onResume,
  onClearDraft,
  onStart,
  onOpenFile,
}: {
  url: string;
  setUrl: (v: string) => void;
  draft: Draft | null;
  onResume: (d: Draft) => void;
  onClearDraft: () => void;
  onStart: () => void;
  onOpenFile: () => void;
}) {
  return (
    <div className="animate-fade-in flex flex-col gap-6">
      {draft && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-emerald-300">💾</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-emerald-100">
                前回の編集が残っています
              </div>
              {draft.videoTitle && (
                <div className="mt-0.5 truncate text-xs text-emerald-200/70">
                  {draft.videoTitle}　·　セグメント {draft.segments.length} 個
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => onResume(draft)}
                className="rounded-lg bg-emerald-500/90 px-3.5 py-1.5 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
              >
                続きから
              </button>
              <button onClick={onClearDraft} className="btn-ghost">
                消す
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card flex flex-col gap-5 p-6 sm:p-8">
        <div>
          <label className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            YouTube URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="field mt-2 text-base"
          />
          <p className="mt-2 text-xs text-zinc-500">
            公開動画のみ。今のバージョンは 10 分以内推奨。
          </p>
        </div>
        <button
          onClick={onStart}
          disabled={!url.trim()}
          className="btn-primary inline-flex items-center justify-center gap-2"
        >
          字幕を作りはじめる <Arrow />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="hairline flex-1" />
        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-600">or</span>
        <div className="hairline flex-1" />
      </div>

      <button
        onClick={onOpenFile}
        className="surface surface-hover flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm font-medium text-zinc-300"
      >
        <FolderIcon />
        保存したプロジェクトファイル（.json）を開く
      </button>
    </div>
  );
}

/* ===================== Processing ===================== */

function ProcessingState({ step }: { step: Step }) {
  const labels: Record<string, string> = {
    downloading: "動画を取り込んでいます",
    transcribing: "日本語を書き起こしています",
    translating: "英語に翻訳しています",
    rendering: "動画に焼き付けています",
  };
  return (
    <div className="animate-fade-in card flex flex-col items-center justify-center gap-4 px-6 py-16">
      <div className="relative h-14 w-14">
        <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/30" />
        <span className="absolute inset-1 rounded-full border-2 border-white/10 border-t-white/80 animate-spin" />
      </div>
      <div className="text-base font-medium text-white">{labels[step] ?? "処理中"}</div>
      <p className="text-center text-xs text-zinc-500">
        5分動画でだいたい1〜3分。閉じずにお待ちください。
      </p>
    </div>
  );
}

/* ===================== Noun check ===================== */

const NOUN_CAT_LABEL: Record<NounCategory, string> = {
  person: "🧑 棋士名",
  opening: "🎯 戦法・囲い",
  tournament: "🏆 棋戦",
  title: "🎖 段位・称号",
  term: "📖 将棋用語",
};

const NOUN_CAT_ORDER: NounCategory[] = [
  "person",
  "title",
  "opening",
  "tournament",
  "term",
];

function NounCheckSection({
  nouns,
  onChange,
  onConfirm,
  onCancel,
}: {
  nouns: ExtractedNoun[];
  onChange: (jp: string, en: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const grouped = NOUN_CAT_ORDER.map((cat) => ({
    cat,
    items: nouns.filter((n) => n.category === cat),
  })).filter((g) => g.items.length > 0);

  const unknown = nouns.filter((n) => !n.en.trim());
  const hasUnknown = unknown.length > 0;

  return (
    <div className="animate-fade-in card flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-white">
          固有名詞を確認してください
        </h2>
        <p className="text-xs text-zinc-400 leading-relaxed">
          棋士名・戦法名・棋戦名・段位を翻訳の前に確認します。日本将棋連盟の公式英語表記を優先してください。
          <span className="text-rose-300">不明な項目（赤）が残っていると翻訳できません。</span>
        </p>
      </div>

      {nouns.length === 0 ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-center text-sm text-zinc-400">
          固有名詞は検出されませんでした。そのまま翻訳に進めます。
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((g) => (
            <div key={g.cat} className="flex flex-col gap-2">
              <div className="text-xs font-medium text-zinc-300">
                {NOUN_CAT_LABEL[g.cat]}
              </div>
              <ul className="flex flex-col divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] bg-white/[0.02]">
                {g.items.map((n) => {
                  const empty = !n.en.trim();
                  return (
                    <li
                      key={n.jp}
                      className={`grid grid-cols-12 items-center gap-3 px-4 py-3 ${
                        empty
                          ? "bg-rose-500/[0.06]"
                          : n.source === "ai-uncertain"
                            ? "bg-amber-500/[0.04]"
                            : ""
                      }`}
                    >
                      <div className="col-span-12 sm:col-span-4 text-sm text-zinc-100">
                        {n.jp}
                      </div>
                      <div className="col-span-12 sm:col-span-6">
                        <input
                          type="text"
                          value={n.en}
                          onChange={(e) => onChange(n.jp, e.target.value)}
                          placeholder={
                            empty ? "英語表記を入力してください" : ""
                          }
                          className={`w-full rounded-md border bg-white/[0.02] px-3 py-1.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500/40 focus:bg-white/[0.04] ${
                            empty
                              ? "border-rose-500/40"
                              : "border-white/[0.06]"
                          }`}
                        />
                      </div>
                      <div className="col-span-12 sm:col-span-2 text-[10px]">
                        {n.source === "dictionary" && (
                          <span className="rounded bg-emerald-500/[0.12] px-1.5 py-0.5 text-emerald-200">
                            ✓ 辞書
                          </span>
                        )}
                        {n.source === "ai-confident" && (
                          <span className="rounded bg-sky-500/[0.12] px-1.5 py-0.5 text-sky-200">
                            AI 自信あり
                          </span>
                        )}
                        {n.source === "ai-uncertain" && (
                          <span className="rounded bg-amber-500/[0.12] px-1.5 py-0.5 text-amber-200">
                            ? 要確認
                          </span>
                        )}
                        {n.source === "unknown" && (
                          <span className="rounded bg-rose-500/[0.18] px-1.5 py-0.5 text-rose-200">
                            ! 未確定
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {hasUnknown && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.05] px-4 py-3 text-sm text-rose-200">
          まだ {unknown.length} 件、英語表記が空です。すべて入力するか、辞書照合できる別の表記に直してから翻訳に進んでください。
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onCancel}
          className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.04]"
        >
          ← 最初に戻る
        </button>
        <button
          onClick={onConfirm}
          disabled={hasUnknown}
          className="btn-primary rounded-lg px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          この内容で翻訳を開始 →
        </button>
      </div>
    </div>
  );
}

/* ===================== Done ===================== */

function DoneSection({
  outputs,
  onSaveProject,
  onReset,
}: {
  outputs: { srtUrl: string; mp4Url: string };
  onSaveProject: () => void;
  onReset: () => void;
}) {
  return (
    <div className="animate-fade-in flex flex-col gap-4">
      <div className="card relative overflow-hidden p-8">
        <div className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-gradient-to-b from-emerald-400/30 to-transparent blur-3xl" />
        <div className="relative">
          <span className="chip chip-ok">DONE</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            完成しました
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            下のボタンからダウンロードしてください。
          </p>
        </div>
      </div>

      <a href={outputs.mp4Url} className="btn-primary inline-flex items-center justify-center gap-2">
        <DownloadIcon /> 字幕付き動画（MP4）をダウンロード
      </a>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <a href={outputs.srtUrl} className="btn-secondary text-center">
          字幕ファイル（SRT）
        </a>
        <button onClick={onSaveProject} className="btn-secondary">
          プロジェクトを保存
        </button>
      </div>
      <button onClick={onReset} className="btn-ghost mt-2 self-center">
        次の動画を作る →
      </button>
    </div>
  );
}

/* ===================== Review Section ===================== */

function ReviewSection(props: {
  jobId: string | null;
  title: string;
  duration: number;
  segments: TelopSegment[];
  style: TelopStyle;
  hasSourceVideo: boolean;
  onStyleChange: (s: TelopStyle) => void;
  currentTime: number;
  onTimeChange: (t: number) => void;
  onEditEn: (index: number, en: string) => void;
  onRender: () => void;
  onReset: () => void;
  onSaveProject: () => void;
  onSaveSrt: () => void;
}) {
  const {
    jobId,
    title,
    duration,
    segments,
    style,
    hasSourceVideo,
    onStyleChange,
    currentTime,
    onTimeChange,
    onEditEn,
    onRender,
    onReset,
    onSaveProject,
    onSaveSrt,
  } = props;

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(800);

  useLayoutEffect(() => {
    if (!previewBoxRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) setPreviewWidth(w);
      }
    });
    ro.observe(previewBoxRef.current);
    return () => ro.disconnect();
  }, []);

  const activeSegment = useMemo(
    () =>
      segments.find((s) => currentTime >= s.startSec && currentTime <= s.endSec) ??
      null,
    [currentTime, segments]
  );

  const warnings: TelopWarning[] = useMemo(
    () => checkAll(segments, style),
    [segments, style]
  );
  const warningByIndex = useMemo(() => {
    const m = new Map<number, TelopWarning[]>();
    for (const w of warnings) {
      if (!m.has(w.index)) m.set(w.index, []);
      m.get(w.index)!.push(w);
    }
    return m;
  }, [warnings]);

  const seekTo = useCallback((sec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = sec;
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const previewSegment = hasSourceVideo ? activeSegment : segments[0] ?? null;

  return (
    <div className="animate-fade-in flex flex-col gap-5">
      {/* Meta strip */}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            取り込んだ動画
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-white">
            {title || "(無題)"}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <span>{fmtTime(duration)}</span>
          <span className="h-3 w-px bg-white/10" />
          <span>{segments.length} セグメント</span>
          {warnings.length > 0 && (
            <>
              <span className="h-3 w-px bg-white/10" />
              <span className="chip chip-warn">⚠ 要確認 {warnings.length}</span>
            </>
          )}
        </div>
      </div>

      {/* Preview - sticky on mobile, normal on desktop */}
      <div className="sticky top-0 z-20 -mx-6 bg-zinc-950/85 px-6 py-3 backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:p-0">
        <div
          ref={previewBoxRef}
          className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]"
        >
          {hasSourceVideo && jobId ? (
            <video
              ref={videoRef}
              src={`/api/video/file?jobId=${jobId}&kind=source`}
              controls
              preload="metadata"
              playsInline
              className="absolute inset-0 h-full w-full"
              onTimeUpdate={(e) => onTimeChange(e.currentTarget.currentTime)}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-zinc-400">
              <div className="text-2xl opacity-60">🎬</div>
              <div>動画ファイルなしモード</div>
              <div className="text-[11px] text-zinc-600">
                テロップ調整・編集・SRT書き出しのみ可能
              </div>
            </div>
          )}
          {previewSegment && previewSegment.en && (
            <TelopRender
              text={previewSegment.en}
              style={style}
              containerWidth={previewWidth}
              countdownValue={
                previewSegment.kind === "countdown"
                  ? previewSegment.countdownValue
                  : undefined
              }
            />
          )}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          {hasSourceVideo
            ? "再生位置の字幕が、焼き込み後とほぼ同じ見た目で重ねて表示されます。"
            : "1つ目のセグメントで見た目だけ確認しています。"}
        </p>
      </div>

      {/* Style editor */}
      <TelopStyleEditor style={style} onChange={onStyleChange} />

      {/* Segment list */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            セグメント
          </span>
          <span className="text-[11px] text-zinc-500">
            時間 → ジャンプ／英語は直接編集
          </span>
        </div>
        <ul className="divide-y divide-white/[0.04]">
          {segments.map((s) => {
            const isActive = activeSegment?.index === s.index;
            const segWarnings = warningByIndex.get(s.index) ?? [];
            const hasWarn = segWarnings.length > 0;
            return (
              <li
                key={s.index}
                className={`grid grid-cols-12 gap-3 px-5 py-4 transition-colors duration-200 ${
                  isActive
                    ? "bg-violet-500/[0.06]"
                    : hasWarn
                    ? "bg-amber-500/[0.03]"
                    : "hover:bg-white/[0.02]"
                }`}
              >
                <button
                  onClick={() => seekTo(s.startSec)}
                  disabled={!hasSourceVideo}
                  className={`col-span-2 self-start text-left text-xs font-mono transition sm:col-span-1 ${
                    hasSourceVideo
                      ? "text-zinc-400 hover:text-white"
                      : "text-zinc-600"
                  }`}
                  title={hasSourceVideo ? "この場面を再生" : "動画がないため再生不可"}
                >
                  {fmtTime(s.startSec)}
                </button>
                <div className="col-span-10 sm:col-span-5">
                  <div className="text-sm leading-relaxed text-zinc-300">
                    {s.kind === "countdown" && (
                      <span className="mr-2 inline-block rounded-md bg-rose-500/[0.15] px-1.5 py-0.5 align-middle text-[10px] font-bold text-rose-200">
                        🕐 秒読み {s.countdownValue}
                      </span>
                    )}
                    {highlightTerms(s.jp, s.hitTerms.map((t) => t.jp))}
                  </div>
                  {s.hitTerms.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.hitTerms.map((t) => (
                        <span
                          key={t.jp}
                          className="rounded-md bg-violet-500/[0.08] px-1.5 py-0.5 text-[10px] text-violet-200"
                        >
                          {t.jp}
                          <span className="mx-1 text-violet-400/60">→</span>
                          {t.en}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-span-12 sm:col-span-6">
                  <textarea
                    value={s.en}
                    onChange={(e) => onEditEn(s.index, e.target.value)}
                    rows={2}
                    className={`w-full resize-none rounded-lg border bg-white/[0.02] px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none transition focus:border-violet-500/40 focus:bg-white/[0.04] ${
                      hasWarn ? "border-amber-500/30" : "border-white/[0.06]"
                    }`}
                  />
                  {segWarnings.map((w, i) => (
                    <div key={i} className="mt-1 text-[11px] text-amber-300/80">
                      ⚠ {w.message}
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Actions */}
      <div className="card flex flex-col gap-3 p-5 sm:p-6">
        <button
          onClick={onRender}
          disabled={!hasSourceVideo}
          className="btn-primary inline-flex items-center justify-center gap-2"
        >
          <BurnIcon />
          この内容で動画に焼き付ける
        </button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button onClick={onSaveSrt} className="btn-secondary inline-flex items-center justify-center gap-1.5">
            <FileIcon /> SRT を書き出す
          </button>
          <button onClick={onSaveProject} className="btn-secondary inline-flex items-center justify-center gap-1.5">
            <SaveIcon /> プロジェクトを保存
          </button>
          <button onClick={onReset} className="btn-ghost text-center">
            最初から
          </button>
        </div>
        <p className="text-[11px] text-zinc-600">
          編集中の内容は、このパソコンに自動下書き保存されます。
        </p>
      </div>
    </div>
  );
}

/* ===================== Utils ===================== */

async function checkJob(jobId: string): Promise<{
  exists: boolean;
  hasVideo: boolean;
  hasOutput: boolean;
}> {
  try {
    const r = await fetch(`/api/video/check?jobId=${encodeURIComponent(jobId)}`);
    return await r.json();
  } catch {
    return { exists: false, hasVideo: false, hasOutput: false };
  }
}

function highlightTerms(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map(escapeRe).join("|")})`, "g");
  const parts = text.split(pattern);
  return parts.map((p, i) =>
    sorted.includes(p) ? (
      <mark
        key={i}
        className="rounded bg-violet-500/[0.15] px-0.5 text-violet-100"
      >
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ===================== Icons ===================== */

function Back() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16l-5-6 5-6" />
    </svg>
  );
}
function Arrow() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 10h12m0 0l-5-5m5 5l-5 5" />
    </svg>
  );
}
function Check() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.4} className="h-3.5 w-3.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l3.5 3.5L15 6.5" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h3.5l2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" />
    </svg>
  );
}
function BurnIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l3 4-1 4a4 4 0 008 0 6 6 0 00-3-5l-1 2c-.5-2-3-3-3-3a8 8 0 012 8 8 8 0 11-5-10z" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
    </svg>
  );
}
function SaveIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h11l3 3v12a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v5h8V3M7 21v-7h10v7" />
    </svg>
  );
}
