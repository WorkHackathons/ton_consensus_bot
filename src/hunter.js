import fetch from "node-fetch";
import { logger } from "./logger.js";

function parseJsonBlock(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const cleaned = text.replace(/```json|```/gi, "").trim();
  return JSON.parse(cleaned);
}

export async function hunt(description) {
  if (!process.env.OPENROUTER_API_KEY) {
    return null;
  }

  logger.info(`[HUNTER] Searching: "${description}"`);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ton-consensus.app",
        "X-Title": "TON Consensus",
      },
      body: JSON.stringify({
        model: "perplexity/sonar-small-online",
        messages: [
          {
            role: "system",
            content: 'You are a fact-finding agent. Search for real information about the given event. Return ONLY valid JSON: {"found": true/false, "sources": [{"url": "...", "summary": "...", "date": "..."}], "raw_result": "what happened in one sentence"}',
          },
          {
            role: "user",
            content: `Find real information about this event: "${description}". Return at least 2 independent sources.`,
          },
        ],
        max_tokens: 600,
      }),
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      return null;
    }

    const result = parseJsonBlock(text);
    logger.info(`[HUNTER] Found ${result?.sources?.length || 0} sources`);
    return result;
  } catch (error) {
    logger.error(`[HUNTER] Failed: ${error.message}`);
    return null;
  }
}
