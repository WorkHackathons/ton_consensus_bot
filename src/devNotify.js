import fetch from "node-fetch";
import { logger } from "./logger.js";

const DEV_CHAT_ID = process.env.DEV_CHAT_ID ? Number(process.env.DEV_CHAT_ID) : null;

function truncate(text, max = 3500) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function notifyDev(message) {
  if (!DEV_CHAT_ID || !process.env.TELEGRAM_TOKEN) {
    return false;
  }

  const text = `🚨 <b>TON Consensus Error</b>\n\n<code>${escapeHtml(truncate(message))}</code>`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: DEV_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      logger.warn(`[DEV_NOTIFY] Failed with status ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    logger.warn(`[DEV_NOTIFY] ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function notifyDevInfo(message) {
  if (!DEV_CHAT_ID || !process.env.TELEGRAM_TOKEN) {
    return false;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: DEV_CHAT_ID,
        text: truncate(message),
        disable_web_page_preview: true,
      }),
    });

    return response.ok;
  } catch (error) {
    logger.warn(`[DEV_NOTIFY_INFO] ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
