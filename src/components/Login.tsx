"use client";
import { useState } from "react";

export function Login({ expired }: { expired?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(expired ? "That sign-in link expired or was already used. Request a new one." : "");
  const [devLink, setDevLink] = useState<string | undefined>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const res = await fetch("/api/auth/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setState("idle");
      return;
    }
    setDevLink(data.devLink);
    setState("sent");
  }

  return (
    <div className="app">
      <div className="login">
        <div className="brand-dot" style={{ width: 44, height: 44 }} aria-hidden />
        <h1>Vortra</h1>
        <p>Your personal nutrition coach and trainer. Chat to log meals, workouts and weigh-ins.</p>
        {state === "sent" ? (
          <>
            <p>Check your email for a sign-in link.</p>
            {devLink && (
              <div className="notice-box">
                Dev mode (console email): <a href={devLink}>sign in here</a>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={submit}>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
            />
            <button className="btn primary" disabled={state === "sending"}>
              {state === "sending" ? "Sending..." : "Email me a sign-in link"}
            </button>
            {error && <div className="error-text">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
