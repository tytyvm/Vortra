import { ProviderError } from "./types";

/** Parse a Server-Sent Events body into {event, data} records. */
export async function* readSSE(res: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event = "message";
  let data: string[] = [];
  const flush = () => {
    const rec = data.length ? { event, data: data.join("\n") } : null;
    event = "message";
    data = [];
    return rec;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        const rec = flush();
        if (rec) yield rec;
      } else if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }
  if (buf.startsWith("data:")) data.push(buf.slice(5).replace(/^ /, ""));
  const rec = flush();
  if (rec) yield rec;
}

/** Throw a ProviderError with status only (bodies may echo user content, so they are not kept). */
export async function ensureOk(provider: string, res: Response) {
  if (res.ok) return;
  let detail = "";
  try {
    const body = await res.text();
    // Keep only a short machine-readable error type, never the full body.
    const m = body.match(/"(?:type|code|status)"\s*:\s*"([A-Za-z0-9_.-]{1,60})"/);
    detail = m ? m[1] : "";
  } catch {
    /* ignore */
  }
  throw new ProviderError(provider, res.status, `${provider} request failed (${res.status}${detail ? ` ${detail}` : ""})`);
}

export function safeParseArgs(raw: string): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalid_json: raw.slice(0, 200) };
  }
}
