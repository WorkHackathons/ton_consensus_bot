import OpenAI from "openai";
import { getTonAddress, finalizeBet } from "./db.js";
import { executePayout } from "./ton.js";
import { logger } from "./logger.js";
import { notifyDev } from "./devNotify.js";
import { analyzeBetDescription } from "./assistant.js";

let openai = null;
const toolCache = new Map();

const tools = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for real-world event results and facts",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to find event result",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_crypto_price",
      description: "Get current cryptocurrency price from CoinGecko",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Crypto symbol like bitcoin, ethereum, the-open-network",
          },
        },
        required: ["symbol"],
      },
    },
  },
];

function escapeMarkdown(text = "") {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function cleanJsonResponse(content = "") {
  return String(content)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeVerdict(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const confidence = Number(raw.confidence ?? 0);
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((item) => typeof item === "string" && item.trim())
    : [];

  return {
    winner_side: raw.winner_side,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    result: typeof raw.result === "string" ? raw.result : "insufficient data",
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "could not verify",
    sources,
  };
}

function buildSearchQueries(description) {
  const base = String(description || "").trim();
  const analysis = analyzeBetDescription(base);
  const category = String(analysis.category || "").toLowerCase();
  const extra = [];

  if (category.includes("measurable")) {
    extra.push(`${base} final score`);
    extra.push(`${base} winner result`);
  } else if (category.includes("evidence")) {
    extra.push(`${base} proof`);
    extra.push(`${base} screenshot source`);
  } else if (category.includes("onchain")) {
    extra.push(`${base} tx hash`);
    extra.push(`${base} wallet explorer proof`);
  }

  return [
    base,
    `${base} result`,
    `${base} final outcome`,
    ...extra,
  ].filter(Boolean);
}

function detectCryptoSymbol(description = "") {
  const text = String(description).toLowerCase();
  if (/\bbitcoin\b|\bbtc\b/.test(text)) return "bitcoin";
  if (/\bethereum\b|\beth\b/.test(text)) return "ethereum";
  if (/\bton\b|\bthe open network\b/.test(text)) return "the-open-network";
  return null;
}

function parseThresholdValue(rawNumber = "", suffix = "") {
  const numeric = Number(String(rawNumber).replace(/[,\s]/g, "").trim());
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const multiplier = suffix.toLowerCase() === "k"
    ? 1_000
    : suffix.toLowerCase() === "m"
      ? 1_000_000
      : 1;

  return numeric * multiplier;
}

function parseCryptoPriceDispute(description = "") {
  const text = String(description);
  const symbol = detectCryptoSymbol(text);
  if (!symbol) {
    return null;
  }

  const comparatorMatch = text.match(/(?:\b(under|below|less than|over|above|greater than)\b|([<>]))\s*\$?\s*([\d.,\s]+)\s*([km]?)\s*\$?/i);
  if (!comparatorMatch) {
    return null;
  }

  const comparatorWord = String(comparatorMatch[1] || comparatorMatch[2] || "").toLowerCase();
  const threshold = parseThresholdValue(comparatorMatch[3], comparatorMatch[4] || "");
  if (!Number.isFinite(threshold)) {
    return null;
  }

  const comparator = /under|below|less than/.test(comparatorWord) ? "lt" : "gt";
  return { symbol, threshold, comparator };
}

function parseEntityDefinitionDispute(description = "") {
  const text = String(description).trim();
  const match = text.match(/^(.+?)\s+is\s+a[n]?\s+(cryptocurrency|blockchain)\.?\s*$/i);
  if (!match) {
    return null;
  }

  return {
    entity: match[1].trim(),
    category: match[2].trim().toLowerCase(),
  };
}

async function tryResolveCryptoPriceDispute(bet) {
  const parsed = parseCryptoPriceDispute(bet.description);
  if (!parsed) {
    return null;
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  if (bet.deadline && nowUnix < Number(bet.deadline)) {
    logger.info(`[ENGINE] Crypto price fast-path skipped for bet #${bet.id}: deadline not reached yet`);
    return null;
  }

  const rawPrice = await executeTool("get_crypto_price", { symbol: parsed.symbol });
  let payload = null;
  try {
    payload = JSON.parse(String(rawPrice));
  } catch {
    payload = null;
  }

  const price = Number(payload?.[parsed.symbol]?.usd);
  if (!Number.isFinite(price)) {
    logger.warn(`[ENGINE] Crypto price fast-path failed for bet #${bet.id}: price unavailable`);
    return null;
  }

  const conditionTrue = parsed.comparator === "lt"
    ? price < parsed.threshold
    : price > parsed.threshold;

  const comparatorText = parsed.comparator === "lt" ? "under" : "over";
  const winnerSide = conditionTrue ? "creator" : "opponent";

  return {
    winner_side: winnerSide,
    confidence: 0.99,
    result: `${parsed.symbol} traded at $${price.toFixed(2)} and the threshold was ${comparatorText} $${parsed.threshold.toLocaleString()}.`,
    reasoning: `This dispute matches a direct crypto price condition and was resolved from a live CoinGecko price lookup after the deadline.`,
    sources: ["CoinGecko API"],
  };
}

async function tryResolveDefinitionDispute(bet) {
  const parsed = parseEntityDefinitionDispute(bet.description);
  if (!parsed) {
    return null;
  }

  const evidence = String(await executeTool("search_web", { query: `${parsed.entity} ${parsed.category}` })).toLowerCase();
  const entityText = parsed.entity.toLowerCase();

  const confirms =
    evidence.includes(entityText)
    && evidence.includes(parsed.category)
    && !/(not a|isn't a|is not a)/.test(evidence);

  if (!confirms) {
    logger.warn(`[ENGINE] Definition fast-path inconclusive for bet #${bet.id}`);
    return null;
  }

  return {
    winner_side: "creator",
    confidence: 0.97,
    result: `${parsed.entity} is described as a ${parsed.category} in the retrieved evidence.`,
    reasoning: `This dispute matches a direct factual definition claim and the retrieved evidence confirms the statement.`,
    sources: ["Tavily search"],
  };
}

async function executeTool(name, args) {
  const cacheKey = `${name}:${JSON.stringify(args || {})}`;
  const now = Date.now();
  const cached = toolCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    logger.info(`[TOOL] Cache hit for ${name} with ${JSON.stringify(args)}`);
    return cached.value;
  }

  logger.info(`[TOOL] Calling ${name} with ${JSON.stringify(args)}`);

  if (name === "search_web") {
    if (!process.env.TAVILY_API_KEY) {
      return "TAVILY_API_KEY is not configured";
    }

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: args.query,
        max_results: 3,
        include_answer: true,
      }),
    });
    const data = await res.json();
    const result = data.answer || data.results?.map((row) => row.content).join("\n") || "No results found";
    toolCache.set(cacheKey, { value: result, expiresAt: now + 30_000 });
    logger.info(`[TOOL] search_web result: ${String(result).slice(0, 200)}`);
    return result;
  }

  if (name === "get_crypto_price") {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(args.symbol)}&vs_currencies=usd`,
    );
    const data = await res.json();
    const result = JSON.stringify(data);
    toolCache.set(cacheKey, { value: result, expiresAt: now + 60_000 });
    logger.info(`[TOOL] get_crypto_price result: ${result}`);
    return result;
  }

  return "Tool not available";
}

async function resolveBetWithAgent(bet) {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn("[ENGINE] OPENAI_API_KEY not set, skipping");
    return null;
  }

  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  logger.info(`[ENGINE] Starting ReAct agent for bet #${bet.id}: "${bet.description}"`);

  const fastCryptoVerdict = await tryResolveCryptoPriceDispute(bet);
  if (fastCryptoVerdict) {
    logger.info(`[ENGINE] Fast crypto resolver produced verdict: ${JSON.stringify(fastCryptoVerdict)}`);
    return fastCryptoVerdict;
  }

  const fastDefinitionVerdict = await tryResolveDefinitionDispute(bet);
  if (fastDefinitionVerdict) {
    logger.info(`[ENGINE] Fast definition resolver produced verdict: ${JSON.stringify(fastDefinitionVerdict)}`);
    return fastDefinitionVerdict;
  }

  const initialQueries = buildSearchQueries(bet.description);
  const initialWebEvidence = await executeTool("search_web", { query: initialQueries[0] });
  const cryptoSymbol = parseCryptoPriceDispute(bet.description)?.symbol || null;
  const initialPriceEvidence = cryptoSymbol
    ? await executeTool("get_crypto_price", { symbol: cryptoSymbol })
    : null;
  const deadlineDate = bet.deadline ? new Date(Number(bet.deadline) * 1000).toUTCString() : "unknown";

  const messages = [
    {
      role: "system",
      content: `You are an autonomous dispute resolution AI agent for TON Consensus - a P2P betting platform on TON blockchain.

Your mission: determine who wins this bet by finding real facts from the internet.
- Creator bet this statement is TRUE
- Opponent bet this statement is FALSE

Use your tools to search for evidence. Make multiple searches if needed.
High confidence requires evidence from at least 2 independent sources or a directly verifiable pricing/API lookup.
When you have enough evidence (confidence > 85%), respond with ONLY this JSON:
{
  "winner_side": "creator" or "opponent",
  "confidence": 0.0-1.0,
  "result": "what you found",
  "reasoning": "brief explanation",
  "sources": ["source1", "source2"]
}

If you cannot find enough evidence, respond with:
{"winner_side": "unknown", "confidence": 0.0, "result": "insufficient data", "reasoning": "could not verify"}`,
    },
    {
      role: "user",
      content: `Resolve this bet: "${bet.description}"\n\nCreator says TRUE. Opponent says FALSE.\nBet deadline was: ${deadlineDate}\nIMPORTANT: Only consider results that were known AFTER the deadline.\nDo not resolve early if the event hasn't happened yet.\n\nInitial web evidence:\n${String(initialWebEvidence).slice(0, 1200)}\n\n${initialPriceEvidence ? `Initial crypto price evidence:\n${String(initialPriceEvidence).slice(0, 600)}\n\n` : ""}Suggested follow-up searches:\n- ${initialQueries.join("\n- ")}`,
    },
  ];

  let verdict = null;
  let iterations = 0;
  const maxIterations = 4;

  while (iterations < maxIterations) {
    iterations += 1;
    logger.info(`[ENGINE] Iteration ${iterations}/${maxIterations}`);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      max_tokens: 1000,
    });

    const message = response.choices[0]?.message;
    if (!message) {
      break;
    }

    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: message.tool_calls,
    });

    if (message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        const result = await executeTool(call.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: String(result),
        });
      }
      continue;
    }

    if (message.content) {
      try {
        verdict = normalizeVerdict(JSON.parse(cleanJsonResponse(message.content)));
        logger.info(`[ENGINE] Verdict: ${JSON.stringify(verdict)}`);
        break;
      } catch {
        logger.warn("[ENGINE] Could not parse verdict, asking model to return strict JSON");
        messages.push({
          role: "user",
          content: "Return ONLY valid JSON matching the required schema. No markdown, no prose, no code fences.",
        });
        continue;
      }
    }

    break;
  }

  const isDirectCryptoDispute = Boolean(parseCryptoPriceDispute(bet.description));
  if (
    !verdict
    || verdict.winner_side === "unknown"
    || Number(verdict.confidence) < 0.85
    || (!isDirectCryptoDispute && Number(verdict.confidence) >= 0.9 && (verdict.sources?.length || 0) < 2)
  ) {
    logger.warn("[ENGINE] Low confidence or unknown result, routing to human oracle");
    return null;
  }

  return verdict;
}

export async function runArbiterEngineDryRun(bet) {
  logger.info(`Starting runArbiterEngineDryRun for bet_id: ${bet.id}`);
  const verdict = await resolveBetWithAgent(bet);
  if (!verdict) {
    logger.warn(`runArbiterEngineDryRun failed for bet_id: ${bet.id}, reason: low confidence or no verdict`);
    return null;
  }
  logger.info(`runArbiterEngineDryRun completed successfully: ${JSON.stringify(verdict)}`);
  return verdict;
}

export async function runArbiterEngine(bet, bot) {
  logger.info(`Starting runArbiterEngine for bet_id: ${bet.id}`);
  const verdict = await resolveBetWithAgent(bet);
  if (!verdict) {
    return { status: "low_confidence" };
  }

  const winnerId = verdict.winner_side === "creator" ? bet.creator_id : bet.opponent_id;
  const loserId = Number(winnerId) === Number(bet.creator_id) ? bet.opponent_id : bet.creator_id;
  const winnerAddress = getTonAddress(winnerId);

  logger.info(`[ENGINE] Winner: ${winnerId}, paying out...`);

  let txHash = "pending";
  if (winnerAddress) {
    try {
      const payoutResult = await executePayout(bet.id, winnerAddress, Number(bet.amount_ton) * 2);
      txHash = payoutResult.txHash;
      logger.info(`[ENGINE] Payout success: ${txHash}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[ENGINE] Payout error: ${message}`);
      await notifyDev(`💸 AI PAYOUT FAILED\nBet: ${bet.id}\nWinner: ${winnerAddress}\nAmount: ${Number(bet.amount_ton) * 2}\nError: ${message}`);
      return {
        status: "payout_failed",
        winnerId,
        winnerAddress,
        verdict,
        error: message,
      };
    }
  } else {
    txHash = "pending_address";
    logger.warn(`[ENGINE] Winner ${winnerId} has no wallet address, marking payout pending`);
  }

  finalizeBet(bet.id, winnerId, txHash);

  const tonscan = process.env.NETWORK === "mainnet"
    ? "https://tonscan.org"
    : "https://testnet.tonscan.org";

  const sourcesText = Array.isArray(verdict.sources) ? verdict.sources.slice(0, 2).join(", ") : "";
  const payoutAmount = (Number(bet.amount_ton) * 2 * 0.90).toFixed(2);

  try {
    await bot.telegram.sendMessage(
      winnerId,
      `🤖 *AI Agent resolved this dispute*\n\n`
        + `📋 _${escapeMarkdown(bet.description)}_\n\n`
        + `🔍 Found: ${escapeMarkdown(verdict.result || "")}\n`
        + `💡 ${escapeMarkdown(verdict.reasoning || "")}\n`
        + `🎯 Confidence: ${Math.round(Number(verdict.confidence) * 100)}%\n`
        + `${sourcesText ? `📚 Sources: ${escapeMarkdown(sourcesText)}\n` : ""}\n`
        + `🏆 You won! *${payoutAmount} TON*\n`
        + `${txHash && txHash !== "pending_address" ? `🔗 [Transaction](${tonscan}/tx/${txHash})` : "Connect your wallet in the Mini App to receive payout."}`,
      { parse_mode: "Markdown" },
    );

    await bot.telegram.sendMessage(
      loserId,
      `🤖 *AI Agent resolved this dispute*\n\n`
        + `📋 _${escapeMarkdown(bet.description)}_\n\n`
        + `📊 ${escapeMarkdown(verdict.result || "")}\n`
        + `💡 ${escapeMarkdown(verdict.reasoning || "")}\n\n`
        + `❌ You lost this one.`,
      { parse_mode: "Markdown" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[ENGINE] Notification failed: ${message}`);
    await notifyDev(`🤖 ENGINE NOTIFY FAILED\nBet: ${bet.id}\nError: ${message}`);
  }

  logger.info(`runArbiterEngine completed successfully: ${txHash}`);
  return {
    status: "resolved",
    winnerId,
    txHash,
    verdict,
  };
}
