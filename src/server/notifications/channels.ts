import nodemailer, { type Transporter } from "nodemailer";
import { log } from "@/lib/logger";

export interface SendResult {
  status: "sent" | "skipped";
  providerMessageId?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

let transport: Transporter | null = null;

/** SMTP (Postmark/Resend/anything with SMTP). Without SMTP_URL the send is skipped and logged. */
export async function sendEmail(to: string, subject: string, text: string, attachments: EmailAttachment[] = []): Promise<SendResult> {
  const url = process.env.SMTP_URL;
  if (!url) {
    log.info("email.skipped_no_smtp", { subject });
    return { status: "skipped" };
  }
  transport ??= nodemailer.createTransport(url);
  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "Etamico <orders@halalfresh.de>",
    to,
    subject,
    text,
    attachments,
  });
  return { status: "sent", providerMessageId: info.messageId };
}

/** seven.io SMS. Sender name "Etamico". Without SEVEN_API_KEY the send is skipped and logged. */
export async function sendSms(to: string, text: string): Promise<SendResult> {
  const key = process.env.SEVEN_API_KEY;
  if (!key) {
    log.info("sms.skipped_no_key", {});
    return { status: "skipped" };
  }
  const res = await fetch("https://gateway.seven.io/api/sms", {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ to, text, from: process.env.SMS_SENDER ?? "Etamico" }),
  });
  if (!res.ok) throw new Error(`SMS provider HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
  return { status: "sent", providerMessageId: body.messages?.[0]?.id };
}

/** Telegram bot message to the admin. Without token/chat the send is skipped. */
export async function sendTelegram(chatId: string, text: string): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) {
    log.info("telegram.skipped_not_configured", {});
    return { status: "skipped" };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { result?: { message_id?: number } };
  return { status: "sent", providerMessageId: String(body.result?.message_id ?? "") };
}
