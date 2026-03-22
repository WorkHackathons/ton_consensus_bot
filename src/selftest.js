import db, {
  activateBet,
  areBothDeposited,
  assignArbiters,
  confirmDeposit,
  createBet,
  finalizeBet,
  getArbiterCount,
  getCompletedBetsCount,
  joinBet,
  resolveOutcomes,
  saveTonAddress,
  startOracle,
  submitOutcome,
  submitVote,
  tallyVotes,
  upsertUser,
} from "./db.js";
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

function cleanupSelfTestRecords({ betIds, userIds }) {
  for (const betId of betIds) {
    db.prepare("DELETE FROM oracle_votes WHERE bet_id = ?").run(betId);
    db.prepare("DELETE FROM oracle_assignments WHERE bet_id = ?").run(betId);
    db.prepare("DELETE FROM bets WHERE id = ?").run(betId);
  }

  for (const userId of userIds) {
    db.prepare("DELETE FROM users WHERE telegram_id = ?").run(userId);
  }
}

async function simulateDisputeFlow() {
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
      upsertUser(id, `selftest_${id}`);
      saveTonAddress(id, depositWallet);
    }

    const instantBetId = createBet(
      userA,
      `[SELFTEST] Instant settle flow ${stamp}`,
      0.1,
      Math.floor(Date.now() / 1000) + 3600,
    );
    betIds.push(instantBetId);
    joinBet(instantBetId, userB);
    confirmDeposit(instantBetId, "creator");
    confirmDeposit(instantBetId, "opponent");
    if (!areBothDeposited(instantBetId)) {
      throw new Error("Synthetic instant flow failed: deposits did not lock for both sides");
    }
    activateBet(instantBetId);
    submitOutcome(instantBetId, userA, OUTCOME.win);
    submitOutcome(instantBetId, userB, OUTCOME.lose);
    const instantWinner = resolveOutcomes(instantBetId);
    if (Number(instantWinner) !== Number(userA)) {
      throw new Error(`Synthetic instant flow failed: expected winner ${userA}, got ${instantWinner}`);
    }
    finalizeBet(instantBetId, userA, "selftest_instant");

    const oracleBetId = createBet(
      userA,
      `[SELFTEST] Oracle dispute flow ${stamp}`,
      0.1,
      Math.floor(Date.now() / 1000) + 3600,
    );
    betIds.push(oracleBetId);
    joinBet(oracleBetId, userB);
    confirmDeposit(oracleBetId, "creator");
    confirmDeposit(oracleBetId, "opponent");
    if (!areBothDeposited(oracleBetId)) {
      throw new Error("Synthetic oracle flow failed: deposits did not lock for both sides");
    }
    activateBet(oracleBetId);
    submitOutcome(oracleBetId, userA, OUTCOME.win);
    submitOutcome(oracleBetId, userB, OUTCOME.win);
    const disputeResult = resolveOutcomes(oracleBetId);
    if (disputeResult !== "dispute") {
      throw new Error(`Synthetic oracle flow failed: expected dispute, got ${disputeResult}`);
    }

    startOracle(oracleBetId);
    assignArbiters(oracleBetId, [arbiter1, arbiter2, arbiter3]);
    submitVote(oracleBetId, arbiter1, userA);
    submitVote(oracleBetId, arbiter2, userA);
    const votedWinner = tallyVotes(oracleBetId);
    if (Number(votedWinner) !== Number(userA)) {
      throw new Error(`Synthetic oracle flow failed: expected arbiter winner ${userA}, got ${votedWinner}`);
    }
    finalizeBet(oracleBetId, userA, "selftest_oracle");

    const instantStatus = db.prepare("SELECT status FROM bets WHERE id = ?").get(instantBetId)?.status;
    const oracleStatus = db.prepare("SELECT status FROM bets WHERE id = ?").get(oracleBetId)?.status;
    if (instantStatus !== BET_STATUS.done || oracleStatus !== BET_STATUS.done) {
      throw new Error(`Synthetic flow failed: statuses are instant=${instantStatus}, oracle=${oracleStatus}`);
    }

    logger.info(`[SELFTEST] Synthetic dispute simulation completed successfully for bet_ids ${betIds.join(",")}`);
    return {
      details: `instant and oracle dispute simulation passed (bets ${betIds.join(", ")})`,
      fix: "",
    };
  } finally {
    cleanupSelfTestRecords({ betIds, userIds });
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
      const users = Number(db.prepare("SELECT COUNT(*) as count FROM users").get()?.count ?? 0);
      const bets = Number(db.prepare("SELECT COUNT(*) as count FROM bets").get()?.count ?? 0);
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
    runCheck("Mini App config", async () => {
      if (!process.env.MINIAPP_URL) {
        throw new Error("MINIAPP_URL missing");
      }
      return { details: process.env.MINIAPP_URL };
    }),
    runCheck("Arbiter readiness", async () => {
      const arbiters = getArbiterCount();
      const completed = getCompletedBetsCount();
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
