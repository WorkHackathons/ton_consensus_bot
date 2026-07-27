import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createApiRouter from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ bot, config, state, webhookHandler } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => {
    const snapshot = state.snapshot();
    res.status(200).json({
      status: "ok", uptimeSeconds: snapshot.uptimeSeconds, network: config.network,
      telegramMode: config.telegramMode, version: config.version, commit: config.commit,
      timestamp: new Date().toISOString(),
    });
  });
  app.get("/ready", (_req, res) => {
    const snapshot = state.snapshot();
    res.status(state.isReady() ? 200 : 503).json({
      httpStarted: snapshot.httpStarted, databaseInitialized: snapshot.databaseInitialized,
      telegramInitialized: snapshot.telegramInitialized, shuttingDown: snapshot.shuttingDown,
      ready: state.isReady(),
    });
  });
  app.get("/tonconnect-manifest.json", (_req, res) => {
    const baseUrl = config.miniAppUrl || `http://localhost:${config.port}/miniapp`;
    const origin = new URL(baseUrl).origin;
    res.json({ url: baseUrl, name: "TON Consensus", iconUrl: `${origin}/miniapp/icon.svg`, termsOfUseUrl: baseUrl, privacyPolicyUrl: baseUrl });
  });
  if (config.telegramMode === "webhook" && webhookHandler) {
    app.post(config.webhookPath, (req, res, next) => {
      if (req.get("x-telegram-bot-api-secret-token") !== config.webhookSecret) return res.sendStatus(403);
      return webhookHandler(req, res, next);
    });
  }
  app.use("/api", createApiRouter(bot));
  app.use("/miniapp", express.static(path.resolve(__dirname, "../miniapp-react/dist")));
  return app;
}
