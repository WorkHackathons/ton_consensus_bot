import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import {
  activateBet,
  areBothDeposited,
  confirmDeposit,
  createBet,
  finalizeBet,
  getBet,
  getBetsByUser,
  getTonAddress,
  getVotes,
  joinBet,
  resolveOutcomes,
  saveTonAddress,
  submitOutcome,
  upsertUser,
} from "./db.js";
import db from "./db.js";
import { handleArbiterVote, safeNotify, startOracleForBet } from "./oracle.js";
import { BET_STATUS, OUTCOME } from "./states.js";
import { getAddressBalance, getWalletAddress, payout, verifyDeposit } from "./ton.js";

function parseTelegramInitData(initDataRaw) {
  const params = new URLSearchParams(initDataRaw || "");
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_TOKEN || "")
    .digest();

  const computedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) return null;

  try {
    return JSON.parse(params.get("user") || "null");
  } catch {
    return null;
  }
}

function requireTelegramUser(req, res) {
  const user = parseTelegramInitData(req.get("X-Telegram-Init-Data") || "");
  if (!user?.id) {
    res.status(401).json({ error: "Unauthorized Telegram session" });
    return null;
  }
  return user;
}

const AddressSchema = z.object({
  telegram_id: z.number().int().positive(),
  address: z.string().regex(/^[UEk0]Q[A-Za-z0-9_-]{46,64}$/, "Invalid TON address"),
});

const CreateBetSchema = z.object({
  creator_id: z.number().int().positive(),
  username: z.string().trim().optional(),
  description: z.string().trim().min(6).max(280),
  amount_ton: z.number().positive().max(1000),
  deadline: z.number().int().positive(),
});

const JoinBetSchema = z.object({
  opponent_id: z.number().int().positive(),
  username: z.string().trim().optional(),
});

const DepositSchema = z.object({
  telegram_id: z.number().int().positive(),
  userWalletAddress: z.string().min(10, "Wallet address is required"),
});

const OutcomeSchema = z.object({
  telegram_id: z.number().int().positive(),
  outcome: z.enum([OUTCOME.win, OUTCOME.lose]),
});

async function payoutForBet({ bet, winnerId, bot, tonscanBase }) {
  const winnerAddress = getTonAddress(winnerId);
  const loserId = Number(winnerId) === Number(bet.creator_id) ? bet.opponent_id : bet.creator_id;

  if (!winnerAddress) {
    finalizeBet(bet.id, winnerId, "pending_address");
    await safeNotify(bot, winnerId, `You won bet #${bet.id}, but your TON address is missing in the Mini App.`);
    await safeNotify(bot, loserId, `Bet #${bet.id} finished. Winner payout is waiting for a wallet address.`);
    return { txHash: "pending_address" };
  }

  const payoutResult = await payout({
    betId: bet.id,
    winnerAddress,
    potTon: Number(bet.amount_ton) * 2,
    oracleUsed: false,
    arbiterAddresses: [],
  });

  finalizeBet(bet.id, winnerId, payoutResult.winnerTxHash);

  await safeNotify(
    bot,
    winnerId,
    `Payout for bet #${bet.id} was sent.\n[View on Tonscan](${tonscanBase}/tx/${payoutResult.winnerTxHash})`,
  );
  await safeNotify(bot, loserId, `Bet #${bet.id} finished. The winner received the payout.`);

  return { txHash: payoutResult.winnerTxHash };
}

export default function createApiRouter(bot) {
  const router = express.Router();
  const TONSCAN = process.env.NETWORK === "mainnet" ? "https://tonscan.org" : "https://testnet.tonscan.org";

  router.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    return next();
  });

  router.get("/bets", (req, res) => {
    const status = req.query.status || "pending";
    const bets = db.prepare(
      "SELECT * FROM bets WHERE status = ? ORDER BY created_at DESC LIMIT 20",
    ).all(status);
    res.json(bets);
  });

  router.get("/bets/user/:id", (req, res) => {
    res.json(getBetsByUser(parseInt(req.params.id, 10)));
  });

  router.get("/bet/:id", (req, res) => {
    const bet = getBet(parseInt(req.params.id, 10));
    if (!bet) {
      return res.status(404).json({ error: "Not found" });
    }
    const votes = getVotes(Number(req.params.id));
    return res.json({
      ...bet,
      oracle_votes_count: votes.length,
      oracle_votes_needed: 2,
      oracle_votes: votes,
    });
  });

  router.get("/platform-wallet", async (_req, res) => {
    try {
      const address = await getWalletAddress();
      return res.json({ address });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to load platform wallet" });
    }
  });

  router.get("/wallet-balance", async (req, res) => {
    const address = String(req.query.address || "");
    if (!address) {
      return res.status(400).json({ error: "Wallet address is required" });
    }

    try {
      const balanceTon = await getAddressBalance(address);
      return res.json({ balanceTon });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to load wallet balance" });
    }
  });

  router.post("/bets", express.json(), (req, res) => {
    const telegramUser = requireTelegramUser(req, res);
    if (!telegramUser) {
      return;
    }
    const deadlineTs = parseInt(req.body.deadline, 10);
    const now = Math.floor(Date.now() / 1000);

    if (!Number.isFinite(deadlineTs)) {
      return res.status(400).json({ error: "Deadline is required" });
    }
    if (deadlineTs < now + 600) {
      return res.status(400).json({ error: "Deadline must be at least 10 minutes from now" });
    }
    if (deadlineTs > now + 30 * 24 * 3600) {
      return res.status(400).json({ error: "Deadline cannot be more than 30 days from now" });
    }

    const result = CreateBetSchema.safeParse({
      ...req.body,
      creator_id: Number(telegramUser.id),
      amount_ton: Number(req.body.amount_ton),
      deadline: deadlineTs,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error.errors[0].message });
    }

    upsertUser(result.data.creator_id, result.data.username ?? null);
    const betId = createBet(result.data.creator_id, result.data.description, result.data.amount_ton, deadlineTs);
    const bet = getBet(betId);
    return res.json({ ok: true, bet });
  });

  router.post("/bets/:id/join", express.json(), (req, res) => {
    const telegramUser = requireTelegramUser(req, res);
    if (!telegramUser) {
      return;
    }
    const betId = Number(req.params.id);
    const result = JoinBetSchema.safeParse({
      ...req.body,
      opponent_id: Number(telegramUser.id),
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error.errors[0].message });
    }

    const bet = getBet(betId);
    const now = Math.floor(Date.now() / 1000);
    if (!bet) {
      return res.status(404).json({ error: "Bet not found" });
    }

    if (bet.deadline && Number(bet.deadline) < now) {
      return res.status(400).json({ error: "This bet has expired. Create a new one." });
    }

    if (bet.status !== BET_STATUS.pending || bet.opponent_id) {
      return res.status(400).json({ error: "This bet can no longer be joined" });
    }

    if (Number(bet.creator_id) === Number(result.data.opponent_id)) {
      return res.status(400).json({ error: "You cannot join your own bet" });
    }

    upsertUser(result.data.opponent_id, result.data.username ?? null);
    joinBet(betId, result.data.opponent_id);
    return res.json({ ok: true, bet: getBet(betId) });
  });

  router.post("/bets/:id/deposit", express.json(), async (req, res) => {
    const telegramUser = requireTelegramUser(req, res);
    if (!telegramUser) {
      return;
    }
    const betId = Number(req.params.id);
    const result = DepositSchema.safeParse({
      ...req.body,
      telegram_id: Number(telegramUser.id),
      userWalletAddress: String(req.body.userWalletAddress || ""),
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error.errors[0].message });
    }

    const bet = getBet(betId);
    const now = Math.floor(Date.now() / 1000);
    if (!bet) {
      return res.status(404).json({ error: "Bet not found" });
    }

    if (bet.deadline && Number(bet.deadline) < now) {
      return res.status(400).json({ error: "Bet deadline has passed. Refund will be processed." });
    }

    let role = null;
    if (Number(bet.creator_id) === Number(result.data.telegram_id)) {
      role = "creator";
    } else if (Number(bet.opponent_id) === Number(result.data.telegram_id)) {
      role = "opponent";
    }

    if (!role) {
      return res.status(403).json({ error: "You are not a participant in this bet" });
    }

    const savedAddress = getTonAddress(result.data.telegram_id);
    if (!savedAddress) {
      return res.status(400).json({ error: "Connect wallet first" });
    }

    const verifiedTxHash = await verifyDeposit(
      result.data.userWalletAddress,
      Number(bet.amount_ton),
      Number(bet.created_at),
    );

    if (!verifiedTxHash) {
      return res.status(400).json({
        error: "Transaction not found. Please wait 30-60 seconds after sending and try again.",
      });
    }

    confirmDeposit(betId, role);
    if (areBothDeposited(betId)) {
      activateBet(betId);
    }

    return res.json({ ok: true, role, txHash: verifiedTxHash, bet: getBet(betId) });
  });

  router.post("/bets/:id/outcome", express.json(), async (req, res) => {
    const telegramUser = requireTelegramUser(req, res);
    if (!telegramUser) {
      return;
    }
    const betId = Number(req.params.id);
    const result = OutcomeSchema.safeParse({
      ...req.body,
      telegram_id: Number(telegramUser.id),
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error.errors[0].message });
    }

    const bet = getBet(betId);
    if (!bet) {
      return res.status(404).json({ error: "Bet not found" });
    }

    if (bet.status !== BET_STATUS.active && bet.status !== BET_STATUS.confirming) {
      return res.status(400).json({ error: "This bet can no longer accept outcomes" });
    }

    if (Number(result.data.telegram_id) !== Number(bet.creator_id) && Number(result.data.telegram_id) !== Number(bet.opponent_id)) {
      return res.status(403).json({ error: "You are not a participant in this bet" });
    }

    if (
      (Number(result.data.telegram_id) === Number(bet.creator_id) && bet.creator_outcome) ||
      (Number(result.data.telegram_id) === Number(bet.opponent_id) && bet.opponent_outcome)
    ) {
      return res.status(400).json({ error: "Outcome already submitted" });
    }

    submitOutcome(betId, result.data.telegram_id, result.data.outcome);
    const resolution = resolveOutcomes(betId);
    const updatedBet = getBet(betId);

    if (!resolution || !updatedBet) {
      return res.json({ ok: true, stage: "waiting", bet: updatedBet });
    }

    if (resolution === "dispute") {
      await startOracleForBet(updatedBet, bot);
      return res.json({ ok: true, stage: "oracle", bet: getBet(betId) });
    }

    const payoutResult = await payoutForBet({
      bet: updatedBet,
      winnerId: resolution,
      bot,
      tonscanBase: TONSCAN,
    });

    return res.json({ ok: true, stage: "settled", txHash: payoutResult.txHash, bet: getBet(betId) });
  });

  router.post("/bets/:id/vote", express.json(), async (req, res) => {
    const telegramUser = requireTelegramUser(req, res);
    if (!telegramUser) {
      return;
    }
    const betId = Number(req.params.id);
    const arbiterId = Number(telegramUser.id);
    const voteFor = Number(req.body.vote_for);

    if (!Number.isInteger(arbiterId) || !Number.isInteger(voteFor)) {
      return res.status(400).json({ error: "Invalid vote payload" });
    }

    const result = await handleArbiterVote(betId, arbiterId, voteFor, bot);
    if (result.error) {
      return res.status(403).json({ error: result.error });
    }
    return res.json({ ok: true, ...result, bet: getBet(betId) });
  });

  router.post("/user/address", express.json(), (req, res) => {
    const telegramUser = requireTelegramUser(req, res);
    if (!telegramUser) {
      return;
    }
    const result = AddressSchema.safeParse({
      ...req.body,
      telegram_id: Number(telegramUser.id),
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error.errors[0].message });
    }

    upsertUser(result.data.telegram_id, null);
    saveTonAddress(result.data.telegram_id, result.data.address);
    return res.json({ ok: true });
  });

  return router;
}
