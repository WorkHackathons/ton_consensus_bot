import "dotenv/config";
import express from "express";
import { Markup, Telegraf } from "telegraf";
import {
  activateBet,
  areBothDeposited,
  confirmDeposit,
  createBet,
  finalizeBet,
  getBet,
  getBetsByUser,
  getExpiredBets,
  getPendingBets,
  getTonAddress,
  getVotes,
  initDB,
  joinBet,
  refundBet,
  resolveOutcomes,
  saveTonAddress,
  submitOutcome,
  upsertUser,
} from "./db.js";
import { analyzeBetDescription } from "./assistant.js";
import apiRouter from "./api.js";
import { handleArbiterVote, handleOracleRefund, safeNotify, startOracleForBet } from "./oracle.js";
import { BET_STATUS, OUTCOME } from "./states.js";
import { checkMcpHealth, getWalletAddress, payout, refundBoth, verifyDeposit } from "./ton.js";

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error("TELEGRAM_TOKEN is required");
  process.exit(1);
}

initDB();
if (process.env.DISABLE_BOT_LAUNCH !== "1") {
  const app = express();
  app.get("/tonconnect-manifest.json", (req, res) => {
    const baseUrl = process.env.MINIAPP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.API_PORT || 3001}/miniapp`;
    const origin = (() => {
      try {
        return new URL(baseUrl).origin;
      } catch {
        return `http://localhost:${process.env.API_PORT || 3001}`;
      }
    })();

    res.json({
      url: baseUrl,
      name: "TON Consensus",
      iconUrl: `${origin}/miniapp/icon.svg`,
      termsOfUseUrl: baseUrl,
      privacyPolicyUrl: baseUrl,
    });
  });
  app.use("/api", apiRouter);
  app.use("/miniapp", express.static("miniapp-react/dist"));
  app.listen(process.env.API_PORT || 3001, () => console.log(`API on ${process.env.API_PORT || 3001}`));
}
checkMcpHealth().catch(() => console.warn("MCP unavailable, continuing..."));

const bot = new Telegraf(token);
const TONSCAN = process.env.NETWORK === "mainnet" ? "https://tonscan.org" : "https://testnet.tonscan.org";

const awaitingAddress = new Set();
const awaitingBet = new Map();

const mainKeyboard = Markup.keyboard([
  ["Create Bet", "My Bets"],
  ["Platform Wallet", "My Wallet"],
]).resize();

function escapeMarkdown(text = "") {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function statusEmoji(status) {
  return {
    [BET_STATUS.pending]: "[PENDING]",
    [BET_STATUS.active]: "[ACTIVE]",
    [BET_STATUS.confirming]: "[CONFIRM]",
    [BET_STATUS.oracle]: "[ORACLE]",
    [BET_STATUS.done]: "[DONE]",
    [BET_STATUS.refunded]: "[REFUND]",
  }[status] || "[UNKNOWN]";
}

function statusLabel(status) {
  return {
    [BET_STATUS.pending]: "Waiting for opponent",
    [BET_STATUS.active]: "Active",
    [BET_STATUS.confirming]: "Awaiting result confirmation",
    [BET_STATUS.oracle]: "Oracle dispute",
    [BET_STATUS.done]: "Completed",
    [BET_STATUS.refunded]: "Refunded",
  }[status] || "Unknown";
}

function buildBetCard(bet, viewerId) {
  const insight = analyzeBetDescription(bet.description);
  const lines = [
    `${statusEmoji(bet.status)} *Bet #${bet.id}*`,
    `Status: *${escapeMarkdown(statusLabel(bet.status))}*`,
    `Description: ${escapeMarkdown(bet.description)}`,
    `Stake: *${bet.amount_ton} TON* each`,
    `Creator: \`${bet.creator_id}\``,
    `Opponent: ${bet.opponent_id ? `\`${bet.opponent_id}\`` : "_not joined yet_"}`,
    `${escapeMarkdown(insight.summary)}`,
    `Evidence to prepare: *${escapeMarkdown(insight.evidenceNeeded)}*`,
  ];

  if (bet.creator_outcome) {
    lines.push(`Creator outcome: *${bet.creator_outcome}*`);
  }

  if (bet.opponent_outcome) {
    lines.push(`Opponent outcome: *${bet.opponent_outcome}*`);
  }

  if (bet.winner_id) {
    lines.push(`Winner: \`${bet.winner_id}\``);
  }

  if (bet.status === BET_STATUS.done && bet.payout_txhash && bet.payout_txhash !== "pending_address") {
    lines.push(`[Open transaction](${TONSCAN}/tx/${bet.payout_txhash})`);
  }

  if (Number(viewerId) === Number(bet.creator_id)) {
    lines.push("_You created this bet_");
  } else if (Number(viewerId) === Number(bet.opponent_id)) {
    lines.push("_You joined this bet_");
  }

  return lines.join("\n");
}

function buildBetButtons(bet, userId) {
  const rows = [];

  if (bet.status === BET_STATUS.pending && !bet.opponent_id && Number(userId) !== Number(bet.creator_id)) {
    rows.push([Markup.button.callback("Join bet", `joincb:${bet.id}`)]);
  }

  if (
    (bet.status === BET_STATUS.active || bet.status === BET_STATUS.confirming) &&
    (Number(userId) === Number(bet.creator_id) || Number(userId) === Number(bet.opponent_id))
  ) {
    rows.push([
      Markup.button.callback("I won", `outcome:${bet.id}:${OUTCOME.win}`),
      Markup.button.callback("I lost", `outcome:${bet.id}:${OUTCOME.lose}`),
    ]);
  }

  return rows.length ? Markup.inlineKeyboard(rows) : null;
}

function buildHelpText() {
  return [
    "*TON Consensus*",
    "TON-native trust layer for peer-to-peer bets and disputes inside Telegram.",
    "",
    "*Fast flow*",
    "1. `/setaddress`",
    "2. `/newbet`",
    "3. Share `/join <id>`",
    "4. Both users verify deposits",
    "5. Submit outcomes",
    "6. Oracle resolves conflicts if needed",
    "",
    "*Commands*",
    "`/wallet` `/mybets` `/openbets` `/bet <id>` `/join <id>` `/claim <id>` `/testpayout`",
  ].join("\n");
}

function buildDemoText() {
  return [
    "*Demo script in 60-90 seconds*",
    "1. Show `/start` and the platform wallet.",
    "2. Create a bet with a clear measurable outcome.",
    "3. Show the shareable `/join <id>` instruction.",
    "4. Verify both deposits on-chain.",
    "5. Submit matching outcomes for clean payout or conflicting outcomes for oracle mode.",
    "6. Show the payout tx or oracle resolution message.",
  ].join("\n");
}

function isValidTonAddress(value) {
  return /^(EQ|UQ)[A-Za-z0-9_-]{46,64}$/.test(value.trim());
}

function parseAmount(value) {
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Number(parsed.toFixed(6));
}

async function replyBet(ctx, bet) {
  const buttons = buildBetButtons(bet, ctx.from?.id);
  await ctx.reply(buildBetCard(bet, ctx.from?.id), {
    parse_mode: "Markdown",
    ...(buttons || {}),
  });
}

async function activateBetFlow(betId) {
  activateBet(betId);
  const bet = getBet(betId);
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("I won", `outcome:${betId}:${OUTCOME.win}`),
      Markup.button.callback("I lost", `outcome:${betId}:${OUTCOME.lose}`),
    ],
  ]);

  await safeNotify(bot, bet.creator_id, `Both deposits were verified for bet #${betId}. The bet is now live for 48 hours.`);
  await safeNotify(bot, bet.opponent_id, `Both deposits were verified for bet #${betId}. The bet is now live for 48 hours.`);

  try {
    await bot.telegram.sendMessage(bet.creator_id, "When the bet is over, choose your outcome:", keyboard);
    await bot.telegram.sendMessage(bet.opponent_id, "When the bet is over, choose your outcome:", keyboard);
  } catch (error) {
    console.error(`Failed to send outcome buttons for bet ${betId}:`, error.message);
  }
}

async function handlePayoutForBet(bet, winnerId) {
  const freshBet = getBet(bet.id);
  if (!freshBet || freshBet.status === BET_STATUS.done) {
    return;
  }

  const winnerAddress = getTonAddress(winnerId);
  const loserId = Number(winnerId) === Number(freshBet.creator_id) ? freshBet.opponent_id : freshBet.creator_id;

  if (!winnerAddress) {
    finalizeBet(freshBet.id, winnerId, "pending_address");
    await safeNotify(
      bot,
      winnerId,
      `You won bet #${freshBet.id}, but your TON address is missing.\n\nSend /setaddress, then /claim ${freshBet.id}`,
    );
    await safeNotify(bot, loserId, `Bet #${freshBet.id} finished. Winner payout is waiting for a wallet address.`);
    return;
  }

  const payoutResult = await payout({
    winnerAddress,
    potTon: Number(freshBet.amount_ton) * 2,
    oracleUsed: false,
    arbiterAddresses: [],
  });

  finalizeBet(freshBet.id, winnerId, payoutResult.winnerTxHash);

  await safeNotify(
    bot,
    winnerId,
    `Payout for bet #${freshBet.id} was sent.\n[View on Tonscan](${TONSCAN}/tx/${payoutResult.winnerTxHash})`,
  );
  await safeNotify(bot, loserId, `Bet #${freshBet.id} finished. The winner received the payout.`);
}

async function showDepositPrompt(ctx, betId, role) {
  const bet = getBet(betId);
  if (!bet) {
    await ctx.reply("Bet not found.");
    return;
  }

  const walletAddress = await getWalletAddress();
  await ctx.reply(
    `Send ${bet.amount_ton} TON to this platform wallet:\n\`${walletAddress}\`\n\nAfter you send it, tap the button below. The bot will try to verify the deposit on-chain.`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Verify deposit", `deposit:${betId}:${role}`)],
      ]),
    },
  );
}

async function handleJoin(ctx, betId) {
  const bet = getBet(betId);
  if (!bet) {
    await ctx.reply("Bet not found.");
    return;
  }

  if (bet.status !== BET_STATUS.pending) {
    await ctx.reply("This bet can no longer be joined.");
    return;
  }

  if (Number(bet.creator_id) === Number(ctx.from.id)) {
    await ctx.reply("You cannot join your own bet.");
    return;
  }

  if (bet.opponent_id) {
    await ctx.reply("This bet already has an opponent.");
    return;
  }

  if (!getTonAddress(ctx.from.id)) {
    await ctx.reply("Set your TON address first with /setaddress");
    return;
  }

  joinBet(betId, ctx.from.id);
  await ctx.reply(`You joined bet #${betId}.`);
  await showDepositPrompt(ctx, betId, "opponent");
  await safeNotify(
    bot,
    bet.creator_id,
    `An opponent joined bet #${betId}.\nBoth players must now deposit ${bet.amount_ton} TON.`,
  );
}

bot.use(async (ctx, next) => {
  if (ctx.from) {
    upsertUser(ctx.from.id, ctx.from.username || ctx.from.first_name || null);
  }
  await next();
});

bot.start(async (ctx) => {
  await ctx.reply(
    "TON Consensus\n\nA P2P dispute and betting bot on TON.\n1. Create a bet\n2. Both sides deposit\n3. Submit outcomes\n4. Oracle resolves disputes\n\nUse /help for the shortest path.",
    mainKeyboard,
  );
});

bot.command("help", async (ctx) => {
  await ctx.reply(buildHelpText(), { parse_mode: "Markdown" });
});

bot.command("demo", async (ctx) => {
  await ctx.reply(buildDemoText(), { parse_mode: "Markdown" });
});

bot.command("app", async (ctx) => {
  const url = process.env.MINIAPP_URL;
  if (!url) return ctx.reply("Mini App not configured yet");
  await ctx.reply("🚀 TON Consensus", {
    reply_markup: {
      inline_keyboard: [[{ text: "📱 Open App", web_app: { url } }]]
    }
  });
});

bot.on("message", async (ctx, next) => {
  if (!ctx.message?.web_app_data) return next();
  try {
    const data = JSON.parse(ctx.message.web_app_data.data);
    if (data.type === "saveAddress" && data.address) {
      saveTonAddress(ctx.from.id, data.address);
      await ctx.reply("✅ Wallet connected!");
    }
  } catch {}
  return next();
});

async function promptAddress(ctx) {
  awaitingAddress.add(ctx.from.id);
  await ctx.reply("Send your TON wallet address in EQ... or UQ... format.");
}

bot.command("setaddress", promptAddress);
bot.hears("My Wallet", promptAddress);

async function showWallet(ctx) {
  try {
    const address = await getWalletAddress();
    await ctx.reply(`Platform wallet:\n\`${address}\``, { parse_mode: "Markdown" });
  } catch (error) {
    await ctx.reply(`Failed to get platform wallet: ${error.message}`);
  }
}

bot.command("wallet", showWallet);
bot.hears("Platform Wallet", showWallet);

async function startNewBet(ctx) {
  if (!getTonAddress(ctx.from.id)) {
    await ctx.reply("Set your TON address first with /setaddress");
    return;
  }

  awaitingBet.set(ctx.from.id, { step: "description" });
  await ctx.reply("Send one message describing the bet.");
}

bot.command("newbet", startNewBet);
bot.hears("Create Bet", startNewBet);

async function showMyBets(ctx) {
  const bets = getBetsByUser(ctx.from.id);
  if (bets.length === 0) {
    await ctx.reply("You do not have any bets yet.");
    return;
  }

  const text = bets
    .map((bet) => `#${bet.id} ${statusEmoji(bet.status)} ${statusLabel(bet.status)} - ${bet.amount_ton} TON`)
    .join("\n");

  await ctx.reply(`Your latest bets:\n\n${text}`);
}

bot.command("mybets", showMyBets);
bot.hears("My Bets", showMyBets);

bot.command("openbets", async (ctx) => {
  const bets = getPendingBets().filter((bet) => !bet.opponent_id).slice(0, 10);
  if (bets.length === 0) {
    await ctx.reply("There are no open bets right now.");
    return;
  }

  const text = bets
    .map((bet) => `#${bet.id} - ${bet.amount_ton} TON - ${bet.description}`)
    .join("\n");

  await ctx.reply(`Open bets:\n\n${text}\n\nJoin with /join <id>`);
});

bot.command("bet", async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const betId = Number(parts[1]);
  if (!Number.isInteger(betId) || betId <= 0) {
    await ctx.reply("Usage: /bet <id>");
    return;
  }

  const bet = getBet(betId);
  if (!bet) {
    await ctx.reply("Bet not found.");
    return;
  }

  await replyBet(ctx, bet);
});

bot.command("join", async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const betId = Number(parts[1]);
  if (!Number.isInteger(betId) || betId <= 0) {
    await ctx.reply("Usage: /join <id>");
    return;
  }

  await handleJoin(ctx, betId);
});

bot.command("testpayout", async (ctx) => {
  const address = getTonAddress(ctx.from.id);
  if (!address) {
    await ctx.reply("Set your TON address first with /setaddress");
    return;
  }

  try {
    const result = await payout({
      winnerAddress: address,
      potTon: 0.02,
      oracleUsed: false,
      arbiterAddresses: [],
    });

    await ctx.reply(`[Test transaction](${TONSCAN}/tx/${result.winnerTxHash})`, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    await ctx.reply(`Payout error: ${error.message}`);
  }
});

bot.command("claim", async (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/);
  const betId = Number(parts[1]);
  if (!Number.isInteger(betId) || betId <= 0) {
    await ctx.reply("Usage: /claim <id>");
    return;
  }

  const bet = getBet(betId);
  if (!bet) {
    await ctx.reply("Bet not found.");
    return;
  }

  if (Number(bet.winner_id) !== Number(ctx.from.id) || bet.payout_txhash !== "pending_address") {
    await ctx.reply("There is no pending payout for this bet.");
    return;
  }

  const winnerAddress = getTonAddress(ctx.from.id);
  if (!winnerAddress) {
    await ctx.reply("Set your TON address first with /setaddress");
    return;
  }

  const votes = getVotes(bet.id);
  const oracleUsed = votes.length > 0;
  const arbiterAddresses = oracleUsed
    ? votes.map((vote) => getTonAddress(vote.arbiter_id)).filter(Boolean)
    : [];

  try {
    const payoutResult = await payout({
      winnerAddress,
      potTon: Number(bet.amount_ton) * 2,
      oracleUsed,
      arbiterAddresses,
    });

    finalizeBet(bet.id, bet.winner_id, payoutResult.winnerTxHash);
    await ctx.reply(`[Payout sent](${TONSCAN}/tx/${payoutResult.winnerTxHash})`, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    await ctx.reply(`Payout error: ${error.message}`);
  }
});

bot.on("text", async (ctx, next) => {
  const text = ctx.message.text.trim();

  if (awaitingAddress.has(ctx.from.id)) {
    if (!isValidTonAddress(text)) {
      await ctx.reply("Invalid TON address. Expected EQ... or UQ... format.");
      return;
    }

    saveTonAddress(ctx.from.id, text);
    awaitingAddress.delete(ctx.from.id);
    await ctx.reply("TON address saved.");
    return;
  }

  const state = awaitingBet.get(ctx.from.id);
  if (state?.step === "description") {
    awaitingBet.set(ctx.from.id, { step: "amount", description: text });
    await ctx.reply("Send the stake amount in TON, from 0.1 to 1000.");
    return;
  }

  if (state?.step === "amount") {
    const amountTon = parseAmount(text);
    if (amountTon === null || amountTon < 0.1 || amountTon > 1000) {
      await ctx.reply("Stake must be a number between 0.1 and 1000 TON.");
      return;
    }

    const betId = createBet(ctx.from.id, state.description, amountTon);
    const insight = analyzeBetDescription(state.description);
    awaitingBet.delete(ctx.from.id);
    await ctx.reply(
      `Bet #${betId} created.\n\n${insight.summary}\nRisk hint: ${insight.hints[0] || "This looks measurable enough for a clean demo."}\n\nShare this with the opponent:\n\`/join ${betId}\``,
      { parse_mode: "Markdown" },
    );
    await showDepositPrompt(ctx, betId, "creator");
    return;
  }

  await next();
});

bot.action(/^joincb:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await handleJoin(ctx, Number(ctx.match[1]));
});

bot.action(/^deposit:(\d+):(creator|opponent)$/, async (ctx) => {
  const betId = Number(ctx.match[1]);
  const role = ctx.match[2];
  const bet = getBet(betId);
  await ctx.answerCbQuery();

  if (!bet) {
    await ctx.reply("Bet not found.");
    return;
  }

  if (bet.status !== BET_STATUS.pending) {
    await ctx.reply("Deposits are already closed for this bet.");
    return;
  }

  const expectedUserId = role === "creator" ? bet.creator_id : bet.opponent_id;
  if (!expectedUserId || Number(expectedUserId) !== Number(ctx.from.id)) {
    await ctx.reply("This button is not for you.");
    return;
  }

  const participantAddress = getTonAddress(expectedUserId);
  if (!participantAddress) {
    await ctx.reply("Set your TON address first with /setaddress.");
    return;
  }

  // TODO: re-enable on-chain verification after demo
  confirmDeposit(betId, role);

  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch {
  }

  if (areBothDeposited(betId)) {
    await activateBetFlow(betId);
    await ctx.reply("Deposit confirmed. Both deposits are in. The bet is now active.");
    return;
  }

  await ctx.reply("Deposit confirmed. Waiting for the second deposit.");
});

bot.action(/^outcome:(\d+):(win|lose)$/, async (ctx) => {
  const betId = Number(ctx.match[1]);
  const outcome = ctx.match[2];
  const bet = getBet(betId);
  await ctx.answerCbQuery();

  if (!bet) {
    await ctx.reply("Bet not found.");
    return;
  }

  if (bet.status !== BET_STATUS.active && bet.status !== BET_STATUS.confirming) {
    await ctx.reply("This bet can no longer accept outcomes.");
    return;
  }

  if (Number(ctx.from.id) !== Number(bet.creator_id) && Number(ctx.from.id) !== Number(bet.opponent_id)) {
    await ctx.reply("You are not a participant in this bet.");
    return;
  }

  if (
    (Number(ctx.from.id) === Number(bet.creator_id) && bet.creator_outcome) ||
    (Number(ctx.from.id) === Number(bet.opponent_id) && bet.opponent_outcome)
  ) {
    await ctx.reply("You already submitted your outcome for this bet.");
    return;
  }

  submitOutcome(betId, ctx.from.id, outcome);
  const resolution = resolveOutcomes(betId);
  const updatedBet = getBet(betId);

  await ctx.reply("Your outcome was saved.");

  if (!resolution) {
    return;
  }

  if (resolution === "dispute") {
    await startOracleForBet(updatedBet, bot);
    return;
  }

  await handlePayoutForBet(updatedBet, resolution);
});

bot.action(/^vote:(\d+):(\d+)$/, async (ctx) => {
  const betId = Number(ctx.match[1]);
  const voteFor = Number(ctx.match[2]);
  const bet = getBet(betId);
  await ctx.answerCbQuery();

  if (!bet || bet.status !== BET_STATUS.oracle) {
    await ctx.reply("Oracle voting is not available for this bet.");
    return;
  }

  const result = await handleArbiterVote(betId, ctx.from.id, voteFor, bot);

  if (result.done) {
    await ctx.editMessageText(`Vote accepted. Winner decided: ${result.winnerId}.`);
    return;
  }

  await ctx.editMessageText("Vote accepted. Waiting for more arbiter votes.");
});

setInterval(async () => {
  const expiredBets = getExpiredBets();

  for (const bet of expiredBets) {
    try {
      if (bet.status === BET_STATUS.oracle) {
        await handleOracleRefund(bet, bot, "Oracle timeout expired.");
        continue;
      }

      const creatorAddress = getTonAddress(bet.creator_id);
      const opponentAddress = getTonAddress(bet.opponent_id);

      if (bet.creator_deposit && bet.opponent_deposit && creatorAddress && opponentAddress) {
        await refundBoth(creatorAddress, opponentAddress, bet.amount_ton);
      }

      refundBet(bet.id);
      await safeNotify(bot, bet.creator_id, `Bet #${bet.id} expired and was refunded.`);
      if (bet.opponent_id) {
        await safeNotify(bot, bet.opponent_id, `Bet #${bet.id} expired and was refunded.`);
      }
    } catch (error) {
      console.error(`Expired bet handler failed for bet ${bet.id}:`, error.message);
    }
  }
}, 5 * 60 * 1000);

if (process.env.DISABLE_BOT_LAUNCH !== "1") {
  bot.launch({
    allowedUpdates: ["message", "callback_query"],
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

export default bot;
