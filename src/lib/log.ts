// Minimal structured logger. NEVER pass message text, food, weights, profile data or
// other health data here: only event names, ids, counts, status codes and durations.
type Meta = Record<string, string | number | boolean | null | undefined>;

function out(level: "info" | "warn" | "error", event: string, meta?: Meta) {
  if (process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...meta });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, meta?: Meta) => out("info", event, meta),
  warn: (event: string, meta?: Meta) => out("warn", event, meta),
  error: (event: string, meta?: Meta) => out("error", event, meta),
};
