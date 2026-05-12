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
  | "translating"
  | "review"
  | "rendering"
  | "done";

const STEP_ORDER: Step[] = [
  "input",
  "downloading",
  "transcribing",
  "translating",
  "review",
  "rendering",
  "done",
];

const STEP_LABEL: Record<Step, string> = {
  input: "動画のURL",
  downloading: "動画を取り込み中",
  transcribing: "日本語の書き起こし中",
  translating: "英語に翻訳中",
  review: "字幕の確認・編集",
  rendering: "動画に焼き込み中",
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 起動時：localStorage の下書きをチェック
  useEffect(() => {
    const d = loadDraft();
    if (d) setDraftState(d);
  }, []);

  // review に入ったら自動保存（編集中の変化を localStorage へ）
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

      setStep("translating");
      const r3 = await fetch("/api/video/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: d1.jobId }),
      });
      const d3 = await r3.json();
      if (!r3.ok) throw new Error(d3.error);

      setSegments(d3.segments as TelopSegment[]);
      setHasSourceVideo(true);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("input");
    }
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
      // jobId がないファイルは「動画なし編集」モード
      enterReviewWithoutVideo(d);
      return;
    }
    const ok = await checkJob(d.jobId);
    if (!ok.exists || !ok.hasVideo) {
      // 動画が消えている → URL から再ダウンロードを促す
      setUrl(d.youtubeUrl ?? "");
      setInfo(
        "前回の動画ファイルが期限切れでした。同じURLで再生成すると動画プレビュー付きで続きから編集できます。"
      );
      return;
    }
    // 動画も生きている → 完全復元
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
          YouTubeのURLを貼るだけ。書き起こし→英訳→焼き付け動画まで自動で。
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
      {info && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          {info}
        </div>
      )}

      {step === "input" && (
        <>
          {draft && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-sm font-semibold text-emerald-900">
                💾 前回の続きが残っています
              </div>
              {draft.videoTitle && (
                <div className="mt-1 truncate text-xs text-emerald-800">
                  {draft.videoTitle}（セグメント {draft.segments.length} 個）
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => resumeFromDraft(draft)}
                  className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
                >
                  続きから開く
                </button>
                <button
                  onClick={() => {
                    clearDraft();
                    setDraftState(null);
                  }}
                  className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:border-emerald-500"
                >
                  下書きを消す
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-slate-700">YouTubeのURL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="rounded-xl border border-slate-200 bg-white p-3 text-base shadow-sm outline-none focus:border-slate-900"
            />
            <p className="text-xs text-slate-500">
              ※ 公開動画のみ。10分を超える動画は今のバージョンでは未対応です。
            </p>
            <button
              onClick={start}
              disabled={!url.trim()}
              className="rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              字幕を作る
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <hr className="flex-1 border-slate-200" />
            <span>または</span>
            <hr className="flex-1 border-slate-200" />
          </div>

          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-500"
            >
              📂 保存したプロジェクトファイルを開く
            </button>
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
            <p className="mt-2 text-[11px] text-slate-500">
              ※ 以前「プロジェクトを保存」で書き出した `.eigo-honyaku.json` ファイルが開けます。
            </p>
          </div>
        </>
      )}

      {(step === "downloading" ||
        step === "transcribing" ||
        step === "translating" ||
        step === "rendering") && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-8">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
          <div className="text-base font-medium">{STEP_LABEL[step]}…</div>
          <div className="text-xs text-slate-500">
            5分動画でだいたい1〜3分かかります。閉じずにお待ちください。
          </div>
        </div>
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
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-base font-semibold text-emerald-800">✨ 完成しました</div>
            <div className="mt-1 text-sm text-emerald-700">
              下のボタンからダウンロードできます。
            </div>
          </div>
          <a
            href={outputs.mp4Url}
            className="rounded-xl bg-slate-900 px-4 py-3 text-center text-base font-semibold text-white shadow-sm transition active:scale-[0.99]"
          >
            字幕付き動画（MP4）をダウンロード
          </a>
          <a
            href={outputs.srtUrl}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            字幕ファイル（SRT）だけダウンロード
          </a>
          <button
            onClick={downloadProject}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            💾 プロジェクトをファイルに保存
          </button>
          <button
            onClick={reset}
            className="text-sm text-slate-500 underline hover:text-slate-900"
          >
            次の動画を作る
          </button>
        </div>
      )}
    </main>
  );
}

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

  // 動画なしモードでは、アクティブセグメントを「最初のセグメント」固定にしてプレビュー
  const previewSegment = hasSourceVideo
    ? activeSegment
    : segments[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-xs text-slate-500">取り込んだ動画</div>
        <div className="mt-1 truncate text-sm font-semibold">{title || "(無題)"}</div>
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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900 px-4 text-center text-sm text-slate-300">
              <div className="text-3xl">🎬</div>
              <div>動画ファイルなしモード</div>
              <div className="text-[11px] text-slate-500">
                テロップ見た目の確認のみ。MP4焼き込みは不可です。
              </div>
            </div>
          )}
          {previewSegment && previewSegment.en && (
            <TelopRender
              text={previewSegment.en}
              style={style}
              containerWidth={previewWidth}
            />
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          ▲ {hasSourceVideo
            ? "再生中の字幕が、焼き込み後とほぼ同じ見た目でリアルタイム表示されます"
            : "最初のセグメントを使って見た目だけ確認しています"}
        </p>
      </div>

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
                  disabled={!hasSourceVideo}
                  className="col-span-2 text-left text-xs font-medium text-slate-700 underline-offset-2 hover:underline disabled:no-underline sm:col-span-1"
                  title={hasSourceVideo ? "この場面を再生" : "動画がないため再生不可"}
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

      {/* アクション */}
      <div className="flex flex-col gap-2">
        <button
          onClick={onRender}
          disabled={!hasSourceVideo}
          className="rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          この内容で動画に焼き付ける
        </button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            onClick={onSaveSrt}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            📄 SRTだけ書き出す
          </button>
          <button
            onClick={onSaveProject}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"
          >
            💾 プロジェクトを保存
          </button>
          <button
            onClick={onReset}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-500 hover:border-slate-400"
          >
            最初から
          </button>
        </div>
        <p className="text-[11px] text-slate-500">
          編集内容は自動的にパソコン内に下書き保存されています（同じパソコンの同じブラウザなら、ページを閉じても残ります）。
        </p>
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
