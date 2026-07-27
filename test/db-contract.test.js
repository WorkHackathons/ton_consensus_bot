import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { closeDatabase, getDatabase, initializeDatabase } from "../src/db/index.js";
import { BET_STATUS, OUTCOME } from "../src/states.js";
import { parseConfig } from "../src/runtime/config.js";
import { createRuntimeState } from "../src/runtime/state.js";

const baseEnv = {
  NETWORK: "testnet",
  TELEGRAM_TOKEN: "test-token",
  MINIAPP_URL: "https://example.test/miniapp",
};

async function listen(app) {
  const server = await new Promise((resolve) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function listenTelegramMock(messages) {
  const server = http.createServer((request, response) => {
    messages.push(request.url || "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, result: {} }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

test("async legacy database contract covers lifecycle, repositories, and failure handling", async () => {
  await closeDatabase();
  assert.throws(() => getDatabase(), /not been initialized/);
  await assert.rejects(initializeDatabase({ backend: "postgres" }), /Unsupported database backend/);

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "ton-consensus-db-"));
  const databasePath = path.join(temporaryDirectory, "consensus.db");
  try {
    const database = await initializeDatabase({ databasePath });
    assert.equal(database, getDatabase());

    await database.users.upsert(101, "creator");
    const createdAt = (await database.users.getByTelegramId(101)).created_at;
    await database.users.upsert(101, "creator-renamed");
    const creator = await database.users.getByTelegramId(101);
    assert.equal(creator.username, "creator-renamed");
    assert.equal(creator.created_at, createdAt);
    await database.users.saveTonAddress(101, "EQcreator-wallet");
    assert.equal(await database.users.getTonAddress(101), "EQcreator-wallet");

    await database.users.upsert(102, "opponent");
    await database.users.upsert(103, "arbiter-one");
    await database.users.upsert(104, "arbiter-two");
    await database.users.upsert(105, "arbiter-three");
    assert.equal(await database.referrals.set(102, 101), true);
    assert.equal(await database.referrals.set(102, 101), false);
    assert.equal(await database.referrals.get(102), 101);
    assert.equal(await database.referrals.count(101), 1);
    await database.referrals.incrementEarnings(101, 0.2);
    assert.equal(Number((await database.users.getByTelegramId(101)).referral_earnings), 0.2);

    const settledBetId = await database.bets.create(101, "The creator wins the match", 1, Math.floor(Date.now() / 1000) + 3600);
    await database.bets.join(settledBetId, 102);
    assert.equal((await database.bets.getById(settledBetId)).opponent_id, 102);
    await database.deposits.confirm(settledBetId, "creator");
    await database.deposits.confirm(settledBetId, "opponent");
    assert.equal(await database.deposits.areBothConfirmed(settledBetId), true);
    await database.bets.activate(settledBetId);
    await database.outcomes.submit(settledBetId, 101, OUTCOME.win);
    await database.outcomes.submit(settledBetId, 102, OUTCOME.lose);
    assert.equal(await database.outcomes.resolve(settledBetId), 101);
    await database.bets.finalize(settledBetId, 101, "test-settlement");
    assert.equal((await database.bets.getById(settledBetId)).status, BET_STATUS.done);

    const disputeBetId = await database.bets.create(101, "The result is disputed", 1, Math.floor(Date.now() / 1000) + 3600);
    await database.bets.join(disputeBetId, 102);
    await database.bets.startOracle(disputeBetId);
    await database.oracle.assign(disputeBetId, [103, 104, 105]);
    assert.deepEqual(await database.oracle.getAssignments(disputeBetId), [103, 104, 105]);
    assert.equal(await database.oracle.isAssigned(disputeBetId, 103), true);
    assert.equal(await database.oracle.submitVote(disputeBetId, 103, 101), true);
    assert.equal(await database.oracle.submitVote(disputeBetId, 103, 102), false);
    assert.equal(await database.oracle.submitVote(disputeBetId, 104, 101), true);
    assert.equal(await database.oracle.tallyVotes(disputeBetId), 101);
    await database.bets.refund(disputeBetId);
    assert.equal((await database.bets.getById(disputeBetId)).status, BET_STATUS.refunded);

    const app = createApp({ bot: { telegram: {} }, config: parseConfig(baseEnv), state: createRuntimeState() });
    const http = await listen(app);
    try {
      const response = await fetch(`${http.url}/api/bets`);
      assert.equal(response.status, 200);
      assert.equal(Array.isArray(await response.json()), true);
    } finally {
      await new Promise((resolve) => http.server.close(resolve));
    }

    await database.users.becomeArbiter(101);
    process.env.MINIAPP_URL = baseEnv.MINIAPP_URL;
    const { default: bot } = await import("../src/bot.js");
    const messages = [];
    const telegramMock = await listenTelegramMock(messages);
    try {
      bot.botInfo = { id: 999999, is_bot: true, first_name: "Consensus", username: "ton_consensus_bot" };
      bot.telegram.options.apiRoot = telegramMock.url;
      await bot.handleUpdate({
        update_id: 10001,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 101, type: "private" },
          from: { id: 101, is_bot: false, first_name: "Creator", username: "creator-renamed" },
          text: "/start",
          entities: [{ offset: 0, length: 6, type: "bot_command" }],
        },
      });
      assert.ok(messages.some((requestUrl) => requestUrl.endsWith("/sendMessage")), "mocked /start should reply through the Telegram mock");
    } finally {
      await new Promise((resolve) => telegramMock.server.close(resolve));
    }

    const failureApp = createApp({ bot: { telegram: {} }, config: parseConfig(baseEnv), state: createRuntimeState() });
    const failureHttp = await listen(failureApp);
    let unhandled = null;
    const captureUnhandled = (reason) => { unhandled = reason; };
    process.once("unhandledRejection", captureUnhandled);
    try {
      await closeDatabase();
      const failureResponse = await fetch(`${failureHttp.url}/api/bets`);
      assert.equal(failureResponse.status, 500);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(unhandled, null, "database failures should be handled by the API route");
    } finally {
      process.removeListener("unhandledRejection", captureUnhandled);
      await new Promise((resolve) => failureHttp.server.close(resolve));
    }
  } finally {
    await closeDatabase();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }

  assert.throws(() => getDatabase(), /not been initialized/);
});

test("production modules have no raw database imports or sql.js calls", async () => {
  const productionFiles = ["api.js", "bot.js", "oracle.js", "engine.js", "ton.js", "selftest.js", "server.js"];
  for (const file of productionFiles) {
    const source = await fs.readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["']\.\/db\.js["']/);
    assert.doesNotMatch(source, /\bdb\.(prepare|run|exec)\b/);
  }
});
