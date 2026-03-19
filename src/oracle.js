import { Markup } from "telegraf";
import {
  finalizeBet,
  getBet,
  getRandomArbiters,
  getTonAddress,
  getVotes,
  refundBet,
  startOracle,
  submitVote,
  tallyVotes,
} from "./db.js";
import { analyzeBetDescription } from "./assistant.js";
import { runArbiterEngine } from "./engine.js";
import { payout, refundBoth } from "./ton.js";
import { ARBITER_COUNT } from "./states.js";

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

  if (!winnerAddress) {
    finalizeBet(bet.id, winnerId, "pending_address");
    await safeNotify(
      bot,
      winnerId,
      `You won bet #${bet.id}, but your TON address is missing.\n\nSend /setaddress, then /claim ${bet.id}`,
    );
    await safeNotify(bot, loserId, `Oracle finished bet #${bet.id}. Winner: \`${winnerId}\`.`);
    return;
  }

  const arbiterAddresses = getVotes(bet.id)
    .map((row) => getTonAddress(row.arbiter_id))
    .filter(Boolean);

  const payoutResult = await payout({
    winnerAddress,
    potTon: Number(bet.amount_ton) * 2,
    oracleUsed: true,
    arbiterAddresses,
  });

  finalizeBet(bet.id, winnerId, payoutResult.winnerTxHash);

  await safeNotify(
    bot,
    winnerId,
    `Oracle confirmed your win for bet #${bet.id}.\nTx: \`${payoutResult.winnerTxHash}\``,
  );
  await safeNotify(bot, loserId, `Oracle finished bet #${bet.id}. Winner: \`${winnerId}\`.`);
}

export async function startOracleForBet(bet, bot) {
  const autoResolved = await runArbiterEngine(bet, bot);
  if (autoResolved) return -1;

  startOracle(bet.id);
  const insight = analyzeBetDescription(bet.description);

  const arbiters = getRandomArbiters([bet.creator_id, bet.opponent_id], ARBITER_COUNT);
  if (arbiters.length < 2) {
    await handleOracleRefund(bet, bot, "Not enough arbiters available.");
    return 0;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Vote creator", `vote:${bet.id}:${bet.creator_id}`)],
    [Markup.button.callback("Vote opponent", `vote:${bet.id}:${bet.opponent_id}`)],
  ]);

  for (const arbiter of arbiters) {
    await safeNotify(
      bot,
      arbiter.telegram_id,
      `You were selected as an arbiter for bet #${bet.id}.\n\nDescription: ${escapeMarkdown(bet.description)}\nAmount: ${bet.amount_ton} TON\n${escapeMarkdown(insight.summary)}\nSuggested evidence: ${escapeMarkdown(insight.evidenceNeeded)}`,
    );

    try {
      await bot.telegram.sendMessage(arbiter.telegram_id, "Choose the winner:", keyboard);
    } catch (error) {
      console.error(`Failed to send vote keyboard to ${arbiter.telegram_id}:`, error.message);
    }
  }

  await safeNotify(bot, bet.creator_id, `Oracle started for bet #${bet.id}.`);
  await safeNotify(bot, bet.opponent_id, `Oracle started for bet #${bet.id}.`);

  return arbiters.length;
}

export async function handleArbiterVote(betId, arbiterId, voteFor, bot) {
  submitVote(betId, arbiterId, voteFor);
  const winnerId = tallyVotes(betId);

  if (!winnerId) {
    return { done: false, winnerId: null };
  }

  const bet = getBet(betId);
  if (!bet) {
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
