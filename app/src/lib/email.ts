import { config, emailEnabled } from "./config";

/**
 * Send one email through Resend. Only called when a key is configured; every
 * feature that needs email checks emailEnabled() first and hides itself.
 */
export async function sendEmail(input: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const c = config();
  if (!emailEnabled(c)) throw new Error("email is not configured: set RESEND_API_KEY");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${c.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: c.emailFrom, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend refused the email (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/** A plain code email. Short, because it is read on a phone in a hurry. */
export function codeEmail(code: string, purpose: string): { subject: string; text: string; html: string } {
  const subject = `${code} is your Indy code`;
  const text = `${code}\n\nUse this code to ${purpose}. It expires in 10 minutes.\nIf you did not ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1a1a18">
<p style="font-size:30px;letter-spacing:6px;font-weight:600;margin:0 0 16px">${code}</p>
<p style="margin:0 0 8px">Use this code to ${purpose}. It expires in 10 minutes.</p>
<p style="margin:0;color:#6d6b64">If you did not ask for it, you can ignore this email.</p></div>`;
  return { subject, text, html };
}
