"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import type { TodayView } from "@/lib/views";
import { resizeImage } from "./resizeImage";
import { TodayPanel } from "./TodayPanel";

export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "notice" | "error";
  content: string;
  kind?: string;
  hasImage?: boolean;
  imageUrl?: string;
  tools?: { name: string; ok: boolean }[];
}

const TOOL_LABELS: Record<string, string> = {
  log_meal: "Meal logged",
  log_exercise: "Exercise logged",
  log_weight: "Weight logged",
  edit_entry: "Entry updated",
  delete_entry: "Entry deleted",
  update_profile: "Profile updated",
  save_plan: "Plan saved",
};

const SUGGESTIONS = [
  "Hi! Help me set up my goals.",
  "I had 2 eggs, toast and a coffee for breakfast",
  "Bench press 135x8, 155x6, 155x5",
  "I weigh 182.4 lb this morning",
];

export function Chat({ initialMessages, initialToday, userTz }: { initialMessages: UIMessage[]; initialToday: TodayView; userTz: string }) {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [today, setToday] = useState<TodayView>(initialToday);
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ mimeType: string; data: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [hasMore, setHasMore] = useState(initialMessages.length >= 40);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  const scrollDown = useCallback(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(scrollDown, [messages, waiting, scrollDown]);

  const refreshToday = useCallback(async () => {
    const res = await fetch("/api/today");
    if (res.ok) setToday(await res.json());
  }, []);

  // Keep the account's time zone in sync with the device so "today" is the user's today.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== userTz) {
      fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: tz }) }).then((r) => {
        if (r.ok) refreshToday();
      });
    }
  }, [userTz, refreshToday]);

  async function loadOlder() {
    const first = messages.find((m) => !m.id.startsWith("local-"));
    if (!first) return;
    const res = await fetch(`/api/messages?before=${encodeURIComponent(first.id)}`);
    if (!res.ok) return;
    const data = await res.json();
    stick.current = false;
    setHasMore(data.messages.length >= 40);
    setMessages((m) => [...data.messages, ...m]);
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setImage(await resizeImage(f));
    } catch {
      alert("Couldn't read that photo. Try a JPEG or PNG.");
    }
  }

  async function send(override?: string) {
    const msg = (override ?? text).trim();
    if ((!msg && !image) || busy) return;
    const img = image;
    setText("");
    setImage(null);
    setBusy(true);
    setWaiting(true);
    stick.current = true;
    const botId = `local-bot-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: `local-user-${Date.now()}`, role: "user", content: msg, hasImage: !!img, imageUrl: img?.url },
    ]);

    const update = (fn: (b: UIMessage) => UIMessage) =>
      setMessages((m) => {
        const i = m.findIndex((x) => x.id === botId);
        if (i < 0) return [...m, fn({ id: botId, role: "assistant", content: "", tools: [] })];
        const copy = [...m];
        copy[i] = fn(copy[i]);
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: msg,
          image: img ? { mimeType: img.mimeType, data: img.data } : undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMessages((m) => [...m, { id: `local-err-${Date.now()}`, role: "error", content: data.error ?? "Couldn't send. Try again." }]);
        if (res.status === 401) location.reload();
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "text") {
            setWaiting(false);
            update((b) => ({ ...b, content: b.content + ev.delta }));
          } else if (ev.type === "tool") {
            update((b) => ({ ...b, tools: [...(b.tools ?? []), { name: ev.name, ok: ev.ok }] }));
            if (ev.ok) refreshToday();
          } else if (ev.type === "notice") {
            setWaiting(false);
            setMessages((m) => [...m, { id: `local-n-${Date.now()}`, role: "notice", content: ev.text }]);
          } else if (ev.type === "error") {
            setWaiting(false);
            setMessages((m) => [...m, { id: `local-e-${Date.now()}`, role: "error", content: ev.message }]);
          }
        }
      }
    } catch {
      setMessages((m) => [...m, { id: `local-e-${Date.now()}`, role: "error", content: "Connection lost. Try again." }]);
    } finally {
      setBusy(false);
      setWaiting(false);
      refreshToday();
      inputRef.current?.focus();
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <TodayPanel today={today} />
      <div
        className="messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {hasMore && (
          <button className="load-more" onClick={loadOlder}>
            Load earlier messages
          </button>
        )}
        {messages.length === 0 && (
          <div className="empty">
            <div className="brand-dot" style={{ width: 40, height: 40, margin: "0 auto" }} aria-hidden />
            <h2>Hi, I&apos;m Vortra</h2>
            <div>Your nutrition coach and trainer. Tell me what you eat, how you train, and what you weigh, by text or photo.</div>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {waiting && (
          <div className="msg assistant typing" aria-label="Coach is typing">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <div className="composer">
        {image && (
          <div className="preview">
            <img src={image.url} alt="Selected photo" />
            <button onClick={() => setImage(null)}>Remove</button>
          </div>
        )}
        <div className="row">
          <button className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Add photo" title="Add photo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
          <textarea
            ref={inputRef}
            className="input"
            rows={1}
            placeholder="Message your coach..."
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
            }}
            onKeyDown={onKey}
            aria-label="Message"
          />
          <button className="send-btn" onClick={() => send()} disabled={busy || (!text.trim() && !image)} aria-label="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

function Message({ m }: { m: UIMessage }) {
  if (m.role === "user") {
    return (
      <div className="msg user">
        {m.imageUrl && <img className="thumb" src={m.imageUrl} alt="Your photo" />}
        {m.hasImage && !m.imageUrl && <div className="photo-tag">📷 Photo</div>}
        {m.content}
      </div>
    );
  }
  if (m.role === "notice" || m.role === "error") return <div className={`msg ${m.role}`}>{m.content}</div>;
  const chips = (m.tools ?? []).filter((t) => TOOL_LABELS[t.name] || !t.ok);
  return (
    <>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((t, i) => (
            <span key={i} className={`chip ${t.ok ? "" : "bad"}`}>
              {t.ok ? `✓ ${TOOL_LABELS[t.name]}` : "Couldn't save"}
            </span>
          ))}
        </div>
      )}
      {m.content && (
        <div className={`msg assistant ${m.kind === "recap" ? "recap" : ""}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
      )}
    </>
  );
}
