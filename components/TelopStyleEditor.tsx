"use client";

import { STYLE_PRESETS } from "@/lib/telop/defaults";
import type { TelopStyle } from "@/lib/telop/types";

type Props = {
  style: TelopStyle;
  onChange: (next: TelopStyle) => void;
};

export function TelopStyleEditor({ style, onChange }: Props) {
  function patch(p: Partial<TelopStyle>) {
    onChange({ ...style, ...p });
  }

  return (
    <div className="card flex flex-col gap-6 p-5 sm:p-6">
      <Section title="プリセット">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STYLE_PRESETS.map((p) => {
            const active = JSON.stringify(p.style) === JSON.stringify(style);
            return (
              <button
                key={p.id}
                onClick={() => onChange(p.style)}
                className={`rounded-xl border px-3 py-2.5 text-left text-xs transition-all duration-200 ${
                  active
                    ? "border-white/15 bg-white/[0.08] text-white shadow-[0_0_0_1px_rgba(139,92,246,0.25)_inset]"
                    : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="文字">
        <Row>
          <Label>サイズ</Label>
          <input
            type="range"
            min={24}
            max={88}
            value={style.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })}
            className="flex-1"
          />
          <Value>{style.fontSize}px</Value>
        </Row>
        <Row>
          <Label>色</Label>
          <input
            type="color"
            value={style.fontColor}
            onChange={(e) => patch({ fontColor: e.target.value })}
            className="h-9 w-12 cursor-pointer"
          />
          <Value mono>{style.fontColor.toUpperCase()}</Value>
        </Row>
        <Row>
          <Label>太さ</Label>
          <select
            value={style.fontWeight}
            onChange={(e) =>
              patch({ fontWeight: Number(e.target.value) as TelopStyle["fontWeight"] })
            }
            className="flex-1"
          >
            <option value={400}>標準</option>
            <option value={600}>やや太い</option>
            <option value={700}>太字</option>
            <option value={800}>極太</option>
          </select>
        </Row>
      </Section>

      <Section title="位置・長さ">
        <Row>
          <Label>表示位置</Label>
          <select
            value={style.align}
            onChange={(e) => patch({ align: e.target.value as TelopStyle["align"] })}
            className="flex-1"
          >
            <option value="bottom">下（標準）</option>
            <option value="middle">中央</option>
            <option value="top">上</option>
          </select>
        </Row>
        <Row>
          <Label>余白</Label>
          <input
            type="range"
            min={0}
            max={30}
            value={style.marginPercent}
            onChange={(e) => patch({ marginPercent: Number(e.target.value) })}
            className="flex-1"
          />
          <Value>{style.marginPercent}%</Value>
        </Row>
        <Row>
          <Label>1行の字数</Label>
          <input
            type="range"
            min={20}
            max={60}
            value={style.maxLineChars}
            onChange={(e) => patch({ maxLineChars: Number(e.target.value) })}
            className="flex-1"
          />
          <Value>{style.maxLineChars}</Value>
        </Row>
        <Row>
          <Label>最大行数</Label>
          <select
            value={style.maxLines}
            onChange={(e) => patch({ maxLines: Number(e.target.value) })}
            className="flex-1"
          >
            <option value={1}>1行（テンポ重視）</option>
            <option value={2}>2行（標準）</option>
          </select>
        </Row>
      </Section>

      <Section title="背景・縁取り">
        <Row>
          <Label>種類</Label>
          <select
            value={style.background.kind}
            onChange={(e) => {
              const kind = e.target.value as TelopStyle["background"]["kind"];
              if (kind === "none") patch({ background: { kind: "none" } });
              else if (kind === "outline")
                patch({
                  background: {
                    kind: "outline",
                    outlineColor: "#000000",
                    outlineWidth: 4,
                  },
                });
              else
                patch({
                  background: { kind: "bar", barColor: "#000000", barOpacity: 0.7 },
                });
            }}
            className="flex-1"
          >
            <option value="outline">縁取り（黒フチ）</option>
            <option value="bar">帯背景</option>
            <option value="none">なし</option>
          </select>
        </Row>
        {style.background.kind === "outline" && (
          <>
            <Row>
              <Label>縁の色</Label>
              <input
                type="color"
                value={style.background.outlineColor}
                onChange={(e) =>
                  patch({
                    background: {
                      ...style.background,
                      outlineColor: e.target.value,
                    } as TelopStyle["background"],
                  })
                }
                className="h-9 w-12 cursor-pointer"
              />
              <Value mono>{style.background.outlineColor.toUpperCase()}</Value>
            </Row>
            <Row>
              <Label>縁の太さ</Label>
              <input
                type="range"
                min={1}
                max={10}
                value={style.background.outlineWidth}
                onChange={(e) =>
                  patch({
                    background: {
                      ...style.background,
                      outlineWidth: Number(e.target.value),
                    } as TelopStyle["background"],
                  })
                }
                className="flex-1"
              />
              <Value>{style.background.outlineWidth}</Value>
            </Row>
          </>
        )}
        {style.background.kind === "bar" && (
          <>
            <Row>
              <Label>帯の色</Label>
              <input
                type="color"
                value={style.background.barColor}
                onChange={(e) =>
                  patch({
                    background: {
                      ...style.background,
                      barColor: e.target.value,
                    } as TelopStyle["background"],
                  })
                }
                className="h-9 w-12 cursor-pointer"
              />
              <Value mono>{style.background.barColor.toUpperCase()}</Value>
            </Row>
            <Row>
              <Label>濃さ</Label>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(style.background.barOpacity * 100)}
                onChange={(e) =>
                  patch({
                    background: {
                      ...style.background,
                      barOpacity: Number(e.target.value) / 100,
                    } as TelopStyle["background"],
                  })
                }
                className="flex-1"
              />
              <Value>{Math.round(style.background.barOpacity * 100)}%</Value>
            </Row>
          </>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="w-20 shrink-0 text-xs text-zinc-400 sm:w-24">{children}</span>
  );
}

function Value({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className={`w-14 shrink-0 text-right text-[11px] text-zinc-500 ${
        mono ? "font-mono" : ""
      }`}
    >
      {children}
    </span>
  );
}
