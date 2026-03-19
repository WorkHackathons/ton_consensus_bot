import { hunt } from "./hunter.js";
import { judge } from "./judge.js";
import { getTonAddress, finalizeBet } from "./db.js";
import { executePayout } from "./ton.js";
import { logger } from "./logger.js";

function escapeMarkdown(text = "") {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export async function runArbiterEngine(bet, bot) {
  if (!process.env.OPENROUTER_API_KEY) {
    return false;
  }

  logger.info(`[ENGINE] Starting for bet #${bet.id}: "${bet.description}"`);

  const hunterResult = await hunt(bet.description);
  if (!hunterResult || !hunterResult.found) {
    logger.warn("[ENGINE] Hunter found nothing. Routing to human oracle.");
    return false;
  }

  const verdict = await judge(bet.description, hunterResult);
  if (!verdict) {
    logger.error("[ENGINE] Judge failed. Routing to human oracle.");
    return false;
  }

  if (
    verdict?.dispute_summary?.status !== "SETTLED"
    || Number(verdict?.dispute_summary?.confidence_score) < 0.92
  ) {
    logger.warn(
      `[ENGINE] Confidence too low: ${verdict?.dispute_summary?.confidence_score}. Routing to human oracle.`,
    );
    return false;
  }

  const winnerId = verdict.dispute_summary.winner_side === "creator" ? bet.creator_id : bet.opponent_id;
  const loserId = winnerId === bet.creator_id ? bet.opponent_id : bet.creator_id;
  const winnerAddress = getTonAddress(winnerId);

  let txHash = "pending";
  if (winnerAddress) {
    try {
      const payoutResult = await executePayout(bet.id, winnerAddress, Number(bet.amount_ton) * 2);
      if (!payoutResult) {
        logger.error(`[ENGINE] Payout failed for bet #${bet.id}`);
        return false;
      }
      txHash = payoutResult.txHash;
    } catch (error) {
      logger.error(`[ENGINE] Payout failed for bet #${bet.id}: ${error.message}`);
      return false;
    }
  }

  finalizeBet(bet.id, winnerId, txHash);

  const tonscan = process.env.NETWORK === "mainnet" ? "https://tonscan.org" : "https://testnet.tonscan.org";
  const logsText = (verdict.execution_log || []).join("\n");
  const payoutAmount = (Number(bet.amount_ton) * 2 * 0.9).toFixed(2);
  const txLine = txHash && txHash !== "pending"
    ? `\n[TX](${tonscan}/tx/${txHash})`
    : "\nPayout pending wallet confirmation.";

  try {
    await bot.telegram.sendMessage(
      winnerId,
      `🤖 *ORACLE VERDICT: SETTLED*\n\n${escapeMarkdown(logsText)}\n\n📋 _${escapeMarkdown(bet.description)}_\n\n${escapeMarkdown(verdict.verdict_statement)}\n\n🎯 Confidence: *${Math.round(Number(verdict.dispute_summary.confidence_score) * 100)}%*\n\n🏆 Payout: *${payoutAmount} TON*${txLine}`,
      { parse_mode: "Markdown" },
    );

    await bot.telegram.sendMessage(
      loserId,
      `🤖 *ORACLE VERDICT: SETTLED*\n\n📋 _${escapeMarkdown(bet.description)}_\n\n${escapeMarkdown(verdict.verdict_statement)}\n\n❌ RESULT: YOU LOST`,
      { parse_mode: "Markdown" },
    );
  } catch (error) {
    logger.error(`[ENGINE] Notification failed: ${error.message}`);
  }

  return true;
}
