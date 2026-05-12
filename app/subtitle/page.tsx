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
import { checkAll } from "@/lib/telop/quality";
import {
  extractAudioFromVideo,
  readVideoDuration,
  type ExtractProgress,
} from "@/lib/audio/extract-client";
import {
  buildEnglishSrt,
  buildJapaneseSrt,
  buildTelopProject,
  downloadTextFile,
} from "@/lib/telop/project-export";

type Step = "input" | "extracting" | "transcribing" | "translating" | "review";

const STEP_ORDER: Step[] = ["input", "extracting", "transcribing", "translating", "review"];
const STEP_LABEL: Record<Step, string> = {
  input: "動画を選ぶ",
  extracting: "音声を取り出し中",
  transcribing: "日本語の書き起こし中",
  translating: "英語に翻訳中",
  review: "字幕の確認・編集・ダウンロード",
};

const MAX_DURATION_SEC = 8 * 60; // 同期APIの 10MB 制限から逆算した安全値

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

export default function SubtitlePage() {
  const [step, setStep] = useState<Step>("input");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [extractRatio, setExtractRatio] = useState(0);
  const [segments, setSegments] = useState<TelopSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<TelopStyle>(DEFAULT_STYLE);
  const [currentTime, setCurrentTime] = useState(0);

  // file が変わるたびに Object URL を作り直し、古い URL は破棄
  useEffect(() => {
    if (!file) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function onPickFile(picked: File | null) {
    setError(null);
    if (!picked) return;
    if (!picked.type.startsWith("video/") && !picked.name.toLowerCase().endsWith(".mp4")) {
      setError("MP4 など動画ファイルを選んでください");
      return;
    }
    try {
      const dur = await readVideoDuration(picked);
      setDuration(dur);
      if (dur > MAX_DURATION_SEC) {
        setError(
          `この MVP では ${Math.floor(MAX_DURATION_SEC / 60)} 分以下の動画のみ対応しています（選んだ動画: ${fmtTime(
            dur
          )}）。短い動画でお試しください。`
        );
        return;
      }
      setFile(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "動画を読み込めませんでした");
    }
  }

  async function start() {
    if (!file) return;
    setError(null);
    setSegments([]);
    setExtractRatio(0);

    try {
      // 1. ブラウザで音声抽出
      setStep("extracting");
      const extracted = await extractAudioFromVideo(file, (p: ExtractProgress) => {
        if (p.ratio !== undefined) setExtractRatio(p.ratio);
      });

      // 2. 書き起こし API へ
      setStep("transcribing");
      const fd = new FormData();
      fd.append(
        "audio",
        new Blob([new Uint8Array(extracted.audioBytes)], { type: extracted.contentType }),
        extracted.filename
      );
      const r1 = await fetch("/api/subtitle/transcribe", { method: "POST", body: fd });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error);
      const transcribed = d1.segments as Array<{
        index: number;
        startSec: number;
        endSec: number;
        jp: string;
      }>;
      if (!transcribed.length) {
        throw new Error("音声を聞き取れませんでした。動画に音声が入っているか確認してください");
      }

      // 3. 翻訳 API へ
      setStep("translating");
      const r2 = await fetch("/api/subtitle/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: transcribed }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error);

      setSegments(d2.segments as TelopSegment[]);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("input");
    }
  }

  function updateEn(index: number, en: string) {
    setSegments((prev) => prev.map((s) => (s.index === index ? { ...s, en } : s)));
  }

  function reset() {
    setStep("input");
    setFile(null);
    setDuration(0);
    setSegments([]);
    setError(null);
    setStyle(DEFAULT_STYLE);
    setCurrentTime(0);
    setExtractRatio(0);
  }

  function downloadAll() {
    const baseName = file?.name?.replace(/\.[^.]+$/, "") || "subtitle";
    downloadTextFile(`${baseName}-jp.srt`, buildJapaneseSrt(segments), "text/plain;charset=utf-8");
    downloadTextFile(`${baseName}-en.srt`, buildEnglishSrt(segments), "text/plain;charset=utf-8");
    const project = buildTelopProject({
      videoTitle: file?.name,
      durationSec: duration,
      style,
      segments,
    });
    downloadTextFile(
      `${baseName}-telop.json`,
      JSON.stringify(project, null, 2),
      "application/json"
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-5 px-4 py-5 sm:py-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
          ← トップに戻る
        </Link>
        <span className="text-xs text-slate-500">動画字幕を作る</span>
      </header>

      <div>
        <h1 className="text-xl font-bold sm:text-2xl">動画字幕を作る</h1>
        <p className="text-sm text-slate-500">
          MP4 を選ぶだけ。書き起こし→英訳→SRT・テロップJSON まで自動で。
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs">
        {STEP_ORDER.map((s, i) => {
          const curIdx = STEP_ORDER.indexOf(step);
          const sIdx = STEP_ORDER.indexOf(s);
          const done = sIdx < curIdx;
          const active = sIdx === curIdx;
          return (
            <li
              key={s}
              className={`rounded-full border px-3 py-1 ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : done
                    ? "border-slate-300 bg-slate-100 text-slate-500"
                    : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              {i + 1}. {STEP_LABEL[s]}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === "input" && (
        <InputSection
          file={file}
          duration={duration}
          maxDurationSec={MAX_DURATION_SEC}
          onPickFile={onPickFile}
          onStart={start}
          onClear={reset}
        />
      )}

      {step === "extracting" && (
        <ProgressBox
          label={STEP_LABEL.extracting + "…"}
          ratio={extractRatio}
          hint={`動画の長さと同じくらい時間がかかります（${fmtTime(duration)} の動画なら ${fmtTime(
            Math.max(60, duration)
          )} ほど）。閉じずにお待ちください。`}
        />
      )}

      {(step === "transcribing" || step === "translating") && (
        <ProgressBox
          label={STEP_LABEL[step] + "…"}
          spin
          hint="サーバーで処理中です。1分前後かかります。"
        />
      )}

      {step === "review" && file && videoUrl && (
        <ReviewSection
          videoUrl={videoUrl}
          filename={file.name}
          duration={duration}
          segments={segments}
          style={style}
          onStyleChange={setStyle}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          onEditEn={updateEn}
          onDownloadAll={downloadAll}
          onReset={reset}
        />
      )}
    </main>
  );
}

/* ===================== Input Section ===================== */

function InputSection(props: {
  file: File | null;
  duration: number;
  maxDurationSec: number;
  onPickFile: (f: File | null) => void;
  onStart: () => void;
  onClear: () => void;
}) {
  const { file, duration, maxDurationSec, onPickFile, onStart, onClear } = props;
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPickFile(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-white p-8 text-center transition ${
          dragOver
            ? "border-slate-900 bg-slate-50"
            : "border-slate-300 hover:border-slate-500"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-12 w-12 text-slate-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
        <div className="text-base font-semibold text-slate-700">
          {file ? file.name : "ここに MP4 をドラッグ、またはタップして選択"}
        </div>
        <div className="text-xs text-slate-500">
          {file
            ? `${fmtBytes(file.size)} / ${fmtTime(duration)}`
            : `${Math.floor(maxDurationSec / 60)}分以下の MP4`}
        </div>
        <input
          type="file"
          accept="video/mp4,video/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <p className="text-xs text-slate-500">
        ※ MVP 版のため、{Math.floor(maxDurationSec / 60)}分以下の動画にのみ対応。長い動画は次のバージョンで対応予定です。
      </p>

      <div className="flex gap-2">
        <button
          onClick={onStart}
          disabled={!file}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          字幕を作る
        </button>
        {file && (
          <button
            onClick={onClear}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            選び直す
          </button>
        )}
      </div>
    </div>
  );
}

/* ===================== Progress Box ===================== */

function ProgressBox({
  label,
  ratio,
  spin,
  hint,
}: {
  label: string;
  ratio?: number;
  spin?: boolean;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-8">
      {spin && (
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
      )}
      <div className="text-base font-medium">{label}</div>
      {ratio !== undefined && (
        <div className="w-full max-w-md">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-slate-900 transition-all"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-center text-xs text-slate-500">
            {Math.round(ratio * 100)}%
          </div>
        </div>
      )}
      <div className="text-center text-xs text-slate-500">{hint}</div>
    </div>
  );
}

/* ===================== Review Section ===================== */

function ReviewSection(props: {
  videoUrl: string;
  filename: string;
  duration: number;
  segments: TelopSegment[];
  style: TelopStyle;
  onStyleChange: (s: TelopStyle) => void;
  currentTime: number;
  onTimeChange: (t: number) => void;
  onEditEn: (index: number, en: string) => void;
  onDownloadAll: () => void;
  onReset: () => void;
}) {
  const {
    videoUrl,
    filename,
    duration,
    segments,
    style,
    onStyleChange,
    currentTime,
    onTimeChange,
    onEditEn,
    onDownloadAll,
    onReset,
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

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs text-slate-500">取り込んだ動画</div>
        <div className="mt-1 truncate text-sm font-semibold">{filename}</div>
        <div className="text-xs text-slate-500">
          長さ {fmtTime(duration)} / セグメント {segments.length} 個
        </div>
        {warnings.length > 0 && (
          <div className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            ⚠ 要確認 {warnings.length} 件
          </div>
        )}
      </div>

      {/* プレビュー：動画 + テロップ重ね */}
      <div className="sticky top-0 z-10 -mx-4 bg-slate-50/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0">
        <div
          ref={previewBoxRef}
          className="relative aspect-video w-full overflow-hidden rounded-xl bg-black"
        >
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            preload="metadata"
            playsInline
            className="absolute inset-0 h-full w-full"
            onTimeUpdate={(e) => onTimeChange(e.currentTarget.currentTime)}
          />
          {activeSegment && activeSegment.en && (
            <TelopRender
              text={activeSegment.en}
              style={style}
              containerWidth={previewWidth}
            />
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          ▲ 再生中の英語字幕が、動画上にリアルタイムでプレビュー表示されます
        </p>
      </div>

      {/* テロップスタイル編集 */}
      <TelopStyleEditor style={style} onChange={onStyleChange} />

      {/* セグメント一覧 */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <div className="col-span-2 sm:col-span-1">時間</div>
          <div className="col-span-5">日本語</div>
          <div className="col-span-5 sm:col-span-6">英語（編集可）</div>
        </div>
        <ul className="divide-y divide-slate-100">
          {segments.map((s) => {
            const isActive = activeSegment?.index === s.index;
            const segWarnings = warningByIndex.get(s.index) ?? [];
            const hasWarn = segWarnings.length > 0;
            return (
              <li
                key={s.index}
                className={`grid grid-cols-12 gap-2 px-3 py-3 transition ${
                  isActive ? "bg-slate-100" : hasWarn ? "bg-amber-50/50" : ""
                }`}
              >
                <button
                  onClick={() => seekTo(s.startSec)}
                  className="col-span-2 text-left text-xs font-medium text-slate-700 underline-offset-2 hover:underline sm:col-span-1"
                  title="この場面を再生"
                >
                  {fmtTime(s.startSec)}
                </button>
                <div className="col-span-5 text-sm leading-relaxed text-slate-800">
                  {highlightTerms(
                    s.jp,
                    s.hitTerms.map((t) => t.jp)
                  )}
                  {s.hitTerms.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.hitTerms.map((t) => (
                        <span
                          key={t.jp}
                          className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
                        >
                          {t.jp}→{t.en}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-span-5 sm:col-span-6">
                  <textarea
                    value={s.en}
                    onChange={(e) => onEditEn(s.index, e.target.value)}
                    rows={2}
                    className={`w-full resize-none rounded-lg border px-2 py-1.5 text-sm leading-relaxed outline-none focus:border-slate-900 ${
                      hasWarn
                        ? "border-amber-300 bg-amber-50"
                        : "border-slate-200 bg-white"
                    }`}
                  />
                  {segWarnings.map((w, i) => (
                    <div key={i} className="mt-1 text-[11px] text-amber-700">
                      ⚠ {w.message}
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={onDownloadAll}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.99]"
        >
          3 ファイルまとめてダウンロード（日本語SRT・英語SRT・テロップJSON）
        </button>
        <button
          onClick={onReset}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-400"
        >
          別の動画にする
        </button>
      </div>
    </div>
  );
}

/* ===================== Utils ===================== */

function highlightTerms(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map(escapeRe).join("|")})`, "g");
  const parts = text.split(pattern);
  return parts.map((p, i) =>
    sorted.includes(p) ? (
      <mark key={i} className="rounded bg-emerald-100 px-0.5 text-emerald-900">
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
