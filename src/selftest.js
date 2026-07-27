import { getDatabase } from "./db/index.js";
import { runArbiterEngineDryRun } from "./engine.js";
import { getAddressBalance, getWalletAddress } from "./ton.js";
import { logger } from "./logger.js";
import { notifyDevInfo } from "./devNotify.js";
import { BET_STATUS, OUTCOME } from "./states.js";

function fmtStatus(ok) {
  return ok ? "PASS" : "FAIL";
}

function truncate(text, max = 220) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

async function runCheck(name, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    return {
      name,
      ok: true,
      durationMs: Date.now() - startedAt,
      details: result?.details || "ok",
      fix: result?.fix || "",
    };
  } catch (error) {
    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error),
      fix: "",
    };
  }
}

async function cleanupSelfTestRecords({ betIds, userIds }) {
  const database = getDatabase();
  await database.test.removeBets(betIds);
  await database.test.removeUsers(userIds);
}

async function simulateDisputeFlow() {
  const database = getDatabase();
  const stamp = Date.now();
  const userA = 910000001 + (stamp % 1000);
  const userB = 910001001 + (stamp % 1000);
  const arbiter1 = 910002001 + (stamp % 1000);
  const arbiter2 = 910003001 + (stamp % 1000);
  const arbiter3 = 910004001 + (stamp % 1000);
  const userIds = [userA, userB, arbiter1, arbiter2, arbiter3];
  const betIds = [];

  logger.info(`[SELFTEST] Starting synthetic dispute simulation for users ${userA}/${userB}`);

  try {
    const depositWallet = await getWalletAddress();

    for (const id of userIds) {
      await database.users.upsert(id, `selftest_${id}`);
      await database.users.saveTonAddress(id, depositWallet);
    }

    const instantBetId = await database.bets.create(
      userA,
      `[SELFTEST] Instant settle flow ${stamp}`,
      0.1,
      Math.floor(Date.now() / 1000) + 3600,
    );
    betIds.push(instantBetId);
    await database.bets.join(instantBetId, userB);
    await database.deposits.confirm(instantBetId, "creator");
    await database.deposits.confirm(instantBetId, "opponent");
    if (!await database.deposits.areBothConfirmed(instantBetId)) {
      throw new Error("Synthetic instant flow failed: deposits did not lock for both sides");
    }
    await database.bets.activate(instantBetId);
    await database.outcomes.submit(instantBetId, userA, OUTCOME.win);
    await database.outcomes.submit(instantBetId, userB, OUTCOME.lose);
    const instantWinner = await database.outcomes.resolve(instantBetId);
    if (Number(instantWinner) !== Number(userA)) {
      throw new Error(`Synthetic instant flow failed: expected winner ${userA}, got ${instantWinner}`);
    }
    await database.bets.finalize(instantBetId, userA, "selftest_instant");

    const oracleBetId = await database.bets.create(
      userA,
      `[SELFTEST] Oracle dispute flow ${stamp}`,
      0.1,
      Math.floor(Date.now() / 1000) + 3600,
    );
    betIds.push(oracleBetId);
    await database.bets.join(oracleBetId, userB);
    await database.deposits.confirm(oracleBetId, "creator");
    await database.deposits.confirm(oracleBetId, "opponent");
    if (!await database.deposits.areBothConfirmed(oracleBetId)) {
      throw new Error("Synthetic oracle flow failed: deposits did not lock for both sides");
    }
    await database.bets.activate(oracleBetId);
    await database.outcomes.submit(oracleBetId, userA, OUTCOME.win);
    await database.outcomes.submit(oracleBetId, userB, OUTCOME.win);
    const disputeResult = await database.outcomes.resolve(oracleBetId);
    if (disputeResult !== "dispute") {
      throw new Error(`Synthetic oracle flow failed: expected dispute, got ${disputeResult}`);
    }

    await database.bets.startOracle(oracleBetId);
    await database.oracle.assign(oracleBetId, [arbiter1, arbiter2, arbiter3]);
    await database.oracle.submitVote(oracleBetId, arbiter1, userA);
    await database.oracle.submitVote(oracleBetId, arbiter2, userA);
    const votedWinner = await database.oracle.tallyVotes(oracleBetId);
    if (Number(votedWinner) !== Number(userA)) {
      throw new Error(`Synthetic oracle flow failed: expected arbiter winner ${userA}, got ${votedWinner}`);
    }
    await database.bets.finalize(oracleBetId, userA, "selftest_oracle");

    const instantStatus = (await database.bets.getById(instantBetId))?.status;
    const oracleStatus = (await database.bets.getById(oracleBetId))?.status;
    if (instantStatus !== BET_STATUS.done || oracleStatus !== BET_STATUS.done) {
      throw new Error(`Synthetic flow failed: statuses are instant=${instantStatus}, oracle=${oracleStatus}`);
    }

    logger.info(`[SELFTEST] Synthetic dispute simulation completed successfully for bet_ids ${betIds.join(",")}`);
    return {
      details: `instant and oracle dispute simulation passed (bets ${betIds.join(", ")})`,
      fix: "",
    };
  } finally {
    await cleanupSelfTestRecords({ betIds, userIds });
  }
}

async function simulateAiAutoArbiter() {
  const database = getDatabase();
  const stamp = Date.now();
  const creatorId = 920000001 + (stamp % 1000);
  const opponentId = 920001001 + (stamp % 1000);
  const userIds = [creatorId, opponentId];

  logger.info(`[SELFTEST] Starting AI Auto Arbiter dry-run for users ${creatorId}/${opponentId}`);

  try {
    const depositWallet = await getWalletAddress();

    for (const id of userIds) {
      await database.users.upsert(id, `selftest_ai_${id}`);
      await database.users.saveTonAddress(id, depositWallet);
    }

    const cases = [
      {
        id: `selftest_ai_fact_${stamp}`,
        description: "Bitcoin is a cryptocurrency.",
        expectedWinner: "creator",
      },
      {
        id: `selftest_ai_chain_${stamp}`,
        description: "The Open Network is a blockchain.",
        expectedWinner: "creator",
      },
      {
        id: `selftest_ai_price_${stamp}`,
        description: "Will BTC be under 1000000 USD?",
        expectedWinner: "creator",
      },
    ];

    const verdicts = [];

    for (const testCase of cases) {
      const verdict = await runArbiterEngineDryRun({
        id: testCase.id,
        creator_id: creatorId,
        opponent_id: opponentId,
        description: testCase.description,
        amount_ton: 0.1,
        deadline: Math.floor(Date.now() / 1000) - 3600,
      });

      if (!verdict) {
        throw new Error(`AI agent did not return a high-confidence verdict for: ${testCase.description}`);
      }

      if (verdict.winner_side !== testCase.expectedWinner) {
        throw new Error(`AI agent returned unexpected winner_side=${verdict.winner_side} for: ${testCase.description}`);
      }

      if (Number(verdict.confidence) < 0.85) {
        throw new Error(`AI agent confidence too low (${verdict.confidence}) for: ${testCase.description}`);
      }

      verdicts.push(`${testCase.expectedWinner}:${Math.round(Number(verdict.confidence) * 100)}%`);
    }

    return {
      details: `multi-case pass (${verdicts.join(", ")})`,
      fix: "Check OPENAI_API_KEY, TAVILY_API_KEY, outbound internet, and model/tool availability if AI oracle dry-run fails.",
    };
  } finally {
    await cleanupSelfTestRecords({ betIds: [], userIds });
  }
}

function buildReport(results) {
  const failed = results.filter((item) => !item.ok);
  const passed = results.filter((item) => item.ok);
  const lines = [
    `TON Consensus self-test`,
    ``,
    `Passed: ${passed.length}`,
    `Failed: ${failed.length}`,
    ``,
    ...results.map((item) => `${fmtStatus(item.ok)} | ${item.name} | ${truncate(item.details)}`),
  ];

  if (failed.length) {
    lines.push("", "Suggested fixes:");
    for (const item of failed) {
      if (item.fix) {
        lines.push(`- ${item.name}: ${item.fix}`);
      }
    }
  }

  return lines.join("\n");
}

export async function runSelfTest(bot) {
  logger.info("[SELFTEST] Starting self-test suite");

  const checks = [
    runCheck("Telegram API", async () => {
      const me = await bot.telegram.getMe();
      return {
        details: `connected as @${me.username || "unknown"} (${me.id})`,
      };
    }),
    runCheck("SQLite DB", async () => {
      const { users, bets } = await getDatabase().reporting.recordCounts();
      return { details: `users=${users}, bets=${bets}` };
    }),
    runCheck("Deposit wallet derivation", async () => {
      const address = await getWalletAddress();
      return { details: `wallet=${address}` };
    }),
    runCheck("Deposit wallet balance", async () => {
      const address = await getWalletAddress();
      const balance = await getAddressBalance(address);
      if (balance <= 0) {
        throw new Error(`wallet ${address} has 0 TON`);
      }
      return {
        details: `wallet=${address}, balance=${balance.toFixed(3)} TON`,
        fix: "Top up the deposit wallet with testnet TON if balance is too low.",
      };
    }),
    runCheck("AI Oracle config", async () => {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY missing");
      }
      if (!process.env.TAVILY_API_KEY) {
        throw new Error("TAVILY_API_KEY missing");
      }
      return { details: "OPENAI_API_KEY and TAVILY_API_KEY present" };
    }),
    runCheck("AI Auto Arbiter dry run", simulateAiAutoArbiter),
    runCheck("Mini App config", async () => {
      if (!process.env.MINIAPP_URL) {
        throw new Error("MINIAPP_URL missing");
      }
      return { details: process.env.MINIAPP_URL };
    }),
    runCheck("Arbiter readiness", async () => {
      const arbiters = await getDatabase().reporting.arbiterCount();
      const completed = await getDatabase().reporting.completedBetsCount();
      if (arbiters < 1) {
        throw new Error("no active arbiters found");
      }
      return { details: `active_arbiters=${arbiters}, completed_bets=${completed}` };
    }),
    runCheck("Premium arbiters config", async () => {
      const premium = (process.env.PREMIUM_ARBITERS || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (!premium.length) {
        throw new Error("PREMIUM_ARBITERS missing");
      }
      return { details: `premium_arbiters=${premium.length}` };
    }),
    runCheck("Payout prerequisites simulation", async () => {
      const address = await getWalletAddress();
      const balance = await getAddressBalance(address);
      if (balance < 0.06) {
        throw new Error(`wallet ${address} balance too low for payout gas (${balance.toFixed(3)} TON)`);
      }
      return {
        details: `sufficient balance for payout gas (${balance.toFixed(3)} TON)`,
        fix: "Top up the deposit wallet to cover winner payout and gas.",
      };
    }),
    runCheck("Synthetic dispute flow", simulateDisputeFlow),
  ];

  const results = await Promise.all(checks);
  const report = buildReport(results);
  const failedCount = results.filter((item) => !item.ok).length;

  logger.info(`[SELFTEST] Completed with ${failedCount} failures`);

  return {
    ok: failedCount === 0,
    failedCount,
    results,
    report,
  };
}

export async function runAndNotifySelfTest(bot, reason = "scheduled") {
  try {
    const result = await runSelfTest(bot);
    const header = result.ok
      ? `✅ SELF-TEST PASSED (${reason})`
      : `🚨 SELF-TEST FAILED (${reason})`;
    await notifyDevInfo(`${header}\n\n${result.report}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[SELFTEST] Fatal self-test failure: ${message}`);
    await notifyDevInfo(`🚨 SELF-TEST CRASHED (${reason})\n\n${truncate(message, 3000)}`);
    return {
      ok: false,
      failedCount: 1,
      results: [],
      report: message,
    };
  }
}
