import "dotenv/config";
import { createApp } from "./app.js";
import { initDB } from "./db.js";
import bot, { startBotJobs, stopBotJobs } from "./bot.js";
import { parseConfig, redactConfig } from "./runtime/config.js";
import { createRuntimeState } from "./runtime/state.js";
import { createTelegramRuntime } from "./runtime/telegram.js";
import { logger } from "./logger.js";

export async function startServer({ env = process.env, botInstance = bot, registerProcessHandlers = true } = {}) {
  const config = parseConfig(env, { allowDisabled: true });
  const state = createRuntimeState();
  initDB();
  state.markDatabaseInitialized();
  const webhookHandler = config.telegramMode === "webhook" ? botInstance.webhookCallback(config.webhookPath) : undefined;
  const app = createApp({ bot: botInstance, config, state, webhookHandler });
  const telegram = createTelegramRuntime({ bot: botInstance, config, state, logger });
  const server = await new Promise((resolve, reject) => {
    const candidate = app.listen(config.port, config.host, () => resolve(candidate));
    candidate.once("error", reject);
  });
  state.markHttpStarted();
  logger.info(`[RUNTIME] HTTP listening on ${config.host}:${config.port} ${JSON.stringify(redactConfig(config))}`);
  // Settlement jobs can initiate financial side effects, so they require an
  // explicit production opt-in after the recovery deployment is verified.
  if (env.ENABLE_SETTLEMENT_JOBS === "1") startBotJobs();
  else logger.warn("[RUNTIME] settlement jobs disabled; set ENABLE_SETTLEMENT_JOBS=1 only after operator verification");
  telegram.start().catch(() => {});
  let closing = false;
  const shutdown = async (reason = "shutdown") => {
    if (closing) return;
    closing = true;
    state.markShuttingDown();
    stopBotJobs();
    await telegram.stop(reason).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  };
  if (registerProcessHandlers) {
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("unhandledRejection", (error) => { state.recordStartupError(error); logger.error("[PROCESS] unhandled rejection"); });
    process.once("uncaughtException", (error) => { state.recordStartupError(error); logger.error("[PROCESS] uncaught exception"); shutdown("uncaughtException"); });
  }
  return { app, config, state, server, shutdown, telegram };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  startServer().catch((error) => {
    console.error(`[RUNTIME] startup failed: ${error.name}`);
    process.exitCode = 1;
  });
}
