import "dotenv/config";
import express from "express";
import { Markup, Telegraf } from "telegraf";
import {
  activateBet,
  areBothDeposited,
  becomeArbiter,
  confirmDeposit,
  finalizeBet,
  getBet,
  getExpiredBets,
  getArbiterAccuracy,
  getUser,
  getLatestUserBet,
  getTonAddress,
  initDB,
  refundBet,
  resolveOutcomes,
  saveTonAddress,
  setReferrer,
  submitOutcome,
  upsertUser,
} from "./db.js";
import db from "./db.js";
import createApiRouter from "./api.js";
import { handleArbiterVote, handleOracleRefund, safeNotify, startOracleForBet } from "./oracle.js";
import { BET_STATUS, OUTCOME } from "./states.js";
import { checkMcpHealth, payout, refundBoth, refundSingle } from "./ton.js";

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error("TELEGRAM_TOKEN is required");
  process.exit(1);
}

const bot = new Telegraf(token);
const TONSCAN = process.env.NETWORK === "mainnet" ? "https://tonscan.org" : "https://testnet.tonscan.org";
const ARBITER_INVITE_IMAGE = "https://github.com/WorkHackathons/ton_consensus_bot/blob/main/photo_2026-03-20_23-19-26.jpg?raw=true";

function escapeMarkdown(text = "") {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function buildAppUrl(path = "") {
  const base = process.env.MINIAPP_URL?.replace(/\/$/, "");
  if (!base) {
    return null;
  }

  return path ? `${base}${path}` : base;
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

  app.use("/api", createApiRouter(bot));
  app.use("/miniapp", express.static("miniapp-react/dist"));
  app.listen(process.env.API_PORT || 3001, () => console.log(`API on ${process.env.API_PORT || 3001}`));
}

checkMcpHealth().catch(() => console.warn("MCP unavailable, continuing..."));

async function activateBetFlow(betId) {
  activateBet(betId);
  const bet = getBet(betId);
  if (!bet) {
    return;
  }

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
    await safeNotify(bot, winnerId, `You won bet #${freshBet.id}, but your TON address is missing in the Mini App.`);
    await safeNotify(bot, loserId, `Bet #${freshBet.id} finished. Winner payout is waiting for a wallet address.`);
    return;
  }

  const payoutResult = await payout({
    betId: freshBet.id,
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

bot.use(async (ctx, next) => {
  if (ctx.from) {
    upsertUser(ctx.from.id, ctx.from.username || ctx.from.first_name || null);
  }
  await next();
});

bot.start(async (ctx) => {
  const existingUser = getUser(ctx.from.id);
  upsertUser(ctx.from.id, ctx.from.username);

  const payload = ctx.startPayload || "";
  let appUrl = buildAppUrl();
  let isJoinInvite = false;

  if (payload.startsWith("ref_")) {
    const referrerId = Number(payload.replace("ref_", ""));
    if (referrerId && Number(referrerId) !== Number(ctx.from.id)) {
      const wasLinked = setReferrer(ctx.from.id, referrerId);
      if (wasLinked) {
        bot.telegram.sendMessage(
          referrerId,
          "🎉 Someone joined via your referral link!\nYou'll earn 2% of platform fee from their bets automatically.",
        ).catch(() => {});
      }
    }
  }

  if (payload === "newbet") {
    appUrl = buildAppUrl("?action=newbet");
  } else if (payload === "mybets") {
    appUrl = buildAppUrl("?action=mybets");
  } else if (payload.startsWith("join_")) {
    const betId = Number(payload.replace("join_", ""));
    if (Number.isInteger(betId) && betId > 0) {
      appUrl = buildAppUrl(`?action=join&bet=${betId}`);
      isJoinInvite = true;
    }
  } else if (payload.startsWith("bet_")) {
    const betId = Number(payload.replace("bet_", ""));
    if (Number.isInteger(betId) && betId > 0) {
      appUrl = buildAppUrl(`?bet=${betId}`);
    }
  }

  if (!appUrl) {
    await ctx.reply("Mini App not configured yet.");
    return;
  }

  if (isJoinInvite) {
    const betId = Number(payload.replace("join_", ""));
    const bet = getBet(betId);
    const inviteCaption = bet
      ? `👊 *Challenge received*\n\n` +
        `*Bet:* ${escapeMarkdown(bet.description)}\n` +
        `*Stake:* ${bet.amount_ton} TON each\n\n` +
        `Open the Mini App below to accept this exact challenge and continue inside the app.`
      : `👊 *Challenge received*\n\n` +
        `Open the Mini App below to accept this exact challenge and continue inside the app.`;

    await ctx.reply(inviteCaption, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "⚡ Accept Challenge in App", web_app: { url: appUrl } },
        ]],
      },
    });
    return;
  }

  const caption =
    `👊 *TON Consensus*\n\n` +
    `Bet on anything.\n` +
    `AI judges the outcome.\n` +
    `TON pays the winner.\n\n` +
    `_No trust needed. No human judges._`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📱 Open App", web_app: { url: appUrl } }],
        [
          { text: "⚡️ Create Bet", web_app: { url: `${appUrl}?action=newbet` } },
          { text: "📋 My Bets", web_app: { url: `${appUrl}?action=mybets` } },
        ],
      ],
    },
    parse_mode: "Markdown",
  };

  if (process.env.VIDEO_FILE_ID) {
    await ctx.replyWithVideo(process.env.VIDEO_FILE_ID, { caption, ...keyboard });
  } else {
    await ctx.reply(caption, keyboard);
  }

  setTimeout(async () => {
    const user = getUser(ctx.from.id);
    if (user && !user.arbiter_since && (existingUser?.bets_count ?? 0) === 0) {
      await bot.telegram.sendPhoto(
        ctx.from.id,
        ARBITER_INVITE_IMAGE,
        {
          caption:
            `⚖️ *Become a TON Consensus Arbiter!*\n\n` +
            `Help resolve disputes and earn TON automatically.\n\n` +
            `*How it works:*\n` +
            `• Get notified when a dispute needs resolution\n` +
            `• Vote anonymously on who is right\n` +
            `• Receive your share of commission in TON\n\n` +
            `*Your earnings:*\n` +
            `10 TON pot → you earn ~0.17 TON\n` +
            `100 TON pot → you earn ~1.7 TON\n` +
            `1,000 TON pot → you earn ~17 TON\n\n` +
            `The more disputes on the platform — the more you earn.`,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Become Arbiter", callback_data: "become_arbiter" },
              { text: "❌ Maybe later", callback_data: "skip_arbiter" },
            ]],
          },
        },
      ).catch(() => {});
    }
  }, 30000);
});

bot.on("inline_query", async (ctx) => {
  const query = (ctx.inlineQuery?.query || "").trim();
  let bet = null;

  if (/^bet_\d+$/i.test(query)) {
    const betId = Number(query.replace(/^bet_/i, ""));
    const requestedBet = getBet(betId);
    if (
      requestedBet
      && (Number(requestedBet.creator_id) === Number(ctx.from.id) || Number(requestedBet.opponent_id) === Number(ctx.from.id))
    ) {
      bet = requestedBet;
    }
  }

  if (!bet) {
    bet = getLatestUserBet(ctx.from.id);
  }

  if (!bet) {
    await ctx.answerInlineQuery([], { cache_time: 5 });
    return;
  }

  const logoUrl = "https://raw.githubusercontent.com/WorkHackathons/ton_consensus_bot/main/photo_2026-03-20_18-21-48.jpg";

  await ctx.answerInlineQuery([
    {
      type: "photo",
      id: String(bet.id),
      title: `Bet #${bet.id}: ${bet.description}`,
      description: `${bet.amount_ton} TON each`,
      photo_url: logoUrl,
      thumbnail_url: logoUrl,
      caption:
        `*I challenge you to a bet!*\n\n` +
        `_${escapeMarkdown(bet.description)}_\n\n` +
        `*${bet.amount_ton} TON* each\n\n` +
        `Accept the challenge below.`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{
          text: "Accept Bet",
          url: `https://t.me/ton_consensus_bot?start=join_${bet.id}`,
        }]],
      },
    },
  ], { cache_time: 5 });
});

bot.command("app", async (ctx) => {
  const url = process.env.MINIAPP_URL;
  if (!url) {
    await ctx.reply("Mini App not configured yet.");
    return;
  }

  await ctx.reply("📱 Open TON Consensus", {
    reply_markup: {
      inline_keyboard: [[{ text: "Open App", web_app: { url } }]],
    },
  });
});

bot.command("getvideoid", async (ctx) => {
  if (ctx.message?.reply_to_message?.video) {
    await ctx.reply(`VIDEO_FILE_ID=${ctx.message.reply_to_message.video.file_id}`);
    return;
  }

  await ctx.reply("Reply to a video with /getvideoid");
});

async function replaceArbiterPrompt(ctx, text, extra = {}) {
  try {
    if (ctx.callbackQuery?.message?.photo) {
      await ctx.editMessageCaption(text, extra);
      return;
    }
    await ctx.editMessageText(text, extra);
  } catch {
    await ctx.reply(text, extra);
  }
}

bot.action("become_arbiter", async (ctx) => {
  await ctx.answerCbQuery();
  const addr = getTonAddress(ctx.from.id);
  if (!addr) {
    const miniAppUrl = buildAppUrl("?action=mybets");
    await replaceArbiterPrompt(
      ctx,
      "Connect your TON wallet inside the Mini App first to receive arbiter rewards.\n\nIf your wallet is already connected, reopen the Mini App once so the bot can sync your address, then tap Become Arbiter again.",
      miniAppUrl
        ? {
            reply_markup: {
              inline_keyboard: [[
                { text: "Open Mini App", web_app: { url: miniAppUrl } },
              ]],
            },
          }
        : undefined,
    );
    return;
  }

  becomeArbiter(ctx.from.id);
  const refLink = `https://t.me/ton_consensus_bot?start=ref_${ctx.from.id}`;
  await replaceArbiterPrompt(
    ctx,
    `✅ *You are now a TON Consensus Arbiter!*\n\n` +
    `We'll notify you when your vote is needed.\n` +
    `Earn TON by helping the platform grow.\n\n` +
    `*Invite friends and earn more:*\n` +
    `Get 2% of platform fee from every bet your referrals make.\n\n` +
    `🔗 Your referral link:\n\`${refLink}\``,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "📤 Share Referral Link", callback_data: "share_referral" },
        ]],
      },
    },
  );
});

bot.action("skip_arbiter", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
});

bot.action("share_referral", async (ctx) => {
  await ctx.answerCbQuery();
  const refLink = `https://t.me/ton_consensus_bot?start=ref_${ctx.from.id}`;
  await ctx.reply(
    `🔗 *Your Referral Link:*\n\n` +
    `\`${refLink}\`\n\n` +
    `*What you earn:*\n` +
    `• 2% of platform fee from every bet your referrals make\n` +
    `• Paid automatically in TON\n` +
    `• Unlimited referrals\n\n` +
    `Share in your chats and earn passively!`,
    { parse_mode: "Markdown" },
  );
});

bot.command("arbiter", async (ctx) => {
  const addr = getTonAddress(ctx.from.id);
  if (!addr) {
    await ctx.reply("Connect your TON wallet inside the Mini App first.");
    return;
  }

  const user = getUser(ctx.from.id);
  if (user?.arbiter_since) {
    await ctx.reply("✅ You are already an arbiter!");
    return;
  }

  becomeArbiter(ctx.from.id);
  const refLink = `https://t.me/ton_consensus_bot?start=ref_${ctx.from.id}`;
  await ctx.reply(
    `✅ *You are now an arbiter!*\n\n` +
    `You'll receive notifications when disputes need resolution.\n\n` +
    `🔗 Your referral link:\n\`${refLink}\``,
    { parse_mode: "Markdown" },
  );
});

bot.command("mystats", async (ctx) => {
  const user = getUser(ctx.from.id);
  const accuracy = getArbiterAccuracy(ctx.from.id);
  const isArbiter = !!user?.arbiter_since;
  const referrals = Number(db.prepare(
    "SELECT COUNT(*) as count FROM users WHERE referred_by = ?",
  ).get(ctx.from.id)?.count ?? 0);

  await ctx.reply(
    `📊 *Your Stats*\n\n` +
    `💼 Bets: ${user?.bets_count ?? 0}\n` +
    `⚖️ Arbiter: ${isArbiter ? "✅ Active" : "❌ Not yet"}\n` +
    (isArbiter
      ? `🎯 Votes cast: ${accuracy.total}\n` +
        `📈 Accuracy: ${accuracy.accuracy !== null ? `${accuracy.accuracy}%` : "no data yet"}\n`
      : "") +
    `👥 Referrals: ${referrals}\n` +
    `💰 Referral earnings: ${(Number(user?.referral_earnings ?? 0)).toFixed(2)} TON\n\n` +
    (!isArbiter ? "Become an arbiter and earn TON → /arbiter" : ""),
    { parse_mode: "Markdown" },
  );
});

bot.on("message", async (ctx, next) => {
  if (!ctx.message?.web_app_data) {
    return next();
  }

  try {
    const data = JSON.parse(ctx.message.web_app_data.data);
    if (data.type === "saveAddress" && data.address) {
      saveTonAddress(ctx.from.id, data.address);
      await ctx.reply("✅ Wallet connected!");
    }
  } catch {
  }

  return next();
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
    await ctx.reply("Connect your wallet in the Mini App first.");
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

  if (!resolution || !updatedBet) {
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

  if (result.error) {
    await ctx.reply(result.error);
    return;
  }

  if (result.done) {
    await ctx.editMessageText(`Vote accepted. Winner decided: ${result.winnerId}.`);
    return;
  }

  await ctx.editMessageText("Vote accepted. Waiting for more arbiter votes.");
});

setInterval(async () => {
  const now = Math.floor(Date.now() / 1000);

  const expiredActive = db.prepare(`
    SELECT *
    FROM bets
    WHERE status IN ('active', 'confirming')
      AND deadline IS NOT NULL
      AND deadline < ?
  `).all(now);

  for (const bet of expiredActive) {
    try {
      const hasCreatorOutcome = !!bet.creator_outcome;
      const hasOpponentOutcome = !!bet.opponent_outcome;

      if (!hasCreatorOutcome && !hasOpponentOutcome) {
        await startOracleForBet(bet, bot);
        await safeNotify(
          bot,
          bet.creator_id,
          `⏰ Bet #${bet.id} deadline passed.\nNo outcome submitted. AI Oracle will resolve this dispute.`,
        );
        await safeNotify(
          bot,
          bet.opponent_id,
          `⏰ Bet #${bet.id} deadline passed.\nNo outcome submitted. AI Oracle will resolve this dispute.`,
        );
        continue;
      }

      if (hasCreatorOutcome && !hasOpponentOutcome) {
        await safeNotify(
          bot,
          bet.opponent_id,
          `⏰ Reminder: Bet #${bet.id} deadline passed.\nPlease submit your outcome in the app or oracle will decide.`,
        );
      }

      if (!hasCreatorOutcome && hasOpponentOutcome) {
        await safeNotify(
          bot,
          bet.creator_id,
          `⏰ Reminder: Bet #${bet.id} deadline passed.\nPlease submit your outcome in the app or oracle will decide.`,
        );
      }
    } catch (error) {
      console.error(`Expired active bet handler failed for bet ${bet.id}:`, error.message);
    }
  }

  const expiredPending = db.prepare(`
    SELECT *
    FROM bets
    WHERE status = 'pending'
      AND deadline IS NOT NULL
      AND deadline < ?
  `).all(now);

  for (const bet of expiredPending) {
    try {
      const creatorAddress = getTonAddress(bet.creator_id);
      const opponentAddress = getTonAddress(bet.opponent_id);

      if (bet.creator_deposit && bet.opponent_id && bet.opponent_deposit && creatorAddress && opponentAddress) {
        await refundBoth(creatorAddress, opponentAddress, bet.amount_ton);
      } else if (bet.creator_deposit && creatorAddress) {
        await refundSingle(creatorAddress, bet.amount_ton);
      }

      refundBet(bet.id);
      await safeNotify(
        bot,
        bet.creator_id,
        `⏰ Bet #${bet.id} expired with no opponent.\nYour deposit has been refunded.`,
      );
    } catch (error) {
      console.error(`Expired pending bet handler failed for bet ${bet.id}:`, error.message);
    }
  }

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
    allowedUpdates: ["message", "callback_query", "inline_query"],
  });

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

export default bot;
