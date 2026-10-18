"use client";
import { useCallback, useEffect, useState } from "react";
import type { MealItem, SetRow } from "@/lib/coach/totals";
import type { HistoryDay } from "@/lib/views";

type Meal = HistoryDay["meals"][number];
type Ex = HistoryDay["exercises"][number];
type W = HistoryDay["weights"][number];

async function patch(id: string, changes: unknown) {
  const res = await fetch(`/api/entries/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
  if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "Couldn't save");
  return res.ok;
}
async function remove(id: string) {
  if (!confirm("Delete this entry?")) return false;
  const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
  return res.ok;
}

const n = (v: string) => (v === "" ? 0 : Number(v));

function MealEditor({ meal, onDone }: { meal: Meal; onDone: (saved: boolean) => void }) {
  const [items, setItems] = useState<MealItem[]>(meal.items.map((i) => ({ ...i })));
  const set = (i: number, k: keyof MealItem, v: string) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: k === "name" || k === "portion" ? v : n(v) } : x)));
  return (
    <div>
      <div className="edit-grid">
        <span className="hdr">Item</span><span className="hdr">kcal</span><span className="hdr">P</span><span className="hdr">C</span><span className="hdr">F</span>
        {items.map((it, i) => (
          <FragmentRow key={i}>
            <input value={it.name} onChange={(e) => set(i, "name", e.target.value)} aria-label="Item name" />
            <input inputMode="decimal" value={it.kcal} onChange={(e) => set(i, "kcal", e.target.value)} aria-label="kcal" />
            <input inputMode="decimal" value={it.protein_g} onChange={(e) => set(i, "protein_g", e.target.value)} aria-label="protein" />
            <input inputMode="decimal" value={it.carbs_g} onChange={(e) => set(i, "carbs_g", e.target.value)} aria-label="carbs" />
            <input inputMode="decimal" value={it.fat_g} onChange={(e) => set(i, "fat_g", e.target.value)} aria-label="fat" />
          </FragmentRow>
        ))}
      </div>
      <div className="stack">
        <button className="btn small primary" onClick={async () => onDone(await patch(meal.id, { items }))}>Save</button>
        <button className="btn small" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </div>
  );
}

function SetsEditor({ ex, onDone }: { ex: Ex; onDone: (saved: boolean) => void }) {
  const [sets, setSets] = useState<SetRow[]>(ex.sets.map((s) => ({ ...s })));
  const set = (i: number, k: "weight" | "reps", v: string) => setSets((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: n(v) } : x)));
  return (
    <div>
      {sets.map((s, i) => (
        <div key={i} className="stack" style={{ margin: "4px 0", alignItems: "center" }}>
          <span className="small muted">Set {i + 1}</span>
          <input className="text-input" style={{ width: 80 }} inputMode="decimal" value={s.weight ?? 0} onChange={(e) => set(i, "weight", e.target.value)} aria-label="weight" />
          <span className="small">x</span>
          <input className="text-input" style={{ width: 64 }} inputMode="numeric" value={s.reps ?? 0} onChange={(e) => set(i, "reps", e.target.value)} aria-label="reps" />
          <span className="small muted">{s.unit}</span>
          <button className="btn small" onClick={() => setSets((xs) => xs.filter((_, j) => j !== i))} disabled={sets.length < 2}>Remove</button>
        </div>
      ))}
      <div className="stack">
        <button className="btn small primary" onClick={async () => onDone(await patch(ex.id, { sets }))}>Save</button>
        <button className="btn small" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </div>
  );
}

function WeightEditor({ w, onDone }: { w: W; onDone: (saved: boolean) => void }) {
  const [v, setV] = useState(String(w.weight));
  return (
    <div className="stack" style={{ alignItems: "center" }}>
      <input className="text-input" style={{ width: 100 }} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label="weight" />
      <span className="small">{w.unit}</span>
      <button className="btn small primary" onClick={async () => onDone(await patch(w.id, { weight: Number(v) }))}>Save</button>
      <button className="btn small" onClick={() => onDone(false)}>Cancel</button>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function History() {
  const [days, setDays] = useState<HistoryDay[] | null>(null);
  const [range, setRange] = useState(14);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/history?days=${range}`);
    if (res.ok) setDays((await res.json()).days);
  }, [range]);
  useEffect(() => {
    load();
  }, [load]);

  const done = (saved: boolean) => {
    setEditing(null);
    if (saved) load();
  };
  const del = async (id: string) => {
    if (await remove(id)) load();
  };
  const actions = (id: string) => (
    <div className="entry-actions">
      <button className="btn small" onClick={() => setEditing(id)}>Edit</button>
      <button className="btn small danger" onClick={() => del(id)}>Delete</button>
    </div>
  );

  return (
    <main className="page">
      <div className="stack" style={{ marginBottom: 12, alignItems: "center" }}>
        <span className="muted small">Show</span>
        {[7, 14, 30, 90].map((d) => (
          <button key={d} className={`btn small ${range === d ? "primary" : ""}`} onClick={() => setRange(d)}>
            {d} days
          </button>
        ))}
      </div>
      {days === null && <p className="muted">Loading...</p>}
      {days?.length === 0 && <p className="muted">Nothing logged yet. Chat with your coach to start.</p>}
      {days?.map((d) => (
        <section className="card" key={d.day}>
          <div className="day-head">
            <h2>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</h2>
            <span className="day-totals">
              ~{d.totals.kcal.toLocaleString()} kcal · P {Math.round(d.totals.protein_g)} · C {Math.round(d.totals.carbs_g)} · F {Math.round(d.totals.fat_g)} g
            </span>
          </div>
          {d.meals.length > 0 && <h3>Meals</h3>}
          {d.meals.map((m) => (
            <div className="entry" key={m.id}>
              <div className="entry-main">
                <div>
                  <strong style={{ textTransform: "capitalize" }}>{m.meal}</strong> <span className="entry-sub">{m.time} · ~{Math.round(m.kcal)} kcal · P {Math.round(m.protein_g)} g</span>
                </div>
                {editing === m.id ? (
                  <MealEditor meal={m} onDone={done} />
                ) : (
                  <div className="entry-sub">{m.items.map((i) => `${i.name}${i.portion ? ` (${i.portion})` : ""}`).join(", ")}</div>
                )}
              </div>
              {editing !== m.id && actions(m.id)}
            </div>
          ))}
          {d.exercises.length > 0 && <h3>Workout</h3>}
          {d.exercises.map((x) => (
            <div className="entry" key={x.id}>
              <div className="entry-main">
                <div>
                  <strong>{x.exercise}</strong> <span className="entry-sub">{x.time}{x.sessionType ? ` · ${x.sessionType}` : ""}</span>
                </div>
                {editing === x.id ? (
                  <SetsEditor ex={x} onDone={done} />
                ) : (
                  <div className="entry-sub">
                    {x.sets.map((s) => (s.unit === "bodyweight" ? `BW x${s.reps}` : `${s.weight}x${s.reps}`) + (s.notes ? ` (${s.notes})` : "")).join(", ")}
                    {x.sets[0]?.unit && x.sets[0].unit !== "bodyweight" ? ` ${x.sets[0].unit}` : ""}
                  </div>
                )}
              </div>
              {editing !== x.id && actions(x.id)}
            </div>
          ))}
          {d.weights.length > 0 && <h3>Weight</h3>}
          {d.weights.map((w) => (
            <div className="entry" key={w.id}>
              <div className="entry-main">
                {editing === w.id ? <WeightEditor w={w} onDone={done} /> : (
                  <div>
                    <strong>{w.weight} {w.unit}</strong> <span className="entry-sub">{w.time}</span>
                  </div>
                )}
              </div>
              {editing !== w.id && actions(w.id)}
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
