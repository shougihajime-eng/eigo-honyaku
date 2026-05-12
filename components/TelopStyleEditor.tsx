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
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div>
        <Label>見た目のテンプレ</Label>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {STYLE_PRESETS.map((p) => {
            const active = JSON.stringify(p.style) === JSON.stringify(style);
            return (
              <button
                key={p.id}
                onClick={() => onChange(p.style)}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white hover:border-slate-400"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <Group title="文字">
        <Row>
          <Label>大きさ</Label>
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
            className="h-9 w-14 cursor-pointer rounded border border-slate-200 bg-white"
          />
          <Value mono>{style.fontColor.toUpperCase()}</Value>
        </Row>
        <Row>
          <Label>太さ</Label>
          <select
            value={style.fontWeight}
            onChange={(e) => patch({ fontWeight: Number(e.target.value) as TelopStyle["fontWeight"] })}
            className="flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value={400}>標準</option>
            <option value={600}>やや太い</option>
            <option value={700}>太字</option>
            <option value={800}>極太</option>
          </select>
        </Row>
      </Group>

      <Group title="位置と長さ">
        <Row>
          <Label>表示位置</Label>
          <select
            value={style.align}
            onChange={(e) => patch({ align: e.target.value as TelopStyle["align"] })}
            className="flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="bottom">画面下部（標準）</option>
            <option value="middle">画面中央</option>
            <option value="top">画面上部</option>
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
          <Label>1行の文字数</Label>
          <input
            type="range"
            min={20}
            max={60}
            value={style.maxLineChars}
            onChange={(e) => patch({ maxLineChars: Number(e.target.value) })}
            className="flex-1"
          />
          <Value>{style.maxLineChars}文字</Value>
        </Row>
        <Row>
          <Label>最大行数</Label>
          <select
            value={style.maxLines}
            onChange={(e) => patch({ maxLines: Number(e.target.value) })}
            className="flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value={1}>1行（短くテンポ重視）</option>
            <option value={2}>2行（標準）</option>
          </select>
        </Row>
      </Group>

      <Group title="背景・縁取り">
        <Row>
          <Label>種類</Label>
          <select
            value={style.background.kind}
            onChange={(e) => {
              const kind = e.target.value as TelopStyle["background"]["kind"];
              if (kind === "none") patch({ background: { kind: "none" } });
              else if (kind === "outline")
                patch({
                  background: { kind: "outline", outlineColor: "#000000", outlineWidth: 4 },
                });
              else
                patch({
                  background: { kind: "bar", barColor: "#000000", barOpacity: 0.7 },
                });
            }}
            className="flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="outline">縁取り（黒フチ）</option>
            <option value="bar">帯背景（黒バー）</option>
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
                    background: { ...style.background, outlineColor: e.target.value } as TelopStyle["background"],
                  })
                }
                className="h-9 w-14 cursor-pointer rounded border border-slate-200 bg-white"
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
                    background: { ...style.background, barColor: e.target.value } as TelopStyle["background"],
                  })
                }
                className="h-9 w-14 cursor-pointer rounded border border-slate-200 bg-white"
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
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="w-20 shrink-0 text-sm text-slate-700 sm:w-24">{children}</span>;
}

function Value({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className={`w-16 shrink-0 text-right text-xs text-slate-500 ${mono ? "font-mono" : ""}`}>
      {children}
    </span>
  );
}
