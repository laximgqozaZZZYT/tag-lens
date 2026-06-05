// CognitiveLoadSimulator.tsx
//
// A self-contained, interactive "user cognitive load" simulation tool for an
// Obsidian-style vault. Pure React + Tailwind CSS (dark mode). No external deps,
// no emojis, English only. Default export - drop it into any React/Tailwind host.
//
// Design notes:
//  - ALL slider values live in ONE parent-held state object (`metrics`) so every
//    relative formula reads the global metrics simultaneously.
//  - The Message tab is DERIVED from the current state only: it shows the alerts
//    that are active right now and never keeps a history. Because it is computed
//    on every render, moving any slider instantly clears stale messages.

import React, { useMemo, useState } from "react";

// --- Types -------------------------------------------------------------------
type MetricKey =
  | "totalNotes"
  | "totalFolders"
  | "totalLinks"
  | "notesPerTag"
  | "coOccurringTags"
  | "filesInFolder"
  | "subFolderDepth"
  | "tagsInNote"
  | "linkBacklinkCount"
  | "fileSizeKb"
  | "k";

type Metrics = Record<MetricKey, number>;

type TabName = "Global" | "Tag" | "Folder" | "Note" | "Message";

type Severity = "CRITICAL" | "WARNING";

interface SliderDef {
  key: MetricKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

interface ConditionDef {
  id: string;
  label: string;
  severity: Severity;
  message: string;
  test: (m: Metrics) => boolean;
}

// --- Safe defaults (produce a "Normal", score 0 state on first load) ----------
const DEFAULT_METRICS: Metrics = {
  totalNotes: 500,
  totalFolders: 50,
  totalLinks: 1000,
  notesPerTag: 10,
  coOccurringTags: 20,
  filesInFolder: 5,
  subFolderDepth: 2,
  tagsInNote: 3,
  linkBacklinkCount: 5,
  fileSizeKb: 5,
  k: 2.0,
};

// --- Slider layout, grouped per tab -------------------------------------------
const SLIDERS: Record<Exclude<TabName, "Message">, SliderDef[]> = {
  Global: [
    { key: "totalNotes", label: "Total Notes", min: 10, max: 10000, step: 1 },
    { key: "totalFolders", label: "Total Folders", min: 1, max: 500, step: 1 },
    { key: "totalLinks", label: "Total Links", min: 10, max: 20000, step: 1 },
    { key: "k", label: "Sensitivity Coefficient (K)", min: 1.0, max: 5.0, step: 0.1 },
  ],
  Tag: [
    { key: "notesPerTag", label: "Notes per Tag", min: 1, max: 1000, step: 1 },
    { key: "coOccurringTags", label: "Co-occurring Tags", min: 1, max: 100, step: 1 },
  ],
  Folder: [
    { key: "filesInFolder", label: "Files in Folder", min: 1, max: 1000, step: 1 },
    { key: "subFolderDepth", label: "Sub-folder Depth", min: 1, max: 10, step: 1 },
  ],
  Note: [
    { key: "tagsInNote", label: "Tags in Note", min: 0, max: 50, step: 1 },
    { key: "linkBacklinkCount", label: "Link / Backlink Count", min: 0, max: 200, step: 1 },
    { key: "fileSizeKb", label: "File Size", min: 1, max: 500, step: 1, unit: "KB" },
  ],
};

// --- Deterministic threshold logic --------------------------------------------
// Each met condition adds 20 points (max 100). Formulas are exactly as specified.
const CONDITIONS: ConditionDef[] = [
  {
    id: "architecturalImbalance",
    label: "Architectural Imbalance",
    severity: "CRITICAL",
    message:
      "[CRITICAL] This folder holds a disproportionate number of files compared to the vault average. Advice: Refactor by creating logical sub-folders.",
    test: (m) => m.filesInFolder > (m.totalNotes / m.totalFolders) * m.k,
  },
  {
    id: "contextualAmbiguity",
    label: "Contextual Ambiguity",
    severity: "WARNING",
    message:
      "[WARNING] This tag is applied to an excessive percentage of your total notes (Tag Abstractness). Advice: Delete the tag or split it into more specific sub-tags.",
    test: (m) => m.notesPerTag > (m.totalNotes / 10) * m.k,
  },
  {
    id: "networkHub",
    label: "Network Hub",
    severity: "CRITICAL",
    message:
      "[CRITICAL] The link density of this note vastly exceeds the vault average. Advice: Isolate this hub note or visualize it using a subset graph.",
    test: (m) => m.linkBacklinkCount > (m.totalLinks / m.totalNotes) * Math.pow(m.k, 2),
  },
  {
    id: "monolithNote",
    label: "Monolith Note",
    severity: "WARNING",
    message:
      "[WARNING] This note is a monolith. It has a large file size but very few links. Advice: Break down the content into smaller, linked atomic notes.",
    test: (m) =>
      m.fileSizeKb > 15 * m.k && m.linkBacklinkCount < m.totalLinks / m.totalNotes / m.k,
  },
  {
    id: "interfaceBloat",
    label: "Interface Bloat",
    severity: "WARNING",
    message:
      "[WARNING] Note contains excessive tags relative to co-occurring tag variance. Advice: Group related tags or use a hierarchical structure.",
    test: (m) => m.tagsInNote > m.coOccurringTags / m.k,
  },
];

const OK_MESSAGE = "[OK] System status: Normal. Cognitive load is optimal.";

// --- Small presentational helpers (CSS geometric indicators, no emojis) -------
const SEVERITY_DOT: Record<Severity | "OK", string> = {
  CRITICAL: "bg-red-500",
  WARNING: "bg-amber-400",
  OK: "bg-emerald-400",
};

function StatusDot({ tone }: { tone: Severity | "OK" }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 flex-none rounded-sm ${SEVERITY_DOT[tone]}`}
      aria-hidden="true"
    />
  );
}

function scoreBand(score: number): { color: string; bar: string; label: string } {
  // 0-20 -> Low (green); 40-60 -> Moderate (amber); 80-100 -> High (red).
  if (score < 40) return { color: "text-emerald-400", bar: "bg-emerald-500", label: "Low" };
  if (score < 80) return { color: "text-amber-400", bar: "bg-amber-500", label: "Moderate" };
  return { color: "text-red-400", bar: "bg-red-500", label: "High / Critical" };
}

function formatValue(v: number, step: number): string {
  const s = step < 1 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US");
  return s;
}

// --- Slider row (presentational; value + onChange are owned by the parent) ----
function SliderRow({
  def,
  value,
  onChange,
}: {
  def: SliderDef;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-700/70 bg-slate-800/60 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium text-slate-200">{def.label}</label>
        <span className="font-mono text-sm tabular-nums text-sky-300">
          {formatValue(value, def.step)}
          {def.unit ? ` ${def.unit}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-500"
      />
      <div className="mt-1 flex justify-between font-mono text-[11px] text-slate-500">
        <span>{def.step < 1 ? def.min.toFixed(1) : def.min.toLocaleString("en-US")}</span>
        <span>{def.step < 1 ? def.max.toFixed(1) : def.max.toLocaleString("en-US")}</span>
      </div>
    </div>
  );
}

// --- Top gauge / progress bar for the total cognitive load score --------------
function ScoreGauge({ score }: { score: number }) {
  const band = scoreBand(score);
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-4">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">
            Total Cognitive Load Score
          </div>
          <div className={`text-3xl font-bold tabular-nums ${band.color}`}>
            {score}
            <span className="ml-1 text-base font-normal text-slate-500">/ 100</span>
          </div>
        </div>
        <div className={`flex items-center gap-2 text-sm font-semibold ${band.color}`}>
          <StatusDot tone={score < 40 ? "OK" : score < 80 ? "WARNING" : "CRITICAL"} />
          {band.label}
        </div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full transition-all duration-200 ${band.bar}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        <span>0</span>
        <span>20</span>
        <span>40</span>
        <span>60</span>
        <span>80</span>
        <span>100</span>
      </div>
    </div>
  );
}

// --- Message tab (active alerts only, derived from current state) -------------
function MessagePanel({ triggered }: { triggered: ConditionDef[] }) {
  if (triggered.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-emerald-700/50 bg-emerald-900/20 p-4">
        <StatusDot tone="OK" />
        <p className="text-sm leading-relaxed text-emerald-200">{OK_MESSAGE}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {triggered.map((c) => {
        const critical = c.severity === "CRITICAL";
        return (
          <div
            key={c.id}
            className={`flex items-start gap-3 rounded-lg border p-4 ${
              critical
                ? "border-red-700/50 bg-red-900/20"
                : "border-amber-700/50 bg-amber-900/20"
            }`}
          >
            <span className="mt-1">
              <StatusDot tone={c.severity} />
            </span>
            <div>
              <div
                className={`mb-1 text-xs font-semibold uppercase tracking-wider ${
                  critical ? "text-red-300" : "text-amber-300"
                }`}
              >
                {c.label}
              </div>
              <p
                className={`text-sm leading-relaxed ${
                  critical ? "text-red-100" : "text-amber-100"
                }`}
              >
                {c.message}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Main component (parent owns all state) -----------------------------------
export default function CognitiveLoadSimulator() {
  const [metrics, setMetrics] = useState<Metrics>(DEFAULT_METRICS);
  const [activeTab, setActiveTab] = useState<TabName>("Global");

  const update = (key: MetricKey, value: number) =>
    setMetrics((m) => ({ ...m, [key]: value }));

  const reset = () => setMetrics(DEFAULT_METRICS);

  // Derived: which conditions are active right now + the resulting score.
  const { triggered, score } = useMemo(() => {
    const hits = CONDITIONS.filter((c) => c.test(metrics));
    return { triggered: hits, score: Math.min(100, hits.length * 20) };
  }, [metrics]);

  const tabs: TabName[] = ["Global", "Tag", "Folder", "Note", "Message"];

  return (
    <div className="min-h-screen bg-slate-900 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-100">
              Cognitive Load Simulator
            </h1>
            <p className="text-xs text-slate-400">
              Vault structure stress model for an Obsidian-style note system
            </p>
          </div>
          <button
            onClick={reset}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700"
          >
            Reset to defaults
          </button>
        </div>

        {/* Score gauge (always visible) */}
        <ScoreGauge score={score} />

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg bg-slate-800/60 p-1">
          {tabs.map((t) => {
            const active = t === activeTab;
            const showCount = t === "Message" && triggered.length > 0;
            return (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sky-600 text-white"
                    : "text-slate-300 hover:bg-slate-700/60"
                }`}
              >
                {t}
                {showCount ? (
                  <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                    {triggered.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
          {activeTab === "Message" ? (
            <MessagePanel triggered={triggered} />
          ) : (
            <div className="space-y-3">
              {SLIDERS[activeTab].map((def) => (
                <SliderRow
                  key={def.key}
                  def={def}
                  value={metrics[def.key]}
                  onChange={(v) => update(def.key, v)}
                />
              ))}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-500">
          Score adds 20 points per triggered condition (max 100). All formulas read
          the global metrics simultaneously; K scales every threshold.
        </p>
      </div>
    </div>
  );
}
