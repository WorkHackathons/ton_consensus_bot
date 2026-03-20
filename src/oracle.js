import { Markup } from "telegraf";
import {
  assignArbiters,
  finalizeBet,
  getBet,
  getArbiters,
  getAssignedArbiters,
  getTonAddress,
  getVotes,
  isAssignedArbiter,
  refundBet,
  startOracle,
  submitVote,
  tallyVotes,
} from "./db.js";
import { analyzeBetDescription } from "./assistant.js";
import { runArbiterEngine } from "./engine.js";
import { payout, refundBoth } from "./ton.js";
import { ARBITER_COUNT, ARBITER_FEE } from "./states.js";

const oracleRetryTimers = new Map();

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

async function finalizeWithOracle(bet, winnerId, bot) {
  const winnerAddress = getTonAddress(winnerId);
  const loserId = Number(winnerId) === Number(bet.creator_id) ? bet.opponent_id : bet.creator_id;
  const winnerLabel = Number(winnerId) === Number(bet.creator_id) ? "Player A" : "Player B";

  if (!winnerAddress) {
    finalizeBet(bet.id, winnerId, "pending_address");
    await safeNotify(
      bot,
      winnerId,
      `You won bet #${bet.id}, but your TON address is missing in the Mini App.`,
    );
    await safeNotify(bot, loserId, `2 of 3 arbiters voted for ${winnerLabel}. Payout is waiting for the winner wallet.`);
    return;
  }

  const arbiterVotes = getVotes(bet.id);
  const arbiterAddresses = arbiterVotes.map((row) => getTonAddress(row.arbiter_id)).filter(Boolean);

  const payoutResult = await payout({
    betId: bet.id,
    winnerAddress,
    potTon: Number(bet.amount_ton) * 2,
    oracleUsed: true,
    arbiterAddresses,
  });

  finalizeBet(bet.id, winnerId, payoutResult.winnerTxHash);
  if (oracleRetryTimers.has(bet.id)) {
    clearInterval(oracleRetryTimers.get(bet.id));
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
}

function scheduleOracleRetry(betId, bot) {
  if (oracleRetryTimers.has(betId)) {
    return;
  }

  const timer = setInterval(async () => {
    const currentBet = getBet(betId);
    if (!currentBet || currentBet.status !== "oracle") {
      clearInterval(timer);
      oracleRetryTimers.delete(betId);
      return;
    }

    const arbiters = await notifyArbitersForBet(currentBet, bot);
    if (arbiters >= 2) {
      clearInterval(timer);
      oracleRetryTimers.delete(betId);
    }
  }, 30 * 60 * 1000);

  oracleRetryTimers.set(betId, timer);
}

async function notifyArbitersForBet(bet, bot) {
  const insight = analyzeBetDescription(bet.description);
  const arbiters = getArbiters([bet.creator_id, bet.opponent_id], ARBITER_COUNT);
  const rewardAmount = Number(((Number(bet.amount_ton) * 2 * ARBITER_FEE) / ARBITER_COUNT).toFixed(9));

  if (arbiters.length < 2) {
    await safeNotify(
      bot,
      bet.creator_id,
      "⚖️ Waiting for arbiters to join the platform.\nWe'll retry in 30 minutes automatically.",
    );
    await safeNotify(
      bot,
      bet.opponent_id,
      "⚖️ Waiting for arbiters to join the platform.\nWe'll retry in 30 minutes automatically.",
    );
    scheduleOracleRetry(bet.id, bot);
    return 0;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Player A won", `vote:${bet.id}:${bet.creator_id}`)],
    [Markup.button.callback("Player B won", `vote:${bet.id}:${bet.opponent_id}`)],
  ]);

  assignArbiters(bet.id, arbiters.map((arbiter) => arbiter.telegram_id));

  for (const arbiter of arbiters) {
    await safeNotify(
      bot,
      arbiter.telegram_id,
      `⚖️ Your vote is needed!\n\nBet: ${escapeMarkdown(bet.description)}\nPot: ${bet.amount_ton * 2} TON\n\nPlayer A claims they won.\nPlayer B claims they won.\n\n⭐️ You are one of the first arbiters of TON Consensus!\nVote honestly and earn your share of the commission.\n\nYour reward for voting: ${rewardAmount} TON (paid automatically)\n\n${escapeMarkdown(insight.summary)}`,
    );

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
  const autoResolved = await runArbiterEngine(bet, bot);
  if (autoResolved) return -1;

  startOracle(bet.id);
  return notifyArbitersForBet(bet, bot);
}

export async function handleArbiterVote(betId, arbiterId, voteFor, bot) {
  const bet = getBet(betId);
  if (!bet || bet.status !== "oracle") {
    return { done: false, winnerId: null, error: "Oracle voting is not available for this bet." };
  }

  if (!isAssignedArbiter(betId, arbiterId)) {
    return { done: false, winnerId: null, error: "You are not assigned to this dispute." };
  }

  if (Number(voteFor) !== Number(bet.creator_id) && Number(voteFor) !== Number(bet.opponent_id)) {
    return { done: false, winnerId: null, error: "Invalid winner target." };
  }

  submitVote(betId, arbiterId, voteFor);
  const winnerId = tallyVotes(betId);

  if (!winnerId) {
    return { done: false, winnerId: null };
  }

  await finalizeWithOracle(bet, winnerId, bot);
  return { done: true, winnerId };
}

export async function handleOracleRefund(bet, bot, reason) {
  const address1 = getTonAddress(bet.creator_id);
  const address2 = getTonAddress(bet.opponent_id);

  if (address1 && address2 && bet.creator_deposit && bet.opponent_deposit) {
    try {
      await refundBoth(address1, address2, bet.amount_ton);
    } catch (error) {
      console.error(`Refund failed for bet ${bet.id}:`, error.message);
    }
  }

  refundBet(bet.id);

  await safeNotify(bot, bet.creator_id, `Bet #${bet.id} was refunded.\nReason: ${escapeMarkdown(reason)}`);
  await safeNotify(bot, bet.opponent_id, `Bet #${bet.id} was refunded.\nReason: ${escapeMarkdown(reason)}`);
}
