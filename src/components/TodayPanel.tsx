"use client";
import { useState } from "react";
import type { TodayView } from "@/lib/views";

function Bar({ label, value, target, color }: { label: string; value: number; target?: number; color: string }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="bar">
      <label>
        <span>{label}</span>
        <span>
          {Math.round(value)}
          {target ? `/${Math.round(target)}` : ""} g
        </span>
      </label>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function TodayPanel({ today }: { today: TodayView | null }) {
  const [open, setOpen] = useState(true);
  if (!today) return null;
  const t = today.totals;
  const g = today.targets ?? {};
  const kcalPct = g.kcal ? Math.min(100, (t.kcal / g.kcal) * 100) : 0;
  const left = g.kcal ? Math.round(g.kcal - t.kcal) : null;
  return (
    <section className="today" aria-label="Today">
      <div className="today-head">
        <span className="today-title">Today · estimates</span>
        <button className="today-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div className="kcal-line">
        <strong>{t.kcal.toLocaleString()}</strong>
        {g.kcal ? ` / ${Math.round(g.kcal).toLocaleString()} kcal` : " kcal"}
        {left != null && <span className="muted"> · {left >= 0 ? `${left.toLocaleString()} left` : `${(-left).toLocaleString()} over`}</span>}
      </div>
      {open && (
        <>
          {g.kcal ? (
            <div className="track" style={{ marginBottom: 10 }}>
              <div className={`fill ${t.kcal > g.kcal ? "over" : ""}`} style={{ width: `${kcalPct}%` }} />
            </div>
          ) : null}
          <div className="bars">
            <Bar label="Protein" value={t.protein_g} target={g.protein_g} color="var(--bar-protein)" />
            <Bar label="Carbs" value={t.carbs_g} target={g.carbs_g} color="var(--bar-carbs)" />
            <Bar label="Fat" value={t.fat_g} target={g.fat_g} color="var(--bar-fat)" />
          </div>
          <div className="today-meta">
            <span>
              Workout:{" "}
              {today.exercises.length
                ? today.exercises.map((x) => x.exercise).filter((v, i, a) => a.indexOf(v) === i).join(", ")
                : "none yet"}
            </span>
            <span>
              Weight: {today.lastWeight ? `${today.lastWeight.weight} ${today.lastWeight.unit}${today.lastWeight.day !== today.day ? ` (${today.lastWeight.day})` : ""}` : "—"}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
