const TRANSIENT = /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetcherror|network|timeout/i;

export function classifyTelegramError(error) {
  const detail = [error?.message, error?.response?.error_code, error?.code, error?.cause?.code].filter(Boolean).join(" ");
  if (/401|unauthorized/i.test(detail)) return "permanent";
  if (/409|conflict|another getupdates|webhook/i.test(detail)) return "conflict";
  return TRANSIENT.test(detail) ? "transient" : "permanent";
}

export function createTelegramRuntime({ bot, config, state, logger = console, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let startPromise = null;
  let retryTimer = null;
  let stopped = false;
  const cancelRetry = () => { if (retryTimer) clearTimer(retryTimer); retryTimer = null; };
  async function startPolling() {
    const webhook = await bot.telegram.getWebhookInfo();
    if (webhook?.url) await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await bot.launch({ allowedUpdates: ["message", "callback_query", "inline_query"] });
  }
  async function startWebhook() {
    await bot.telegram.setWebhook(`${config.webhookBaseUrl}${config.webhookPath}`, { secret_token: config.webhookSecret, allowed_updates: ["message", "callback_query", "inline_query"] });
  }
  function scheduleRetry(error) {
    if (retryTimer || stopped) return;
    retryTimer = setTimer(() => { retryTimer = null; start().catch(() => {}); }, 5_000);
    logger.warn(`[TELEGRAM] transient startup failure; retrying in 5s (${classifyTelegramError(error)})`);
  }
  function start() {
    if (!config.telegramEnabled) { state.markTelegramInitialized(true); return Promise.resolve(); }
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        if (config.telegramMode === "polling") await startPolling(); else await startWebhook();
        state.markTelegramInitialized(true);
        logger.info(`[TELEGRAM] ${config.telegramMode} initialized`);
      } catch (error) {
        const category = classifyTelegramError(error);
        state.recordStartupError(error);
        if (category === "transient") scheduleRetry(error);
        logger.error(`[TELEGRAM] startup ${category} failure`);
        throw error;
      } finally { startPromise = null; }
    })();
    return startPromise;
  }
  return {
    start,
    stop(reason = "shutdown") {
      stopped = true;
      cancelRetry();
      try { return Promise.resolve(bot.stop?.(reason)); }
      catch { return Promise.resolve(); }
    },
    hasRetryTimer() { return Boolean(retryTimer); },
  };
}
