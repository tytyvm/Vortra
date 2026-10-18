"use client";
import { useEffect, useState } from "react";

interface SettingsData {
  email: string;
  timezone: string;
  recapDaily: boolean;
  recapWeekly: boolean;
  recapsAvailable: boolean;
  billingEnabled: boolean;
  plan: string;
  hasCustomer: boolean;
  usage: { spentUsd: number; limitUsd: number };
  profile: Record<string, unknown> & { targets?: Record<string, number> };
  trainingPlan: string | null;
}

const LABELS: Record<string, string> = {
  name: "Name",
  age: "Age",
  sex: "Sex",
  height: "Height",
  weight: "Weight",
  activity_level: "Activity",
  training_frequency: "Training",
  experience: "Experience",
  equipment: "Equipment",
  schedule: "Schedule",
  goal: "Goal",
  maintenance_kcal: "Maintenance",
  food_preferences: "Food preferences",
  injuries: "Injuries",
  notes: "Notes",
};

export function Settings() {
  const [s, setS] = useState<SettingsData | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    fetch("/api/settings").then(async (r) => r.ok && setS(await r.json()));
  }, []);

  async function save(changes: Partial<SettingsData>) {
    setS((x) => (x ? { ...x, ...changes } : x));
    await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
  }
  async function billing(path: "checkout" | "portal") {
    const r = await fetch(`/api/billing/${path}`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (d.url) location.href = d.url;
    else alert(d.error ?? "Billing unavailable");
  }
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/";
  }
  async function deleteAccount() {
    const r = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: confirmText }),
    });
    if (r.ok) location.href = "/";
    else alert((await r.json().catch(() => ({}))).error ?? "Couldn't delete");
  }

  if (!s) return <main className="page"><p className="muted">Loading...</p></main>;
  const t = s.profile.targets;

  return (
    <main className="page">
      <section className="card">
        <h2>Your targets</h2>
        {t ? (
          <p style={{ margin: 0 }}>
            {t.kcal ? `${Math.round(t.kcal)} kcal` : ""} {t.protein_g ? `· P ${t.protein_g} g` : ""} {t.carbs_g ? `· C ${t.carbs_g} g` : ""}{" "}
            {t.fat_g ? `· F ${t.fat_g} g` : ""} {t.fiber_g ? `· Fiber ${t.fiber_g} g` : ""}
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Not set yet. Ask your coach to set up your goals.</p>
        )}
        <h3>Profile</h3>
        {Object.entries(s.profile).filter(([k]) => k !== "targets" && k !== "units").length ? (
          <div className="small">
            {Object.entries(s.profile)
              .filter(([k]) => k !== "targets" && k !== "units")
              .map(([k, v]) => (
                <div key={k}>
                  <span className="muted">{LABELS[k] ?? k}:</span> {String(v)}
                </div>
              ))}
          </div>
        ) : (
          <p className="muted small">Empty.</p>
        )}
        <p className="muted small">To change anything, just tell your coach in chat.</p>
        {s.trainingPlan && (
          <>
            <h3>Training plan</h3>
            <pre className="plan">{s.trainingPlan}</pre>
          </>
        )}
      </section>

      <section className="card">
        <h2>Preferences</h2>
        <label className="field">
          Time zone
          <input defaultValue={s.timezone} onBlur={(e) => e.target.value !== s.timezone && save({ timezone: e.target.value })} />
        </label>
        {s.recapsAvailable ? (
          <>
            <label className="toggle">
              Daily evening recap
              <input type="checkbox" checked={s.recapDaily} onChange={(e) => save({ recapDaily: e.target.checked })} />
            </label>
            <label className="toggle">
              Weekly recap (Sundays)
              <input type="checkbox" checked={s.recapWeekly} onChange={(e) => save({ recapWeekly: e.target.checked })} />
            </label>
          </>
        ) : (
          <p className="muted small">Recaps are turned off on this server.</p>
        )}
      </section>

      <section className="card">
        <h2>Usage</h2>
        <p className="small" style={{ margin: "0 0 8px" }}>
          This month: ${s.usage.spentUsd.toFixed(2)} of ${s.usage.limitUsd.toFixed(2)} estimated AI cost
          {s.billingEnabled ? ` · plan: ${s.plan}` : ""}
        </p>
        {s.billingEnabled && (
          <div className="stack">
            {s.plan !== "pro" && <button className="btn primary" onClick={() => billing("checkout")}>Upgrade</button>}
            {s.hasCustomer && <button className="btn" onClick={() => billing("portal")}>Manage subscription</button>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Your data</h2>
        <div className="stack">
          <a className="btn" href="/api/account/export?format=json">Export all (JSON)</a>
          <a className="btn" href="/api/account/export?format=csv&table=meals">Meals CSV</a>
          <a className="btn" href="/api/account/export?format=csv&table=exercise">Workouts CSV</a>
          <a className="btn" href="/api/account/export?format=csv&table=weight">Weights CSV</a>
        </div>
        <h3>Delete account</h3>
        <p className="small muted">Permanently deletes your account, chats and logs. Type DELETE to confirm.</p>
        <div className="stack">
          <input className="text-input" style={{ maxWidth: 160 }} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
          <button className="btn danger" disabled={confirmText !== "DELETE"} onClick={deleteAccount}>Delete my account</button>
        </div>
      </section>

      <section className="card">
        <div className="stack" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <span className="small muted">Signed in as {s.email}</span>
          <button className="btn" onClick={logout}>Sign out</button>
        </div>
      </section>
    </main>
  );
}
