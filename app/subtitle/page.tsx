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
import type { ExtractedNoun, NounCategory } from "@/lib/video/nouns";
import type { ShogiTerm } from "@/lib/shogi-dictionary";

type RawSegment = {
  index: number;
  startSec: number;
  endSec: number;
  jp: string;
};

type Step =
  | "input"
  | "extracting"
  | "transcribing"
  | "transcript-check"
  | "noun-check"
  | "translating"
  | "review";

/** 翻訳の向き。ja2en=日本語動画→英語字幕（既定） / en2ja=英語動画→日本語字幕 */
type Direction = "ja2en" | "en2ja";

/** 向きごとの言語名・流れ。固有名詞確認ステップは ja2en のみ */
const DIR_META: Record<
  Direction,
  {
    sourceLang: string; // 動画の話し言葉
    targetLang: string; // 作る字幕
    speechLang: "ja" | "en"; // Speech API に渡す
    title: string;
    subtitle: string;
    transcribingLabel: string;
    translatingLabel: string;
  }
> = {
  ja2en: {
    sourceLang: "日本語",
    targetLang: "英語",
    speechLang: "ja",
    title: "日本語の動画 → 英語字幕",
    subtitle: "MP4 を選ぶか YouTube URL を貼るだけ。書き起こし → 英訳 → 字幕ファイルまで自動で。",
    transcribingLabel: "日本語の書き起こし中",
    translatingLabel: "英語に翻訳中",
  },
  en2ja: {
    sourceLang: "英語",
    targetLang: "日本語",
    speechLang: "en",
    title: "英語の動画 → 日本語字幕",
    subtitle: "英語の将棋動画を選ぶだけ。聞き取り → 日本語訳 → 字幕ファイルまで自動で。",
    transcribingLabel: "英語の聞き取り中",
    translatingLabel: "日本語に翻訳中",
  },
};

/** 向きに応じた進行順（en2ja は固有名詞確認を省く） */
function stepOrderFor(direction: Direction): Step[] {
  const base: Step[] = [
    "input",
    "extracting",
    "transcribing",
    "transcript-check",
    "noun-check",
    "translating",
    "review",
  ];
  return direction === "en2ja" ? base.filter((s) => s !== "noun-check") : base;
}

function stepLabel(s: Step, direction: Direction): string {
  const m = DIR_META[direction];
  switch (s) {
    case "input":
      return "動画を選ぶ";
    case "extracting":
      return "音声を取り出し中";
    case "transcribing":
      return m.transcribingLabel;
    case "transcript-check":
      return "聞き取り確認";
    case "noun-check":
      return "固有名詞確認";
    case "translating":
      return m.translatingLabel;
    case "review":
      return "字幕の確認・編集・ダウンロード";
  }
}

const MAX_DURATION_SEC = 15 * 60;

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

type InputMode = "file" | "youtube";

export default function SubtitlePage() {
  const [step, setStep] = useState<Step>("input");
  const [direction, setDirection] = useState<Direction>("ja2en");
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [extractRatio, setExtractRatio] = useState(0);
  const [segments, setSegments] = useState<TelopSegment[]>([]);
  const [transcriptSegs, setTranscriptSegs] = useState<RawSegment[]>([]);
  const [nouns, setNouns] = useState<ExtractedNoun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<TelopStyle>(DEFAULT_STYLE);
  const [currentTime, setCurrentTime] = useState(0);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [sourceTitle, setSourceTitle] = useState<string>("");

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
      let dur = 0;
      try {
        dur = await readVideoDuration(picked);
      } catch {
        // 一部の端末（iPhone Safari等）では duration を取れないことがある。
        // 取れない場合は 0 のまま進め、音声抽出後にファイルサイズで判定する。
        dur = 0;
      }
      // Infinity / NaN も取れなかったとみなす
      if (!Number.isFinite(dur) || dur <= 0) dur = 0;
      setDuration(dur);
      if (dur > 0 && dur > MAX_DURATION_SEC) {
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
    if (inputMode === "file" && !file) return;
    if (inputMode === "youtube" && !youtubeUrl.trim()) return;
    setError(null);
    setSegments([]);
    setTranscriptSegs([]);
    setNouns([]);
    setExtractRatio(0);

    try {
      if (inputMode === "file" && file) {
        setYoutubeVideoId(null);
        setSourceTitle(file.name);
        setStep("extracting");
        const extracted = await extractAudioFromVideo(file, (p: ExtractProgress) => {
          if (p.ratio !== undefined) setExtractRatio(p.ratio);
        });

        setStep("transcribing");
        const fd = new FormData();
        fd.append(
          "audio",
          new Blob([new Uint8Array(extracted.audioBytes)], { type: extracted.contentType }),
          extracted.filename
        );
        fd.append("lang", DIR_META[direction].speechLang);
        const r1 = await fetch("/api/subtitle/transcribe", { method: "POST", body: fd });
        const d1 = await r1.json();
        if (!r1.ok) throw new Error(d1.error);
        const transcribed = d1.segments as RawSegment[];
        if (!transcribed.length) {
          throw new Error("音声を聞き取れませんでした。動画に音声が入っているか確認してください");
        }
        setTranscriptSegs(transcribed);
        setStep("transcript-check");
      } else {
        // YouTube モード: サーバーで DL → 文字起こしまで実行
        setFile(null);
        setStep("transcribing");
        const r1 = await fetch("/api/subtitle/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: youtubeUrl.trim(), lang: DIR_META[direction].speechLang }),
        });
        const d1 = await r1.json();
        if (!r1.ok) throw new Error(d1.error);
        const transcribed = d1.segments as RawSegment[];
        if (!transcribed.length) {
          throw new Error("音声を聞き取れませんでした。別の動画でお試しください");
        }
        setYoutubeVideoId(d1.videoId ?? null);
        setSourceTitle(d1.title ?? "YouTube 動画");
        if (typeof d1.durationSec === "number") setDuration(d1.durationSec);
        setTranscriptSegs(transcribed);
        setStep("transcript-check");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("input");
    }
  }

  /** 書き起こし確認 → （日本語動画のみ）固有名詞抽出に進む。英語動画はそのまま翻訳へ */
  async function confirmTranscript() {
    setError(null);
    // 英語→日本語は固有名詞確認を省いて直接翻訳する
    if (direction === "en2ja") {
      await runTranslate([]);
      return;
    }
    try {
      setStep("noun-check");
      const rn = await fetch("/api/subtitle/extract-nouns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: transcriptSegs }),
      });
      const dn = await rn.json();
      if (!rn.ok) throw new Error(dn.error);
      setNouns((dn.nouns as ExtractedNoun[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep("transcript-check");
    }
  }

  /** 固有名詞確認 → 翻訳を実行（英語→日本語のときは固有名詞なしで直接呼ばれる） */
  async function runTranslate(forcedTerms?: ShogiTerm[]) {
    setError(null);
    const fallbackStep: Step = direction === "en2ja" ? "transcript-check" : "noun-check";
    try {
      const extraTerms: ShogiTerm[] =
        forcedTerms ??
        nouns
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

      // 学習辞書に保存（日本語→英語のときだけ。失敗しても翻訳は進める）
      if (direction === "ja2en" && extraTerms.length > 0) {
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
      }

      setStep("translating");
      const r2 = await fetch("/api/subtitle/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: transcriptSegs, extraTerms, direction }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error);

      setSegments(d2.segments as TelopSegment[]);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
      setStep(fallbackStep);
    }
  }

  function updateTranscriptJp(index: number, jp: string) {
    setTranscriptSegs((prev) =>
      prev.map((s) => (s.index === index ? { ...s, jp } : s))
    );
  }

  function updateNoun(jp: string, en: string) {
    setNouns((prev) =>
      prev.map((n) => (n.jp === jp ? { ...n, en } : n))
    );
  }

  function updateEn(index: number, en: string) {
    setSegments((prev) => prev.map((s) => (s.index === index ? { ...s, en } : s)));
  }

  function reset() {
    setStep("input");
    setFile(null);
    setDuration(0);
    setSegments([]);
    setTranscriptSegs([]);
    setNouns([]);
    setError(null);
    setStyle(DEFAULT_STYLE);
    setCurrentTime(0);
    setExtractRatio(0);
    setYoutubeUrl("");
    setYoutubeVideoId(null);
    setSourceTitle("");
  }

  function downloadAll() {
    const baseName = sourceTitle?.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_") || "subtitle";
    // buildJapaneseSrt は各セグメントの jp（＝元の話し言葉）、buildEnglishSrt は en（＝作った字幕）を使う。
    // 向きで言語が入れ替わるので、ファイル名の言語コードも合わせる。
    const srcCode = direction === "en2ja" ? "en" : "ja";
    const tgtCode = direction === "en2ja" ? "ja" : "en";
    downloadTextFile(`${baseName}-${srcCode}.srt`, buildJapaneseSrt(segments), "text/plain;charset=utf-8");
    downloadTextFile(`${baseName}-${tgtCode}.srt`, buildEnglishSrt(segments), "text/plain;charset=utf-8");
    const project = buildTelopProject({
      videoTitle: sourceTitle || file?.name,
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
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="btn-ghost -ml-2 inline-flex items-center gap-1.5">
          <Back /> Eigo
        </Link>
        <span className="chip">動画字幕</span>
      </header>

      <div className="animate-fade-in flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          動画字幕をつくる
        </h1>
        <p className="text-base text-zinc-300 sm:text-lg">
          {DIR_META[direction].subtitle}
        </p>
      </div>

      <Stepper step={step} direction={direction} />

      {error && (
        <div className="animate-fade rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {step === "input" && (
        <InputSection
          direction={direction}
          onDirectionChange={setDirection}
          mode={inputMode}
          onModeChange={setInputMode}
          file={file}
          duration={duration}
          maxDurationSec={MAX_DURATION_SEC}
          onPickFile={onPickFile}
          youtubeUrl={youtubeUrl}
          onYoutubeUrlChange={setYoutubeUrl}
          onStart={start}
          onClear={reset}
        />
      )}

      {step === "extracting" && (
        <ProgressBox
          label={stepLabel("extracting", direction) + "…"}
          ratio={extractRatio}
          hint={`動画の長さと同じくらい時間がかかります（${fmtTime(duration)} の動画なら ${fmtTime(
            Math.max(60, duration)
          )} ほど）。閉じずにお待ちください。`}
        />
      )}

      {(step === "transcribing" || step === "translating") && (
        <ProgressBox
          label={stepLabel(step, direction) + "…"}
          spin
          hint="サーバーで処理中です。1分前後かかります。"
        />
      )}

      {step === "transcript-check" && (videoUrl || youtubeVideoId) && (
        <SubtitleTranscriptCheck
          direction={direction}
          videoUrl={videoUrl}
          youtubeVideoId={youtubeVideoId}
          filename={sourceTitle}
          segments={transcriptSegs}
          onEditJp={updateTranscriptJp}
          onConfirm={confirmTranscript}
          onCancel={reset}
        />
      )}

      {step === "noun-check" && (
        <SubtitleNounCheck
          nouns={nouns}
          onChange={updateNoun}
          onConfirm={runTranslate}
          onCancel={() => setStep("transcript-check")}
        />
      )}

      {step === "review" && (videoUrl || youtubeVideoId) && (
        <ReviewSection
          direction={direction}
          videoUrl={videoUrl}
          youtubeVideoId={youtubeVideoId}
          filename={sourceTitle}
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

/* ===================== Stepper ===================== */

function Stepper({ step, direction }: { step: Step; direction: Direction }) {
  const order = stepOrderFor(direction);
  const curIdx = order.indexOf(step);
  return (
    <ol className="-mx-1 flex w-full items-center gap-1.5 overflow-x-auto px-1 pb-1 sm:gap-2">
      {order.map((s, i) => {
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
              className={`whitespace-nowrap text-[11px] sm:text-xs ${
                active ? "font-medium text-white" : "text-zinc-500"
              }`}
            >
              {stepLabel(s, direction)}
            </span>
            {i < order.length - 1 && (
              <span
                aria-hidden
                className={`mx-1 h-px w-3 transition-colors duration-300 sm:w-6 ${
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

/* ===================== Input Section ===================== */

function InputSection(props: {
  direction: Direction;
  onDirectionChange: (d: Direction) => void;
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
  file: File | null;
  duration: number;
  maxDurationSec: number;
  onPickFile: (f: File | null) => void;
  youtubeUrl: string;
  onYoutubeUrlChange: (s: string) => void;
  onStart: () => void;
  onClear: () => void;
}) {
  const {
    direction,
    onDirectionChange,
    mode,
    onModeChange,
    file,
    duration,
    maxDurationSec,
    onPickFile,
    youtubeUrl,
    onYoutubeUrlChange,
    onStart,
    onClear,
  } = props;
  const [dragOver, setDragOver] = useState(false);
  const canStart = mode === "file" ? !!file : youtubeUrl.trim().length > 0;

  // 入力があった方を自動で「現在のモード」にする
  function handlePickFile(f: File | null) {
    if (f) onModeChange("file");
    onPickFile(f);
  }
  function handleUrlChange(s: string) {
    if (s.trim()) onModeChange("youtube");
    onYoutubeUrlChange(s);
  }

  return (
    <div className="animate-fade-in flex flex-col gap-4">
      {/* 向きの切り替え */}
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          つくる字幕を選ぶ
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["ja2en", "en2ja"] as Direction[]).map((d) => {
            const active = direction === d;
            const m = DIR_META[d];
            return (
              <button
                key={d}
                onClick={() => onDirectionChange(d)}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 ${
                  active
                    ? "border-white/15 bg-white/[0.08] shadow-[0_0_0_1px_rgba(139,92,246,0.3)_inset]"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                    active
                      ? "border-violet-400/60 bg-violet-500/20 text-white"
                      : "border-white/15 text-zinc-500"
                  }`}
                >
                  {active ? "●" : ""}
                </span>
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                    {m.sourceLang}
                    <span className="text-violet-300">→</span>
                    {m.targetLang}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {d === "ja2en" ? "日本語の動画に英語字幕" : "英語の動画に日本語字幕"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
          if (f) handlePickFile(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-10 text-center transition sm:p-14 ${
          dragOver
            ? "border-violet-400/60 bg-violet-500/[0.08] shadow-[0_20px_60px_-20px_rgba(139,92,246,0.4)]"
            : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-12 w-12 text-zinc-400 sm:h-14 sm:w-14"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
        <div className="break-all text-lg font-semibold text-white sm:text-xl">
          {file ? file.name : "動画ファイルをドラッグ、またはタップして選択"}
        </div>
        <div className="text-sm text-zinc-400">
          {file
            ? `${fmtBytes(file.size)} / ${fmtTime(duration)}`
            : `${Math.floor(maxDurationSec / 60)}分以下の MP4`}
        </div>
        <input
          type="file"
          accept="video/mp4,video/*"
          className="hidden"
          onChange={(e) => handlePickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <span className="h-px flex-1 bg-white/[0.08]" />
        または
        <span className="h-px flex-1 bg-white/[0.08]" />
      </div>

      <input
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={youtubeUrl}
        onChange={(e) => handleUrlChange(e.target.value)}
        placeholder="YouTube の URL を貼り付け"
        className="w-full rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-base text-zinc-100 outline-none transition focus:border-violet-500/50 focus:bg-white/[0.04]"
      />

      <p className="text-sm text-zinc-400">
        ※ 今のバージョンは {Math.floor(maxDurationSec / 60)}分以下の動画のみ対応。
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={onStart}
          disabled={!canStart}
          className="btn-primary flex-1 inline-flex items-center justify-center gap-2 text-base sm:text-lg"
        >
          字幕を作る <Arrow />
        </button>
        {(file || youtubeUrl) && (
          <button onClick={onClear} className="btn-secondary">
            選び直す
          </button>
        )}
      </div>
      {!canStart && (
        <p className="text-center text-sm text-zinc-500">
          ファイルを選ぶか、YouTube の URL を入れてください
        </p>
      )}
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
    <div className="animate-fade-in card flex flex-col items-center justify-center gap-4 px-6 py-12 sm:py-16">
      {spin ? (
        <div className="relative h-14 w-14">
          <span className="absolute inset-0 animate-ping rounded-full bg-violet-500/30" />
          <span className="absolute inset-1 rounded-full border-2 border-white/10 border-t-white/80 animate-spin" />
        </div>
      ) : (
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-violet-400" />
      )}
      <div className="text-base font-medium text-white">{label}</div>
      {ratio !== undefined && (
        <div className="w-full max-w-md">
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <div className="mt-1 text-center text-xs text-zinc-500">
            {Math.round(ratio * 100)}%
          </div>
        </div>
      )}
      <p className="text-center text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

/* ===================== Transcript Check ===================== */

function SubtitleTranscriptCheck({
  direction,
  videoUrl,
  youtubeVideoId,
  filename,
  segments,
  onEditJp,
  onConfirm,
  onCancel,
}: {
  direction: Direction;
  videoUrl: string | null;
  youtubeVideoId: string | null;
  filename: string;
  segments: RawSegment[];
  onEditJp: (index: number, jp: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sourceLang = DIR_META[direction].sourceLang;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [seekKey, setSeekKey] = useState(0);
  const [seekSec, setSeekSec] = useState(0);

  useEffect(() => {
    const found = segments.find((s) => now >= s.startSec && now < s.endSec);
    if (found && found.index !== activeIndex) setActiveIndex(found.index);
  }, [now, segments, activeIndex]);

  function seekTo(sec: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = sec;
      videoRef.current.play().catch(() => {});
      return;
    }
    if (youtubeVideoId) {
      // YouTube iframe を再ロードして該当秒から再生
      setSeekSec(Math.floor(sec));
      setSeekKey((k) => k + 1);
    }
  }

  return (
    <div className="animate-fade-in flex flex-col gap-5">
      <div className="card flex flex-col gap-3 p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-white">
            聞き取りを確認してください
          </h2>
          <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
            動画を再生しながら、聞こえた{sourceLang}と合っているか確認してください。
            <span className="text-amber-300">
              ここで直すと、翻訳が一気に正確になります。
            </span>
            棋士名・戦法・専門用語は特に注意。
          </p>
        </div>
        {filename && (
          <div className="text-xs text-zinc-500 break-words">{filename}</div>
        )}
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              preload="metadata"
              playsInline
              className="absolute inset-0 h-full w-full"
              onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            />
          ) : youtubeVideoId ? (
            <iframe
              key={seekKey}
              src={`https://www.youtube.com/embed/${youtubeVideoId}?start=${seekSec}&rel=0&modestbranding=1`}
              title={filename || "YouTube preview"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : null}
        </div>
        {youtubeVideoId && (
          <p className="text-[11px] text-zinc-500">
            ※ YouTube プレビューは時間バーが独立しています。タイムスタンプをタップするとその時間から再生し直されます。
          </p>
        )}
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

/* ===================== Noun Check ===================== */

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

function SubtitleNounCheck({
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
      <div>
        <h2 className="text-lg font-semibold text-white">
          固有名詞を確認してください
        </h2>
        <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
          棋士名・戦法名・棋戦名・段位を翻訳の前に確認します。日本将棋連盟の公式英語表記を優先してください。
          <span className="text-rose-300">
            不明な項目（赤）が残っていると翻訳できません。
          </span>
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
                          placeholder={empty ? "英語表記を入力" : ""}
                          className={`w-full rounded-md border bg-white/[0.02] px-3 py-1.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500/40 focus:bg-white/[0.04] ${
                            empty ? "border-rose-500/40" : "border-white/[0.06]"
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
          まだ {unknown.length} 件、英語表記が空です。すべて入力してください。
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onCancel}
          className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.04]"
        >
          ← 書き起こしに戻る
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

/* ===================== Review Section ===================== */

function ReviewSection(props: {
  direction: Direction;
  videoUrl: string | null;
  youtubeVideoId: string | null;
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
    direction,
    videoUrl,
    youtubeVideoId,
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
  const sourceLang = DIR_META[direction].sourceLang;
  const targetLang = DIR_META[direction].targetLang;

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(800);
  const [seekKey, setSeekKey] = useState(0);
  const [seekSec, setSeekSec] = useState(0);

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

  const seekTo = useCallback(
    (sec: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = sec;
        videoRef.current.play().catch(() => {});
        return;
      }
      if (youtubeVideoId) {
        setSeekSec(Math.floor(sec));
        setSeekKey((k) => k + 1);
      }
    },
    [youtubeVideoId]
  );

  return (
    <div className="animate-fade-in flex flex-col gap-5">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            取り込んだ動画
          </div>
          <div className="mt-0.5 truncate text-sm font-medium text-white">
            {filename}
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

      {/* プレビュー */}
      <div className="sticky top-0 z-20 -mx-4 bg-zinc-950/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-transparent lg:p-0">
        <div
          ref={previewBoxRef}
          className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)]"
        >
          {videoUrl ? (
            <>
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
                  countdownValue={
                    activeSegment.kind === "countdown"
                      ? activeSegment.countdownValue
                      : undefined
                  }
                />
              )}
            </>
          ) : youtubeVideoId ? (
            <iframe
              key={seekKey}
              src={`https://www.youtube.com/embed/${youtubeVideoId}?start=${seekSec}&rel=0&modestbranding=1`}
              title={filename || "YouTube preview"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          {youtubeVideoId
            ? "YouTube プレビュー。セグメントの時間をタップするとその場面から再生し直されます。"
            : `再生中の${targetLang}字幕が、動画上にリアルタイムでプレビュー表示されます。`}
        </p>
      </div>

      <TelopStyleEditor style={style} onChange={onStyleChange} />

      {/* セグメント一覧 */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 sm:px-5">
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
            セグメント
          </span>
          <span className="hidden text-[11px] text-zinc-500 sm:inline">
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
                className={`flex flex-col gap-3 px-4 py-4 transition-colors duration-200 sm:grid sm:grid-cols-12 sm:gap-3 sm:px-5 ${
                  isActive
                    ? "bg-violet-500/[0.06]"
                    : hasWarn
                    ? "bg-amber-500/[0.03]"
                    : "hover:bg-white/[0.02]"
                }`}
              >
                <button
                  onClick={() => seekTo(s.startSec)}
                  className="self-start text-left font-mono text-xs text-zinc-400 transition hover:text-white sm:col-span-1"
                  title="この場面を再生"
                >
                  ▶ {fmtTime(s.startSec)}
                </button>
                <div className="sm:col-span-5">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 sm:hidden">
                    {sourceLang}
                  </div>
                  <div className="mt-1 text-sm leading-relaxed text-zinc-300 sm:mt-0">
                    {highlightTerms(
                      s.jp,
                      s.hitTerms.map((t) => (direction === "en2ja" ? t.en : t.jp))
                    )}
                  </div>
                  {s.hitTerms.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {s.hitTerms.map((t) => (
                        <span
                          key={t.jp}
                          className="rounded-md bg-violet-500/[0.08] px-1.5 py-0.5 text-[10px] text-violet-200"
                        >
                          {direction === "en2ja" ? t.en : t.jp}
                          <span className="mx-1 text-violet-400/60">→</span>
                          {direction === "en2ja" ? t.jp : t.en}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sm:col-span-6">
                  <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 sm:hidden">
                    {targetLang}（編集可）
                  </div>
                  <textarea
                    value={s.en}
                    onChange={(e) => onEditEn(s.index, e.target.value)}
                    rows={2}
                    className={`mt-1 w-full resize-none rounded-lg border bg-white/[0.02] px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none transition focus:border-violet-500/40 focus:bg-white/[0.04] sm:mt-0 ${
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

      <div className="card flex flex-col gap-3 p-4 sm:p-6">
        <button
          onClick={onDownloadAll}
          className="btn-primary inline-flex items-center justify-center gap-2"
        >
          <DownloadIcon /> 3 ファイルまとめてダウンロード
        </button>
        <p className="text-center text-[11px] text-zinc-500">
          日本語SRT・英語SRT・テロップJSON
        </p>
        <button onClick={onReset} className="btn-ghost self-center">
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
      <mark key={i} className="rounded bg-violet-500/[0.15] px-0.5 text-violet-100">
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
function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14" />
    </svg>
  );
}
