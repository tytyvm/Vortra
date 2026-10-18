// Pluggable email sending. Add a provider by adding a case below.
import { config } from "./config";
import { log } from "./log";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const c = config().email;
  switch (c.provider) {
    case "console": {
      if (config().isProd) throw new Error("EMAIL_PROVIDER=console is for local development only");
      // Dev only: prints the email (e.g. the login link) to the server terminal.
      console.log(`\n[email to ${msg.to}] ${msg.subject}\n${msg.text}\n`);
      return;
    }
    case "resend": {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${c.resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: c.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      });
      if (!res.ok) {
        log.error("email_failed", { provider: "resend", status: res.status });
        throw new Error("email send failed");
      }
      return;
    }
    case "postmark": {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "X-Postmark-Server-Token": c.postmarkToken, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ From: c.from, To: msg.to, Subject: msg.subject, TextBody: msg.text, HtmlBody: msg.html }),
      });
      if (!res.ok) {
        log.error("email_failed", { provider: "postmark", status: res.status });
        throw new Error("email send failed");
      }
      return;
    }
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${c.provider}"`);
  }
}
