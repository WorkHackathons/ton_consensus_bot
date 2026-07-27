import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { refundBetWithClaim } from "../src/bot.js";
import { closeDatabase, getDatabase, initializeDatabase } from "../src/db/index.js";
import {
  configureOracleRetryTimersForTest,
  enableOracleRetryTimers,
  getOracleRetryTimerCount,
  handleArbiterVote,
  scheduleOracleRetry,
  stopOracleRetryTimers,
} from "../src/oracle.js";
import { parseConfig } from "../src/runtime/config.js";
import { createRuntimeState } from "../src/runtime/state.js";
import { startServer } from "../src/server.js";
import { BET_STATUS, OUTCOME } from "../src/states.js";

const baseEnv = {
  NETWORK: "testnet",
  TELEGRAM_TOKEN: "test-token",
  MINIAPP_URL: "https://example.test/miniapp",
};

async function withDatabase(callback) {
  await closeDatabase();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ton-consensus-lifecycle-"));
  const legacyPath = path.join(directory, "consensus.db");
  try {
    const database = await initializeDatabase({ backend: "legacy", legacyPath });
    await callback(database, legacyPath);
  } finally {
    await closeDatabase();
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function makeOracleBet(database, suffix = "") {
  for (const [id, username] of [[1, "creator"], [2, "opponent"], [3, "arbiter-one"], [4, "arbiter-two"], [5, "arbiter-three"]]) {
    await database.users.upsert(id, `${username}${suffix}`);
  }
  await database.users.saveTonAddress(1, "EQcreator-wallet");
  await database.users.saveTonAddress(2, "EQopponent-wallet");
  const betId = await database.bets.create(1, `Oracle concurrency ${suffix || "test"}`, 1, Math.floor(Date.now() / 1000) + 3600);
  assert.equal((await database.bets.join(betId, 2)).joined, true);
  await database.deposits.confirmAndMaybeActivate(betId, { role: "creator", participantId: 1 });
  await database.deposits.confirmAndMaybeActivate(betId, { role: "opponent", participantId: 2 });
  assert.equal(await database.bets.startOracle(betId), true);
  await database.oracle.assign(betId, [3, 4, 5]);
  assert.equal(await database.oracle.submitVote(betId, 3, 1), true);
  return betId;
}

function botSpy() {
  const messages = [];
  return {
    messages,
    telegram: {
      async sendMessage(...args) { messages.push(args); },
      async sendPhoto(...args) { messages.push(args); },
    },
  };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function telegramInitData(user, token = "test-token") {
  const params = new URLSearchParams({ auth_date: "1", user: JSON.stringify(user) });
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

test("oracle settlement claims allow exactly one concurrent payout and preserve its hash", async () => {
  await withDatabase(async (database) => {
    const betId = await makeOracleBet(database, "single");
    const bot = botSpy();
    let payouts = 0;
    const payoutFn = async () => {
      payouts += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return { winnerTxHash: "first-tx", arbiterTxHashes: [] };
    };

    const results = await Promise.all([
      handleArbiterVote(betId, 4, 1, bot, { payoutFn }),
      handleArbiterVote(betId, 5, 1, bot, { payoutFn }),
    ]);

    assert.equal(payouts, 1);
    assert.equal(results.filter((result) => result.done).length, 1);
    const settled = await database.bets.getById(betId);
    assert.equal(settled.status, BET_STATUS.done);
    assert.equal(settled.payout_txhash, "first-tx");
    const overwrite = await database.bets.finalizeClaimedSettlement(betId, { winnerId: 2, txHash: "second-tx" });
    assert.equal(overwrite.finalized, false);
    assert.equal((await database.bets.getById(betId)).payout_txhash, "first-tx");
  });
});

test("settlement failures are fail-closed and never schedule a second payout", async () => {
  await withDatabase(async (database) => {
    for (const [error, expectedStatus, suffix] of [
      [Object.assign(new Error("wallet rejected before broadcast"), { beforeBroadcast: true }), BET_STATUS.settlement_failed, "failed"],
      [new Error("connection lost after submit"), BET_STATUS.settlement_uncertain, "uncertain"],
    ]) {
      const betId = await makeOracleBet(database, suffix);
      let payouts = 0;
      const result = await handleArbiterVote(betId, 4, 1, botSpy(), {
        payoutFn: async () => { payouts += 1; throw error; },
      });
      assert.equal(result.done, false);
      assert.equal((await database.bets.getById(betId)).status, expectedStatus);
      await handleArbiterVote(betId, 5, 1, botSpy(), {
        payoutFn: async () => { payouts += 1; return { winnerTxHash: "must-not-send" }; },
      });
      assert.equal(payouts, 1);
    }
  });
});

test("atomic deposit confirmation cannot reactivate refunds and activates once", async () => {
  await withDatabase(async (database) => {
    await database.users.upsert(10, "creator");
    await database.users.upsert(11, "opponent");
    const refundedId = await database.bets.create(10, "Delayed verification", 1, Math.floor(Date.now() / 1000) + 3600);
    await database.bets.join(refundedId, 11);
    await database.bets.refund(refundedId);
    const late = await database.deposits.confirmAndMaybeActivate(refundedId, { role: "creator", participantId: 10 });
    assert.deepEqual({ accepted: late.accepted, activated: late.activated, reason: late.reason }, { accepted: false, activated: false, reason: "not_pending" });
    assert.equal((await database.bets.getById(refundedId)).status, BET_STATUS.refunded);

    const activeId = await database.bets.create(10, "Concurrent deposits", 1, Math.floor(Date.now() / 1000) + 3600);
    await database.bets.join(activeId, 11);
    const confirmations = await Promise.all([
      database.deposits.confirmAndMaybeActivate(activeId, { role: "creator", participantId: 10 }),
      database.deposits.confirmAndMaybeActivate(activeId, { role: "opponent", participantId: 11 }),
    ]);
    assert.equal(confirmations.filter((result) => result.activated).length, 1);
    const active = await database.bets.getById(activeId);
    assert.equal(active.status, BET_STATUS.active);
    assert.equal(active.creator_deposit, 1);
    assert.equal(active.opponent_deposit, 1);
    assert.equal((await database.bets.claimSettlement(activeId, { eligibleStatuses: [BET_STATUS.active], kind: "ordering-test" })).claimed, true);
    assert.equal(await database.outcomes.submit(activeId, 10, OUTCOME.win), false);
    assert.equal((await database.bets.getById(activeId)).status, BET_STATUS.settling);
  });
});

test("refund persistence claim is written before the mocked transfer and finalizes once", async () => {
  await withDatabase(async (database) => {
    await database.users.upsert(40, "creator");
    await database.users.upsert(41, "opponent");
    await database.users.saveTonAddress(40, "EQcreator-refund-wallet");
    await database.users.saveTonAddress(41, "EQopponent-refund-wallet");
    const betId = await database.bets.create(40, "Refund ordering", 1, Math.floor(Date.now() / 1000) + 3600);
    await database.bets.join(betId, 41);
    await database.deposits.confirmAndMaybeActivate(betId, { role: "creator", participantId: 40 });
    await database.deposits.confirmAndMaybeActivate(betId, { role: "opponent", participantId: 41 });
    let transfers = 0;
    const refunded = await refundBetWithClaim(
      await database.bets.getById(betId),
      [BET_STATUS.active],
      {
        refundBothFn: async () => {
          transfers += 1;
          assert.equal((await database.bets.getById(betId)).status, BET_STATUS.settling);
        },
      },
    );
    assert.equal(transfers, 1);
    assert.equal(refunded.id, betId);
    assert.equal((await database.bets.getById(betId)).status, BET_STATUS.refunded);
  });
});

test("authenticated join endpoint returns one success, one conflict, and one accurate notification", async () => {
  const previousToken = process.env.TELEGRAM_TOKEN;
  process.env.TELEGRAM_TOKEN = "test-token";
  await withDatabase(async (database) => {
    const bot = botSpy();
    const state = createRuntimeState();
    const app = createApp({ bot, config: parseConfig(baseEnv), state });
    const httpServer = await listen(app);
    try {
      const creator = { id: 20, username: "creator" };
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const createResponse = await fetch(`${httpServer.url}/api/bets`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-init-data": telegramInitData(creator) },
        body: JSON.stringify({ description: "Authenticated API bet", amount_ton: 1, deadline }),
      });
      assert.equal(createResponse.status, 200);
      const created = await createResponse.json();
      const join = (user) => fetch(`${httpServer.url}/api/bets/${created.bet.id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-init-data": telegramInitData(user) },
        body: "{}",
      });
      const [first, second] = await Promise.all([join({ id: 21, username: "first" }), join({ id: 22, username: "second" })]);
      assert.deepEqual([first.status, second.status].sort(), [200, 409]);
      const joined = await database.bets.getById(created.bet.id);
      assert.ok([21, 22].includes(Number(joined.opponent_id)));
      const persistedOpponent = await database.users.getByTelegramId(joined.opponent_id);
      assert.equal(bot.messages.length, 1);
      assert.match(bot.messages[0][1], new RegExp(`@${persistedOpponent.username}`));

      await database.deposits.confirmAndMaybeActivate(created.bet.id, { role: "creator", participantId: 20 });
      await database.deposits.confirmAndMaybeActivate(created.bet.id, { role: "opponent", participantId: joined.opponent_id });
      const outcomeResponse = await fetch(`${httpServer.url}/api/bets/${created.bet.id}/outcome`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-init-data": telegramInitData(creator) },
        body: JSON.stringify({ outcome: OUTCOME.win }),
      });
      assert.equal(outcomeResponse.status, 200);
      assert.equal((await outcomeResponse.json()).stage, "waiting");

      await database.bets.refund(created.bet.id);
      const lateDeposit = await fetch(`${httpServer.url}/api/bets/${created.bet.id}/deposit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-init-data": telegramInitData(creator) },
        body: JSON.stringify({ userWalletAddress: "EQlate-wallet-address" }),
      });
      assert.equal(lateDeposit.status, 409);
    } finally {
      await new Promise((resolve) => httpServer.server.close(resolve));
    }
  });
  if (previousToken === undefined) delete process.env.TELEGRAM_TOKEN;
  else process.env.TELEGRAM_TOKEN = previousToken;
});

test("database close is shared and supports clean reinitialization", async () => {
  await closeDatabase();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ton-consensus-close-"));
  const legacyPath = path.join(directory, "consensus.db");
  try {
    const database = await initializeDatabase({ legacyPath });
    let closes = 0;
    const originalClose = database.close;
    database.close = async () => { closes += 1; await originalClose(); };
    await Promise.all([closeDatabase(), closeDatabase(), closeDatabase()]);
    assert.equal(closes, 1);
    const reinitialized = await initializeDatabase({ legacyPath });
    await reinitialized.users.upsert(30, "reinitialized");
    assert.equal((await reinitialized.users.getByTelegramId(30)).username, "reinitialized");
  } finally {
    await closeDatabase();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("oracle retries are cleared during shutdown before they can call the database", async () => {
  await withDatabase(async (database) => {
    const callbacks = [];
    const cleared = new Set();
    let reads = 0;
    const originalGetById = database.bets.getById;
    database.bets.getById = async (...args) => { reads += 1; return originalGetById(...args); };
    configureOracleRetryTimersForTest({
      setIntervalFn: (callback) => { callbacks.push(callback); return { callback }; },
      clearIntervalFn: (timer) => { cleared.add(timer); },
    });
    enableOracleRetryTimers();
    scheduleOracleRetry(999, botSpy());
    assert.equal(getOracleRetryTimerCount(), 1);
    stopOracleRetryTimers();
    assert.equal(getOracleRetryTimerCount(), 0);
    await callbacks[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 0);
    assert.equal(cleared.size, 1);

    const rejectionCallbacks = [];
    let unhandled = null;
    const captureUnhandled = (reason) => { unhandled = reason; };
    database.bets.getById = async () => { throw new Error("timer database failure"); };
    configureOracleRetryTimersForTest({
      setIntervalFn: (callback) => { rejectionCallbacks.push(callback); return { callback }; },
      clearIntervalFn: () => {},
    });
    process.once("unhandledRejection", captureUnhandled);
    try {
      enableOracleRetryTimers();
      scheduleOracleRetry(1000, botSpy());
      rejectionCallbacks[0]();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(unhandled, null);
    } finally {
      process.removeListener("unhandledRejection", captureUnhandled);
      stopOracleRetryTimers();
    }
    configureOracleRetryTimersForTest();
  });
});

test("server uses injected legacy database configuration and readiness tracks initialized state", async () => {
  await closeDatabase();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ton-consensus-server-"));
  const legacyPath = path.join(directory, "injected.db");
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  let runtime;
  try {
    runtime = await startServer({
      env: { NETWORK: "testnet", TELEGRAM_DISABLED: "1", PORT: String(port), DATABASE_BACKEND: "legacy", DATABASE_PATH: legacyPath },
      botInstance: { stop() {} },
      registerProcessHandlers: false,
    });
    assert.equal(runtime.state.isReady(), true);
    assert.equal((await fs.stat(legacyPath)).isFile(), true);
    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(ready.status, 200);
    const readyJson = await ready.json();
    assert.equal(Object.hasOwn(readyJson, "legacyPath"), false);
  } finally {
    await runtime?.shutdown();
    await closeDatabase();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("database initialization failure leaves readiness unavailable", async () => {
  await closeDatabase();
  const state = createRuntimeState();
  state.markHttpStarted();
  const app = createApp({ bot: botSpy(), config: parseConfig(baseEnv), state });
  const httpServer = await listen(app);
  try {
    await assert.rejects(initializeDatabase({ backend: "postgres" }), /Unsupported database backend/);
    const ready = await fetch(`${httpServer.url}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).ready, false);
  } finally {
    await new Promise((resolve) => httpServer.server.close(resolve));
    await closeDatabase();
  }
});
