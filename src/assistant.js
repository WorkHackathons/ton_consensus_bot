function compact(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function analyzeBetDescription(description) {
  const text = compact(description);
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  const signals = {
    score: /(score|goals|kills|wins|match|game|rsi|price|trade|market)/i.test(text),
    media: /(screenshot|photo|video|stream|tweet|post|link|message|chat)/i.test(text),
    deadline: /(today|tomorrow|before|after|utc|\d{1,2}:\d{2}|\d{1,2}[./-]\d{1,2})/i.test(text),
    transaction: /(tx|hash|wallet|address|transfer|deposit|swap|buy|sell)/i.test(text),
    subjective: /(better|best|good|bad|fair|deserve|cool|funny|trust)/i.test(text),
  };

  let category = "general";
  if (signals.transaction) category = "onchain action";
  else if (signals.score) category = "measurable outcome";
  else if (signals.media) category = "evidence-based claim";
  else if (signals.subjective) category = "subjective claim";

  const shortText = text.length > 110 ? `${text.slice(0, 107)}...` : text;
  const summary = `Assistant summary: ${titleCase(category)} bet about "${shortText}".`;

  const hints = [];
  if (!signals.score && !signals.transaction && !signals.media) {
    hints.push("Outcome may be ambiguous without external proof.");
  }
  if (!signals.deadline) {
    hints.push("No explicit time boundary detected.");
  }
  if (words.length < 6) {
    hints.push("Description is very short. Judges and arbiters may not trust it.");
  }
  if (signals.subjective) {
    hints.push("This bet looks subjective. Arbitration risk is high.");
  }
  if (signals.media) {
    hints.push("Keep screenshots or links ready as evidence.");
  }
  if (signals.transaction) {
    hints.push("Transaction hash or wallet proof will likely be important.");
  }

  const evidence = [];
  if (signals.score) evidence.push("score/result");
  if (signals.media) evidence.push("screenshots/links");
  if (signals.transaction) evidence.push("tx hash/address proof");
  if (signals.deadline) evidence.push("timestamp");

  return {
    category,
    summary,
    hints,
    evidenceNeeded: evidence.length ? evidence.join(", ") : "clear written terms",
  };
}

export function classifyBetResolutionMode(description) {
  const analysis = analyzeBetDescription(description);
  const hintText = analysis.hints.join(" ").toLowerCase();
  const category = String(analysis.category || "").toLowerCase();

  const subjective =
    category === "subjective claim"
    || /subjective|ambiguous|very short/.test(hintText)
    || (!/measurable outcome|onchain action|evidence-based claim/.test(category) && /without external proof/.test(hintText));

  if (subjective) {
    return {
      mode: "human_first",
      reason: "Description looks subjective or ambiguous, so human arbiters should decide first.",
      analysis,
    };
  }

  return {
    mode: "ai_first",
    reason: "Description looks factual enough for AI evidence search first.",
    analysis,
  };
}
