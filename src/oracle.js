import { Markup } from "telegraf";
import { getDatabase } from "./db/index.js";
import { analyzeBetDescription } from "./assistant.js";
import { runArbiterEngine } from "./engine.js";
import { logger } from "./logger.js";
import { payout, refundBoth } from "./ton.js";
import { ARBITER_COUNT, ARBITER_FEE, BET_STATUS } from "./states.js";
import { notifyDev } from "./devNotify.js";

const oracleRetryTimers = new Map();
let oracleRetriesStopped = false;
let retryScheduler = { setInterval, clearInterval };
const DEFAULT_ARBITER_CARD_IMAGE = "https://raw.githubusercontent.com/WorkHackathons/ton_consensus_bot/main/arbiter_verdict.png";

export function enableOracleRetryTimers() {
  oracleRetriesStopped = false;
}

export function stopOracleRetryTimers() {
  oracleRetriesStopped = true;
  for (const timer of oracleRetryTimers.values()) {
    retryScheduler.clearInterval(timer);
  }
  oracleRetryTimers.clear();
}

export function configureOracleRetryTimersForTest({ setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  retryScheduler = { setInterval: setIntervalFn, clearInterval: clearIntervalFn };
}

export function getOracleRetryTimerCount() {
  return oracleRetryTimers.size;
}

function escapeMarkdown(text = "") {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export async function safeNotify(bot, userId, text) {
  if (!userId) {
    return false;
  }

  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: "Markdown" });
    return true;
  } catch (error) {
    console.error(`Notify failed for ${userId}:`, error.message);
    return false;
  }
}

function isDefinitelyPreBroadcast(error) {
  return Boolean(error?.beforeBroadcast || error?.code === "PRE_BROADCAST");
}

async function markSettlementFailure(database, betId, error) {
  const message = error instanceof Error ? error.message : String(error);
  if (isDefinitelyPreBroadcast(error)) {
    await database.bets.markSettlementFailed(betId, message);
    return "failed";
  }
  await database.bets.markSettlementUncertain(betId, message);
  return "uncertain";
}

async function finalizeWithOracle(bet, winnerId, bot, { payoutFn = payout } = {}) {
  logger.info(`Starting finalizeWithOracle for bet_id: ${bet.id}`);
  const database = getDatabase();
  const winnerAddress = await database.users.getTonAddress(winnerId);
  const loserId = Number(winnerId) === Number(bet.creator_id) ? bet.opponent_id : bet.creator_id;
  const winnerLabel = Number(winnerId) === Number(bet.creator_id) ? "Player A" : "Player B";

  if (!winnerAddress) {
    logger.warn(`finalizeWithOracle missing winner address for bet_id: ${bet.id}`);
    const finalization = await database.bets.finalizeClaimedSettlement(bet.id, {
      winnerId,
      txHash: "pending_address",
    });
    if (!finalization.finalized) return { settled: false, error: "Settlement claim was lost." };
    await safeNotify(
      bot,
      winnerId,
      `You won bet #${bet.id}, but your TON address is missing in the Mini App.`,
    );
    await safeNotify(bot, loserId, `2 of 3 arbiters voted for ${winnerLabel}. Payout is waiting for the winner wallet.`);
    logger.info("finalizeWithOracle completed successfully: pending_address");
    return { settled: true };
  }

  const arbiterVotes = await database.oracle.getVotes(bet.id);
  const arbiterAddresses = (await Promise.all(
    arbiterVotes.map((row) => database.users.getTonAddress(row.arbiter_id)),
  )).filter(Boolean);

  let payoutResult;
  try {
    payoutResult = await payoutFn({
      betId: bet.id,
      winnerAddress,
      potTon: Number(bet.amount_ton) * 2,
      oracleUsed: true,
      arbiterAddresses,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureState = await markSettlementFailure(database, bet.id, error);
    logger.error(`finalizeWithOracle failed for bet_id: ${bet.id}, reason: ${message}`);
    await notifyDev(`⚖️ ORACLE PAYOUT FAILED\nBet: ${bet.id}\nWinner: ${winnerAddress}\nAmount: ${Number(bet.amount_ton) * 2}\nError: ${message}`);
    await safeNotify(bot, bet.creator_id, `Bet #${bet.id} was resolved, but payout could not be sent yet.\n${message}`);
    if (bet.opponent_id) {
      await safeNotify(bot, bet.opponent_id, `Bet #${bet.id} was resolved, but payout could not be sent yet.\n${message}`);
    }
    return { settled: false, error: `${failureState}: ${message}` };
  }

  try {
    const finalization = await database.bets.finalizeClaimedSettlement(bet.id, {
      winnerId,
      txHash: payoutResult?.winnerTxHash,
    });
    if (!finalization.finalized) {
      return { settled: false, error: "Settlement finalization was rejected." };
    }
  } catch (error) {
    await markSettlementFailure(database, bet.id, error).catch(() => {});
    throw error;
  }
  if (oracleRetryTimers.has(bet.id)) {
    retryScheduler.clearInterval(oracleRetryTimers.get(bet.id));
    oracleRetryTimers.delete(bet.id);
  }

  await safeNotify(
    bot,
    winnerId,
    `⚖️ 2 of 3 anonymous arbiters voted for ${winnerLabel}.\n\nYou won bet #${bet.id}.\nTx: \`${payoutResult.winnerTxHash}\``, 
  );
  await safeNotify(bot, loserId, `⚖️ 2 of 3 anonymous arbiters voted for ${winnerLabel}.\nPayout has been sent automatically.`);

  const rewardAmount = Number(((Number(bet.amount_ton) * 2 * ARBITER_FEE) / ARBITER_COUNT).toFixed(9));
  for (let index = 0; index < arbiterVotes.length; index += 1) {
    const vote = arbiterVotes[index];
    const txHash = payoutResult.arbiterTxHashes?.[index] || "pending";
    await safeNotify(
      bot,
      vote.arbiter_id,
      `✅ Thank you for arbitrating!\nYour reward: ${rewardAmount} TON has been sent to your wallet.\nTX: \`${txHash}\``, 
    );
  }

  logger.info(`finalizeWithOracle completed successfully: ${payoutResult.winnerTxHash}`);
  return { settled: true };
}

export function scheduleOracleRetry(betId, bot) {
  if (oracleRetriesStopped || oracleRetryTimers.has(betId)) {
    return;
  }

  const timer = retryScheduler.setInterval(() => { (async () => {
    if (oracleRetriesStopped) return;
    const currentBet = await getDatabase().bets.getById(betId);
    if (oracleRetriesStopped) return;
    if (!currentBet || currentBet.status !== "oracle") {
      retryScheduler.clearInterval(timer);
      oracleRetryTimers.delete(betId);
      return;
    }

    const arbiters = await notifyArbitersForBet(currentBet, bot);
    if (arbiters >= 2) {
      retryScheduler.clearInterval(timer);
      oracleRetryTimers.delete(betId);
    }
  })().catch((error) => logger.error(`[ORACLE] retry failed for bet ${betId}: ${error?.name || "Error"}`)); }, 30 * 60 * 1000);

  oracleRetryTimers.set(betId, timer);
}

async function notifyArbitersForBet(bet, bot) {
  const database = getDatabase();
  const insight = analyzeBetDescription(bet.description);
  const rewardAmount = Number(((Number(bet.amount_ton) * 2 * ARBITER_FEE) / ARBITER_COUNT).toFixed(9));
  const arbiterCardImage = process.env.ARBITER_CARD_IMAGE_URL || DEFAULT_ARBITER_CARD_IMAGE;
  const premiumArbiters = await database.users.getPremiumArbiters([bet.creator_id, bet.opponent_id]);
  const needed = Math.max(0, ARBITER_COUNT - premiumArbiters.length);
  const regularArbiters = needed > 0
    ? await database.users.getArbiters(
      [bet.creator_id, bet.opponent_id, ...premiumArbiters.map((arbiter) => arbiter.telegram_id)],
      needed,
    )
    : [];
  const arbiters = [...premiumArbiters, ...regularArbiters];

  if (arbiters.length < 2) {
    const availablePremium = premiumArbiters.length;
    const availableRegular = regularArbiters.length;
    logger.warn(`[ORACLE] Not enough arbiters for bet ${bet.id}. premium=${availablePremium}, regular=${availableRegular}, creator=${bet.creator_id}, opponent=${bet.opponent_id}`);
    await notifyDev(`⚖️ NOT ENOUGH ARBITERS\nBet: ${bet.id}\nPremium available: ${availablePremium}\nRegular available: ${availableRegular}\nCreator: ${bet.creator_id}\nOpponent: ${bet.opponent_id}`);
    await safeNotify(
      bot,
      bet.creator_id,
      "⚖️ Not enough available arbiters could be assigned right now.\nWe'll retry in 30 minutes automatically.",
    );
    await safeNotify(
      bot,
      bet.opponent_id,
      "⚖️ Not enough available arbiters could be assigned right now.\nWe'll retry in 30 minutes automatically.",
    );
    scheduleOracleRetry(bet.id, bot);
    return 0;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("✅ Player A is right", `vote:${bet.id}:${bet.creator_id}`)],
    [Markup.button.callback("✅ Player B is right", `vote:${bet.id}:${bet.opponent_id}`)],
  ]);

  await database.oracle.assign(bet.id, arbiters.map((arbiter) => arbiter.telegram_id));

  for (const arbiter of arbiters) {
    const aiNote = `🤖 *AI Note:* Objective evidence was not strong enough for automatic resolution.\nThis dispute requires human judgment.\n\n`;
    const premiumNote = await database.users.isPremiumArbiter(arbiter.telegram_id)
      ? "⭐️ *Premium Arbiter:* priority access enabled.\n\n"
      : "";
    const body =
      `⚖️ *DISPUTE #${bet.id} - YOUR VOTE IS NEEDED*\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📋 *Claim:* ${escapeMarkdown(bet.description)}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Player A* says: claim is TRUE\n` +
      `👤 *Player B* says: claim is FALSE\n\n` +
      `💰 *Pot:* ${(Number(bet.amount_ton) * 2).toFixed(2)} TON\n` +
      `🎯 *Your reward:* ${rewardAmount.toFixed(3)} TON\n` +
      `⏰ *Vote deadline:* 24 hours\n\n` +
      `${premiumNote}` +
      `${aiNote}` +
      `🔒 Voting is anonymous. Neither player knows who you are.\n\n` +
      `${escapeMarkdown(insight.summary)}`;

    try {
      await bot.telegram.sendPhoto(arbiter.telegram_id, arbiterCardImage, {
        caption: body,
        parse_mode: "Markdown",
      });
    } catch (error) {
      logger.error(`[ORACLE] Could not send arbiter image to ${arbiter.telegram_id}: ${error.message}`);
      await safeNotify(bot, arbiter.telegram_id, body);
    }

    try {
      await bot.telegram.sendMessage(arbiter.telegram_id, "Choose the winner:", keyboard);
    } catch (error) {
      console.error(`Failed to send vote keyboard to ${arbiter.telegram_id}:`, error.message);
    }
  }

  await safeNotify(bot, bet.creator_id, "⚖️ Anonymous arbiters are voting...\nResult will be announced automatically.");
  await safeNotify(bot, bet.opponent_id, "⚖️ Anonymous arbiters are voting...\nResult will be announced automatically.");

  return arbiters.length;
}

export async function startOracleForBet(bet, bot) {
  logger.info(`Starting startOracleForBet for bet_id: ${bet.id}`);
  try {
    const aiResult = await runArbiterEngine(bet, bot);
    if (aiResult?.status === "resolved") {
      logger.info(`startOracleForBet completed successfully: auto_resolved for bet_id ${bet.id}`);
      return -1;
    }
    if (aiResult?.status === "payout_failed") {
      await safeNotify(
        bot,
        bet.creator_id,
        `🤖 AI found the winner for bet #${bet.id}, but payout could not be sent yet.\n${escapeMarkdown(aiResult.error || "Unknown payout error")}`,
      );
      if (bet.opponent_id) {
        await safeNotify(
          bot,
          bet.opponent_id,
          `🤖 AI found the winner for bet #${bet.id}, but payout could not be sent yet.\n${escapeMarkdown(aiResult.error || "Unknown payout error")}`,
        );
      }
      logger.warn(`startOracleForBet stopped before arbiter fallback due to payout failure for bet_id ${bet.id}`);
      return -2;
    }

    if (aiResult?.status === "settlement_in_progress") {
      logger.warn(`startOracleForBet stopped because settlement is already claimed for bet_id ${bet.id}`);
      return -3;
    }

    const started = await getDatabase().bets.startOracle(bet.id);
    if (!started) return -3;
    const currentBet = await getDatabase().bets.getById(bet.id);
    const result = await notifyArbitersForBet(currentBet, bot);
    logger.info(`startOracleForBet completed successfully: ${result}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`startOracleForBet failed for bet_id: ${bet.id}, reason: ${message}`);
    await notifyDev(`⚠️ ORACLE START FAILED\nBet: ${bet.id}\nError: ${message}`);
    await safeNotify(bot, bet.creator_id, "⚖️ Oracle could not start yet. We will retry automatically.");
    if (bet.opponent_id) {
      await safeNotify(bot, bet.opponent_id, "⚖️ Oracle could not start yet. We will retry automatically.");
    }
    return 0;
  }
}

export async function handleArbiterVote(betId, arbiterId, voteFor, bot, { payoutFn = payout } = {}) {
  const database = getDatabase();
  const bet = await database.bets.getById(betId);
  if (!bet || bet.status !== "oracle") {
    return { done: false, winnerId: null, error: "Oracle voting is not available for this bet." };
  }

  if (!await database.oracle.isAssigned(betId, arbiterId)) {
    return { done: false, winnerId: null, error: "You are not assigned to this dispute." };
  }

  if (Number(voteFor) !== Number(bet.creator_id) && Number(voteFor) !== Number(bet.opponent_id)) {
    return { done: false, winnerId: null, error: "Invalid winner target." };
  }

  const accepted = await database.oracle.submitVote(betId, arbiterId, voteFor);
  if (!accepted) {
    return { done: false, winnerId: null, error: "You have already voted on this dispute." };
  }
  const winnerId = await database.oracle.tallyVotes(betId);

  if (!winnerId) {
    return { done: false, winnerId: null };
  }

  const claim = await database.bets.claimSettlement(betId, {
    eligibleStatuses: [BET_STATUS.oracle],
    kind: "oracle_payout",
    winnerId,
  });
  if (!claim.claimed) {
    return { done: false, winnerId: null, error: "Settlement is already being processed." };
  }

  const result = await finalizeWithOracle(claim.bet, winnerId, bot, { payoutFn });
  return result.settled
    ? { done: true, winnerId }
    : { done: false, winnerId: null, error: result.error || "Settlement requires review." };
}

export async function handleOracleRefund(bet, bot, reason) {
  logger.info(`Starting handleOracleRefund for bet_id: ${bet.id}`);
  const database = getDatabase();
  const claim = await database.bets.claimSettlement(bet.id, {
    eligibleStatuses: [BET_STATUS.oracle],
    kind: "oracle_refund",
  });
  if (!claim.claimed) return false;

  const claimedBet = claim.bet;
  const address1 = await database.users.getTonAddress(claimedBet.creator_id);
  const address2 = await database.users.getTonAddress(claimedBet.opponent_id);

  if (address1 && address2 && claimedBet.creator_deposit && claimedBet.opponent_deposit) {
    try {
      await refundBoth(address1, address2, claimedBet.amount_ton);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markSettlementFailure(database, claimedBet.id, error);
      logger.error(`handleOracleRefund failed for bet_id: ${bet.id}, reason: ${message}`);
      await notifyDev(`↩️ ORACLE REFUND FAILED\nBet: ${bet.id}\nReason: ${reason}\nError: ${message}`);
      return false;
    }
  }

  try {
    const finalization = await database.bets.finalizeClaimedSettlement(claimedBet.id, {
      terminalStatus: BET_STATUS.refunded,
    });
    if (!finalization.finalized) {
      await database.bets.markSettlementUncertain(claimedBet.id, "Refund succeeded but finalization was rejected");
      return false;
    }
  } catch (error) {
    await markSettlementFailure(database, claimedBet.id, error).catch(() => {});
    return false;
  }

  await safeNotify(bot, bet.creator_id, `Bet #${bet.id} was refunded.\nReason: ${escapeMarkdown(reason)}`);
  await safeNotify(bot, bet.opponent_id, `Bet #${bet.id} was refunded.\nReason: ${escapeMarkdown(reason)}`);
  logger.info(`handleOracleRefund completed successfully: refunded bet_id ${bet.id}`);
  return true;
}
