import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { ConfigurationError, parseConfig, redactConfig } from "../src/runtime/config.js";
import { createRuntimeState } from "../src/runtime/state.js";
import { classifyTelegramError, createTelegramRuntime } from "../src/runtime/telegram.js";
import { redactWalletAddress } from "../src/logger.js";

const baseEnv = { NETWORK: "testnet", TELEGRAM_TOKEN: "token", MINIAPP_URL: "https://example.test/miniapp" };

test("configuration uses PORT before API_PORT and binds a safe host", () => {
  const config = parseConfig({ ...baseEnv, PORT: "4567", API_PORT: "9999" });
  assert.equal(config.port, 4567);
  assert.equal(config.host, "0.0.0.0");
});

test("configuration validates core variables, modes, webhook requirements, and mainnet guard", () => {
  assert.throws(() => parseConfig({ NETWORK: "testnet" }), ConfigurationError);
  assert.throws(() => parseConfig({ ...baseEnv, NETWORK: "mainnet" }), /blocked/);
  assert.throws(() => parseConfig({ ...baseEnv, TELEGRAM_MODE: "webhook" }), /WEBHOOK_BASE_URL/);
  const webhook = parseConfig({ ...baseEnv, TELEGRAM_MODE: "webhook", WEBHOOK_BASE_URL: "https://service.example", TELEGRAM_WEBHOOK_PATH: "/tg", TELEGRAM_WEBHOOK_SECRET: "secret" });
  assert.equal(webhook.telegramMode, "webhook");
});

test("redacted diagnostics never expose configured secret values", () => {
  const config = parseConfig({ ...baseEnv, TELEGRAM_TOKEN: "super-secret", DATABASE_URL: "postgres://private" });
  const diagnostic = JSON.stringify(redactConfig(config));
  assert.equal(diagnostic.includes("super-secret"), false);
  assert.equal(diagnostic.includes("postgres://private"), false);
});

test("wallet log values are redacted", () => {
  const address = "EQaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const redacted = redactWalletAddress(address);
  assert.equal(redacted.includes(address), false);
  assert.match(redacted, /^<wallet:/);
});

test("health and readiness endpoints return only safe runtime state", async () => {
  const state = createRuntimeState();
  const config = parseConfig(baseEnv);
  const app = createApp({ bot: {}, config, state });
  const server = await new Promise((resolve) => { const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate)); });
  const address = server.address();
  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await health.json()).sort(), ["commit", "network", "status", "telegramMode", "timestamp", "uptimeSeconds", "version"]);
  const notReady = await fetch(`http://127.0.0.1:${address.port}/ready`);
  assert.equal(notReady.status, 503);
  state.markHttpStarted(); state.markDatabaseInitialized(); state.markTelegramInitialized();
  const ready = await fetch(`http://127.0.0.1:${address.port}/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).ready, true);
  await new Promise((resolve) => server.close(resolve));
});

test("webhook route verifies the Telegram secret before dispatch", async () => {
  const state = createRuntimeState();
  const config = parseConfig({ ...baseEnv, TELEGRAM_MODE: "webhook", WEBHOOK_BASE_URL: "https://service.example", TELEGRAM_WEBHOOK_PATH: "/telegram/hook", TELEGRAM_WEBHOOK_SECRET: "safe-secret" });
  const app = createApp({ bot: {}, config, state, webhookHandler: (_req, res) => res.sendStatus(200) });
  const server = await new Promise((resolve) => { const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate)); });
  const port = server.address().port;
  assert.equal((await fetch(`http://127.0.0.1:${port}/telegram/hook`, { method: "POST" })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/telegram/hook`, { method: "POST", headers: { "x-telegram-bot-api-secret-token": "safe-secret" } })).status, 200);
  await new Promise((resolve) => server.close(resolve));
});

test("telegram runtime prevents duplicate launches and retry timer overlap", async () => {
  const state = createRuntimeState();
  const config = parseConfig(baseEnv);
  let launches = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const bot = { telegram: { getWebhookInfo: async () => ({ url: "" }) }, launch: async () => { launches += 1; await wait; }, stop() {} };
  const runtime = createTelegramRuntime({ bot, config, state, logger: { info() {}, warn() {}, error() {} } });
  const first = runtime.start();
  const second = runtime.start();
  assert.strictEqual(first, second);
  release();
  await first;
  assert.equal(launches, 1);

  let timerCount = 0;
  const transientBot = { telegram: { getWebhookInfo: async () => ({ url: "" }) }, launch: async () => { throw new Error("ETIMEDOUT"); }, stop() {} };
  const transient = createTelegramRuntime({ bot: transientBot, config, state: createRuntimeState(), logger: { info() {}, warn() {}, error() {} }, setTimer: () => { timerCount += 1; return timerCount; }, clearTimer() {} });
  await assert.rejects(transient.start());
  await assert.rejects(transient.start());
  assert.equal(timerCount, 1);
  assert.equal(transient.hasRetryTimer(), true);
});

test("telegram error classification distinguishes permanent, conflict, and transient errors", () => {
  assert.equal(classifyTelegramError(new Error("401 Unauthorized")), "permanent");
  assert.equal(classifyTelegramError(new Error("409 Conflict")), "conflict");
  assert.equal(classifyTelegramError(new Error("ETIMEDOUT")), "transient");
});
