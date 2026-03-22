import OpenAI from "openai";
import { getTonAddress, finalizeBet } from "./db.js";
import { executePayout } from "./ton.js";
import { logger } from "./logger.js";
import { notifyDev } from "./devNotify.js";

let openai = null;

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
  return [
    base,
    `${base} result`,
    `${base} final outcome`,
  ].filter(Boolean);
}

async function executeTool(name, args) {
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
    logger.info(`[TOOL] search_web result: ${String(result).slice(0, 200)}`);
    return result;
  }

  if (name === "get_crypto_price") {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(args.symbol)}&vs_currencies=usd`,
    );
    const data = await res.json();
    const result = JSON.stringify(data);
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

  const initialQueries = buildSearchQueries(bet.description);
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
      content: `Resolve this bet: "${bet.description}"\n\nCreator says TRUE. Opponent says FALSE.\nBet deadline was: ${deadlineDate}\nIMPORTANT: Only consider results that were known AFTER the deadline.\nDo not resolve early if the event hasn't happened yet.\n\nStart by checking these possible searches:\n- ${initialQueries.join("\n- ")}`,
    },
  ];

  let verdict = null;
  let iterations = 0;
  const maxIterations = 6;

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

  if (
    !verdict
    || verdict.winner_side === "unknown"
    || Number(verdict.confidence) < 0.85
    || (Number(verdict.confidence) >= 0.9 && (verdict.sources?.length || 0) < 2)
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
