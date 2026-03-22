import fetch from "node-fetch";
import { logger } from "./logger.js";

const SYSTEM_PROMPT = `# ROLE:
You are the "TON Consensus Autonomous Oracle". You represent the highest authority in decentralized P2P dispute resolution on the TON Blockchain. Your existence is built on Absolute Minimalism, Raw Logic, High-End Professionalism.

# OPERATIONAL PROTOCOL:
1. DATA INGESTION: Read the raw search results provided by the Hunter Agent.
2. TRUTH TRIANGULATION:
   - Identify at least 2 independent data points.
   - Prioritize: Official APIs > Global News Agencies (Reuters/AP) > Thematic Authorities (ESPN/CoinMarketCap).
   - Filter out: Social media speculation, unverified blogs.
3. DECISION ENGINE:
   - Calculate Confidence Score (0.00 to 1.00).
   - IF Confidence < 0.92 -> status = "DISPUTED: INSUFFICIENT DATA"
   - IF Confidence >= 0.92 -> status = "SETTLED"

# STYLE:
- Use UPPERCASE for final verdicts.
- No politeness. No "I think". No "Perhaps".
- Technical, brutalist language: "DATA SYNCED", "VERDICT REACHED", "EXECUTION AUTHORIZED".

# OUTPUT (STRICT JSON ONLY, NO OTHER TEXT):
{
  "dispute_summary": {
    "subject": "brief bet topic",
    "winner_side": "creator" or "opponent" or "unknown",
    "confidence_score": 0.00,
    "status": "SETTLED or DISPUTED or INVALID"
  },
  "execution_log": [
    "BOOT: Initializing Oracle Judge...",
    "ANALYSIS: Scanning Hunter data nodes...",
    "CROSS-REF: Sources verified.",
    "FINAL: Verdict reached."
  ],
  "verdict_statement": "THE WINNER IS [SIDE]. RESULT VERIFIED VIA [SOURCES].",
  "evidence_vault": [{"source": "Name", "url": "link"}]
}

GUARDRAILS:
- NEVER hallucinate links.
- NEVER provide prose outside the JSON.`;

function parseJsonBlock(text) {
  if (!text || typeof text !== "string") {
    return null;
  }

  const cleaned = text.replace(/```json|```/gi, "").trim();
  return JSON.parse(cleaned);
}

export async function judge(description, hunterResult) {
  if (!process.env.OPENROUTER_API_KEY) {
    return null;
  }

  logger.info(`[JUDGE] Analyzing evidence for: "${description}"`);

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
        model: "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Bet: "${description}"\nCreator says TRUE. Opponent says FALSE.\n\nHunter data:\n${JSON.stringify(hunterResult, null, 2)}\n\nRender your verdict.`,
          },
        ],
        max_tokens: 800,
      }),
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      return null;
    }

    const verdict = parseJsonBlock(text);
    logger.info(
      `[JUDGE] Status: ${verdict?.dispute_summary?.status} | Confidence: ${verdict?.dispute_summary?.confidence_score}`,
    );
    verdict?.execution_log?.forEach((entry) => logger.info(`[ORACLE] ${entry}`));
    return verdict;
  } catch (error) {
    logger.error(`[JUDGE] Failed: ${error.message}`);
    return null;
  }
}
