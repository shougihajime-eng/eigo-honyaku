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
import type { VideoBriefing, BriefingSpeaker } from "@/lib/video/briefing";
import { EMPTY_BRIEFING } from "@/lib/video/briefing";

type RawSegment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
};
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
  | "transcript-check"
  | "noun-check"
  | "translating"
  | "review"
  | "rendering"
  | "done";

const STEP_ORDER: Step[] = [
  "input",
  "downloading",
  "transcribing",
  "transcript-check",
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
  "transcript-check": "書き起こし確認",
  "noun-check": "動画ぜんたい確認",
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
  const [transcriptSegs, setTranscriptSegs] = useState<RawSegment[]>([]);
  const [briefing, setBriefing] = useState<VideoBriefing | null>(null);
  const [translateProgress, setTranslateProgress] = useState<{
    translate: { done: number; total: number };
    review: { done: number; total: number };
    back: { done: number; total: number };
  }>({
    translate: { done: 0, total: 0 },
    review: { done: 0, total: 0 },
    back: { done: 0, total: 0 },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 編集履歴（Undo/Redo）。setSegments を直接呼んだ場合は履歴に積まれない。
  // ユーザー編集は commitEdit / pushHistory を経由する。
  const historyRef = useRef<TelopSegment[][]>([]);
  const futureRef = useRef<TelopSegment[][]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  const pushHistory = useCallback(
    (snapshot: TelopSegment[]) => {
      historyRef.current.push(snapshot);
      if (historyRef.current.length > 100) historyRef.current.shift();
      futureRef.current = [];
      bumpHistory();
    },
    [bumpHistory]
  );

  const undo = useCallback(() => {
    const last = historyRef.current.pop();
    if (!last) return;
    setSegments((prev) => {
      futureRef.current.push(prev);
      return last;
    });
    bumpHistory();
  }, [bumpHistory]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    setSegments((prev) => {
      historyRef.current.push(prev);
      return next;
    });
    bumpHistory();
  }, [bumpHistory]);

  const canUndo = historyRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  void historyVersion;

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
    setTranscriptSegs([]);
    setBriefing(null);
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
      setTranscriptSegs((d2.segments as RawSegment[]) ?? []);
      // 書き起こしを動画と一緒に確認してもらう
      setStep("transcript-check");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("input");
    }
  }

  /** 書き起こし確認 → 保存 → 固有名詞抽出と動画ぜんたい下調べを並列実行 */
  async function confirmTranscript() {
    if (!jobId) return;
    setError(null);
    try {
      const r = await fetch("/api/video/save-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, segments: transcriptSegs }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      setStep("noun-check");
      // 固有名詞抽出と動画ぜんたい下調べを並列で取りに行く（待ち時間半減）
      const [nounsRes, briefRes] = await Promise.allSettled([
        fetch("/api/video/extract-nouns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        }).then((r) => r.json()),
        fetch("/api/video/brief", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        }).then((r) => r.json()),
      ]);
      if (nounsRes.status === "fulfilled" && !nounsRes.value.error) {
        setNouns((nounsRes.value.nouns as ExtractedNoun[]) ?? []);
      } else if (nounsRes.status === "fulfilled" && nounsRes.value.error) {
        throw new Error(nounsRes.value.error);
      }
      if (briefRes.status === "fulfilled" && !briefRes.value.error) {
        setBriefing(
          (briefRes.value.briefing as VideoBriefing) ?? EMPTY_BRIEFING
        );
      } else {
        // briefing 失敗時は翻訳自体は続行可能なので致命扱いしない
        setBriefing(EMPTY_BRIEFING);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("transcript-check");
    }
  }

  function updateTranscriptJp(index: number, jp: string) {
    setTranscriptSegs((prev) =>
      prev.map((s) => (s.index === index ? { ...s, jp } : s))
    );
  }

  /** 固有名詞確認 → 学習保存 → 翻訳を実行 */
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

      // 学習辞書に保存（失敗しても翻訳は進める）
      try {
        await fetch("/api/dictionary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entries: extraTerms.map((t) => ({
              jp: t.jp,
              en: t.en,
              category: t.category,
            })),
          }),
        });
      } catch {
        // noop
      }

      setStep("translating");
      setTranslateProgress({
        translate: { done: 0, total: 0 },
        review: { done: 0, total: 0 },
        back: { done: 0, total: 0 },
      });

      const r3 = await fetch("/api/video/translate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, extraTerms, briefing }),
      });
      if (!r3.ok || !r3.body) {
        const errText = await r3.text();
        throw new Error(errText || "翻訳ストリームを開けませんでした");
      }

      const reader = r3.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalSegments: TelopSegment[] | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const evt = JSON.parse(trimmed);
            if (evt.type === "phase") {
              setTranslateProgress((prev) => {
                const next = { ...prev };
                if (evt.phase === "translate") {
                  next.translate = { done: evt.done, total: evt.total };
                } else if (evt.phase === "review") {
                  next.review = { done: evt.done, total: evt.total };
                } else if (evt.phase === "back-translate") {
                  next.back = { done: evt.done, total: evt.total };
                }
                return next;
              });
            } else if (evt.type === "partial") {
              setSegments(evt.segments as TelopSegment[]);
            } else if (evt.type === "done") {
              finalSegments = evt.segments as TelopSegment[];
            } else if (evt.type === "error") {
              throw new Error(evt.message);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue; // partial line
            throw e;
          }
        }
      }

      if (!finalSegments) throw new Error("翻訳結果が返ってきませんでした");
      setSegments(finalSegments);
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

  function updateBriefing(patch: Partial<VideoBriefing>) {
    setBriefing((prev) => ({ ...(prev ?? EMPTY_BRIEFING), ...patch }));
  }

  function updateEn(index: number, en: string) {
    setSegments((prev) => {
      pushHistory(prev);
      return prev.map((s) => (s.index === index ? { ...s, en } : s));
    });
  }

  function bulkReplace(find: string, replace: string, caseSensitive: boolean) {
    if (!find) return 0;
    let count = 0;
    const flags = caseSensitive ? "g" : "gi";
    const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escapedFind, flags);
    setSegments((prev) => {
      pushHistory(prev);
      return prev.map((s) => {
        if (!s.en) return s;
        const newEn = s.en.replace(re, () => {
          count++;
          return replace;
        });
        return newEn === s.en ? s : { ...s, en: newEn };
      });
    });
    return count;
  }

  function countMatches(find: string, caseSensitive: boolean): number {
    if (!find) return 0;
    const flags = caseSensitive ? "g" : "gi";
    const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escapedFind, flags);
    return segments.reduce((sum, s) => {
      if (!s.en) return sum;
      const matches = s.en.match(re);
      return sum + (matches ? matches.length : 0);
    }, 0);
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
        step === "rendering") && <ProcessingState step={step} />}

      {step === "translating" && (
        <TranslateProgressView progress={translateProgress} />
      )}

      {step === "transcript-check" && jobId && (
        <TranscriptCheckSection
          jobId={jobId}
          title={title}
          segments={transcriptSegs}
          onEditJp={updateTranscriptJp}
          onConfirm={confirmTranscript}
          onCancel={() => setStep("input")}
        />
      )}

      {step === "noun-check" && (
        <NounCheckSection
          nouns={nouns}
          briefing={briefing}
          onBriefingChange={updateBriefing}
          onChange={updateNoun}
          onConfirm={runTranslate}
          onCancel={() => setStep("transcript-check")}
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
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onBulkReplace={bulkReplace}
          countMatches={countMatches}
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

/* ===================== Find & Replace modal ===================== */

function FindReplaceModal({
  onClose,
  onReplace,
  countMatches,
}: {
  onClose: () => void;
  onReplace: (find: string, replace: string, caseSensitive: boolean) => number;
  countMatches: (find: string, caseSensitive: boolean) => number;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matchCount = useMemo(
    () => countMatches(find, caseSensitive),
    [find, caseSensitive, countMatches]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-md p-5 sm:p-6 animate-fade-in">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">検索・一括置換</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              検索する英語
            </span>
            <input
              ref={findInputRef}
              type="text"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="例：Suzuki Hajime"
              className="field text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              置き換える英語
            </span>
            <input
              type="text"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="例：Hajime Suzuki"
              className="field text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/[0.04]"
            />
            大文字・小文字を区別する
          </label>

          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
            {find ? (
              matchCount > 0 ? (
                <span>
                  <span className="font-semibold text-violet-300">{matchCount}</span> 件マッチします
                </span>
              ) : (
                <span className="text-zinc-500">マッチなし</span>
              )
            ) : (
              <span className="text-zinc-500">検索する英語を入力してください</span>
            )}
          </div>

          <div className="mt-1 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-white/[0.06] bg-white/[0.02] px-4 py-1.5 text-sm text-zinc-300 hover:bg-white/[0.06]"
            >
              キャンセル
            </button>
            <button
              onClick={() => {
                const n = onReplace(find, replace, caseSensitive);
                if (n > 0) onClose();
              }}
              disabled={!find || matchCount === 0}
              className="btn-primary rounded-md px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              全部置き換える
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================== Translate progress ===================== */

function TranslateProgressView({
  progress,
}: {
  progress: {
    translate: { done: number; total: number };
    review: { done: number; total: number };
    back: { done: number; total: number };
  };
}) {
  const rows: { label: string; emoji: string; done: number; total: number; color: string }[] = [
    {
      label: "翻訳",
      emoji: "✍️",
      done: progress.translate.done,
      total: progress.translate.total,
      color: "from-violet-500 to-fuchsia-400",
    },
    {
      label: "校閲",
      emoji: "🔍",
      done: progress.review.done,
      total: progress.review.total,
      color: "from-sky-500 to-cyan-400",
    },
    {
      label: "逆翻訳チェック",
      emoji: "🔄",
      done: progress.back.done,
      total: progress.back.total,
      color: "from-emerald-500 to-lime-400",
    },
  ];

  return (
    <div className="animate-fade-in card flex flex-col gap-5 px-6 py-8 sm:px-8">
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10">
          <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/30" />
          <span className="absolute inset-1 animate-spin rounded-full border-2 border-white/10 border-t-white/80" />
        </div>
        <div>
          <div className="text-base font-medium text-white">英語に翻訳しています</div>
          <p className="text-xs text-zinc-500">
            並列処理＋ストリーミング。出来た所からどんどん表示されます。
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {rows.map((r) => {
          const pct = r.total > 0 ? Math.min(100, (r.done / r.total) * 100) : 0;
          const isComplete = r.total > 0 && r.done >= r.total;
          const isActive = r.total > 0 && !isComplete;
          return (
            <div key={r.label} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className={`flex items-center gap-1.5 font-medium ${isActive ? "text-white" : "text-zinc-400"}`}>
                  <span>{r.emoji}</span>
                  {r.label}
                </span>
                <span className={`tabular-nums ${isComplete ? "text-emerald-300" : "text-zinc-500"}`}>
                  {isComplete ? "完了" : r.total > 0 ? `${r.done} / ${r.total}` : "待機中…"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.04]">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${r.color} transition-all duration-500 ease-out`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== Transcript check ===================== */

function TranscriptCheckSection({
  jobId,
  title,
  segments,
  onEditJp,
  onConfirm,
  onCancel,
}: {
  jobId: string;
  title: string;
  segments: RawSegment[];
  onEditJp: (index: number, jp: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const videoUrl = `/api/video/file?jobId=${jobId}&kind=source`;

  useEffect(() => {
    const found = segments.find((s) => now >= s.startSec && now < s.endSec);
    if (found && found.index !== activeIndex) setActiveIndex(found.index);
  }, [now, segments, activeIndex]);

  function seekTo(sec: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    v.play().catch(() => {});
  }

  return (
    <div className="animate-fade-in flex flex-col gap-5">
      <div className="card flex flex-col gap-3 p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-white">
            書き起こしを確認してください
          </h2>
          <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
            動画を再生しながら、聞こえた日本語と合っているか確認してください。
            <span className="text-amber-300">
              ここで直すと、その後の翻訳が一気に正確になります。
            </span>
            棋士名・戦法・専門用語は特に注意。
          </p>
        </div>
        {title && (
          <div className="text-xs text-zinc-500 break-words">{title}</div>
        )}

        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            preload="metadata"
            playsInline
            className="absolute inset-0 h-full w-full"
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="border-b border-white/[0.06] px-5 py-3 text-xs text-zinc-400">
          {segments.length} 個のセグメント。再生位置のセグメントが自動でハイライトされます。
        </div>
        <ul className="divide-y divide-white/[0.04]">
          {segments.map((s) => {
            const isActive = activeIndex === s.index;
            return (
              <li
                key={s.index}
                className={`grid grid-cols-12 gap-3 px-5 py-3 transition-colors ${
                  isActive ? "bg-violet-500/[0.08]" : "hover:bg-white/[0.02]"
                }`}
              >
                <button
                  onClick={() => seekTo(s.startSec)}
                  className="col-span-3 self-start text-left text-xs font-mono text-zinc-400 transition hover:text-white sm:col-span-2"
                  title="この場面から再生"
                >
                  ▶ {fmtTime(s.startSec)}
                </button>
                <div className="col-span-9 sm:col-span-10">
                  <textarea
                    value={s.jp}
                    onChange={(e) => onEditJp(s.index, e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none transition focus:border-violet-500/40 focus:bg-white/[0.04]"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onCancel}
          className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.04]"
        >
          ← 最初に戻る
        </button>
        <button
          onClick={onConfirm}
          className="btn-primary rounded-lg px-5 py-2 text-sm"
        >
          この書き起こしで進む →
        </button>
      </div>
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
  briefing,
  onBriefingChange,
  onChange,
  onConfirm,
  onCancel,
}: {
  nouns: ExtractedNoun[];
  briefing: VideoBriefing | null;
  onBriefingChange: (patch: Partial<VideoBriefing>) => void;
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
    <div className="animate-fade-in flex flex-col gap-5">
      <BriefingEditor briefing={briefing} onChange={onBriefingChange} />

      <div className="card flex flex-col gap-5 p-5 sm:p-6">
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
    </div>
  );
}

/* ===================== Briefing editor ===================== */

const TONE_OPTIONS: { value: string; label: string }[] = [
  { value: "casual-youtube", label: "気軽なYouTube解説" },
  { value: "formal-commentary", label: "プロ解説（落ち着き）" },
  { value: "educational", label: "講座・初心者向け" },
  { value: "excited", label: "熱戦・盛り上がり" },
  { value: "calm-analysis", label: "静かな研究・読み筋" },
];

function BriefingEditor({
  briefing,
  onChange,
}: {
  briefing: VideoBriefing | null;
  onChange: (patch: Partial<VideoBriefing>) => void;
}) {
  if (briefing === null) {
    return (
      <div className="card flex items-center gap-3 p-5">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-violet-300" />
        <span className="text-sm text-zinc-300">
          動画ぜんたいを読み取り中…（30秒ほど）
        </span>
      </div>
    );
  }

  const b: VideoBriefing = briefing;
  const openingsStr = b.openings.join("、");
  const keyTermsStr = b.keyTerms.join("、");

  function updateSpeaker(i: number, patch: Partial<BriefingSpeaker>) {
    const next = b.speakers.map((s, idx) =>
      idx === i ? { ...s, ...patch } : s
    );
    onChange({ speakers: next });
  }
  function removeSpeaker(i: number) {
    const next = b.speakers.filter((_, idx) => idx !== i);
    onChange({ speakers: next });
  }
  function addSpeaker() {
    onChange({
      speakers: [...b.speakers, { jp: "", role: "解説", en: "" }],
    });
  }

  return (
    <section className="card flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="chip bg-violet-500/[0.16] text-violet-100">
            🔎 下調べ
          </span>
          <h2 className="text-lg font-semibold text-white">
            動画ぜんたいの読み取り
          </h2>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          AI が動画全体を読んで「これは何の動画か」「誰が話しているか」「どんなトーンか」を整理しました。
          <span className="text-amber-300">
            ここを直すと、翻訳が動画ぜんたいの文脈に合った訳になります。
          </span>
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          主題
        </span>
        <input
          type="text"
          value={b.topic}
          onChange={(e) => onChange({ topic: e.target.value })}
          placeholder="例：藤井名人と渡辺九段の竜王戦第3局を解説"
          className="field text-base"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            棋戦
          </span>
          <input
            type="text"
            value={b.tournament}
            onChange={(e) => onChange({ tournament: e.target.value })}
            placeholder="例：竜王戦・名人戦（無ければ空欄）"
            className="field text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            話し方のトーン
          </span>
          <select
            value={b.tone}
            onChange={(e) => onChange({ tone: e.target.value })}
            className="field text-sm"
          >
            {TONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            登場人物
          </span>
          <button
            onClick={addSpeaker}
            className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/[0.06]"
          >
            ＋ 追加
          </button>
        </div>
        {b.speakers.length === 0 ? (
          <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-zinc-500">
            登場人物は検出されませんでした
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {b.speakers.map((s, i) => (
              <li
                key={i}
                className="grid grid-cols-12 gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2"
              >
                <input
                  value={s.jp}
                  onChange={(e) => updateSpeaker(i, { jp: e.target.value })}
                  placeholder="名前（日本語）"
                  className="col-span-12 sm:col-span-4 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-violet-500/40"
                />
                <input
                  value={s.role}
                  onChange={(e) => updateSpeaker(i, { role: e.target.value })}
                  placeholder="役割"
                  className="col-span-7 sm:col-span-3 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-violet-500/40"
                />
                <input
                  value={s.en ?? ""}
                  onChange={(e) => updateSpeaker(i, { en: e.target.value })}
                  placeholder="英語表記（任意）"
                  className="col-span-12 sm:col-span-4 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-violet-500/40"
                />
                <button
                  onClick={() => removeSpeaker(i)}
                  className="col-span-5 sm:col-span-1 rounded text-xs text-zinc-500 hover:text-rose-300"
                  title="削除"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          扱われている戦法・囲い（カンマや「、」で区切る）
        </span>
        <input
          type="text"
          value={openingsStr}
          onChange={(e) =>
            onChange({
              openings: e.target.value
                .split(/[、,]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="例：四間飛車、穴熊、相掛かり"
          className="field text-sm"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          動画の要約（翻訳AIに渡される）
        </span>
        <textarea
          value={b.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          rows={3}
          placeholder="動画全体の流れ・狙いを3〜5行で"
          className="w-full resize-none rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none focus:border-violet-500/40"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          特に気をつけるキーワード
        </span>
        <input
          type="text"
          value={keyTermsStr}
          onChange={(e) =>
            onChange({
              keyTerms: e.target.value
                .split(/[、,]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="例：腰掛け銀、角換わり、王手"
          className="field text-sm"
        />
      </label>
    </section>
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
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onBulkReplace: (
    find: string,
    replace: string,
    caseSensitive: boolean
  ) => number;
  countMatches: (find: string, caseSensitive: boolean) => number;
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
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onBulkReplace,
    countMatches,
  } = props;

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(800);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

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

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const stepSegment = useCallback(
    (dir: 1 | -1) => {
      if (segments.length === 0) return;
      const cur = segments.findIndex(
        (s) => currentTime >= s.startSec && currentTime <= s.endSec
      );
      let next: number;
      if (cur < 0) {
        next = dir > 0 ? 0 : segments.length - 1;
      } else {
        next = Math.max(0, Math.min(segments.length - 1, cur + dir));
      }
      seekTo(segments[next].startSec);
    },
    [segments, currentTime, seekTo]
  );

  // ===== キーボードショートカット =====
  useEffect(() => {
    function isEditing(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return (
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        target.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      // Undo/Redo は編集中でも効かせる（テキストの自然な undo はブラウザ既定だが、
      // ここはセグメント全体の取消を優先したいので明示的に上書き）
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (e.shiftKey) {
          e.preventDefault();
          onRedo();
          showToast("やり直しました");
        } else {
          e.preventDefault();
          onUndo();
          showToast("ひとつ前に戻しました");
        }
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        onRedo();
        showToast("やり直しました");
        return;
      }
      if (mod && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setFindReplaceOpen(true);
        return;
      }
      // 編集中（input/textarea）はここから先のキーは介入しない
      if (isEditing(e.target)) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        stepSegment(-1);
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        stepSegment(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        stepSegment(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        stepSegment(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onUndo, onRedo, togglePlay, stepSegment, showToast]);

  const previewSegment = hasSourceVideo ? activeSegment : segments[0] ?? null;

  return (
    <div className="animate-fade-in flex flex-col gap-5">
      {/* Toolbar: Undo / Redo / Find&Replace + keyboard hint */}
      <div className="card flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
        <button
          onClick={() => {
            onUndo();
            showToast("ひとつ前に戻しました");
          }}
          disabled={!canUndo}
          title="取り消し (Ctrl/Cmd + Z)"
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↶ 取消
        </button>
        <button
          onClick={() => {
            onRedo();
            showToast("やり直しました");
          }}
          disabled={!canRedo}
          title="やり直し (Ctrl/Cmd + Shift + Z)"
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30"
        >
          ↷ やり直し
        </button>
        <span className="h-4 w-px bg-white/10" />
        <button
          onClick={() => setFindReplaceOpen(true)}
          title="検索＆一括置換 (Ctrl/Cmd + F)"
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-white/[0.06]"
        >
          🔎 検索・置換
        </button>
        <div className="ml-auto hidden text-[10px] text-zinc-500 sm:block">
          スペース=再生 / J,L=前後 / ↑↓=セグメント / Ctrl+Z=取消 / Ctrl+F=置換
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-emerald-500/95 px-4 py-2 text-xs font-medium text-emerald-950 shadow-lg shadow-emerald-500/30 animate-fade">
          {toast}
        </div>
      )}

      {/* Find & Replace */}
      {findReplaceOpen && (
        <FindReplaceModal
          onClose={() => setFindReplaceOpen(false)}
          onReplace={(f, r, cs) => {
            const n = onBulkReplace(f, r, cs);
            showToast(n > 0 ? `${n}件 置換しました` : "見つかりませんでした");
            return n;
          }}
          countMatches={countMatches}
        />
      )}

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
                  {s.backJp && (
                    <div className="mt-1 text-[11px] text-zinc-500">
                      <span className="text-zinc-400">逆翻訳:</span> {s.backJp}
                    </div>
                  )}
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
