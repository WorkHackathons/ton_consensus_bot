const MODES = new Set(["polling", "webhook"]);

export class ConfigurationError extends Error {
  constructor(messages) {
    super(messages.join("; "));
    this.name = "ConfigurationError";
    this.messages = messages;
  }
}

export function redactConfig(config) {
  return {
    network: config.network,
    telegramMode: config.telegramMode,
    telegramEnabled: config.telegramEnabled,
    port: config.port,
    host: config.host,
    hasTelegramToken: Boolean(config.telegramToken),
    hasMiniAppUrl: Boolean(config.miniAppUrl),
    hasDatabaseUrl: Boolean(config.databaseUrl),
    webhookPathConfigured: Boolean(config.webhookPath),
  };
}

export function parseConfig(env = process.env, { allowDisabled = false } = {}) {
  const errors = [];
  const telegramEnabled = env.TELEGRAM_DISABLED !== "1";
  const telegramMode = (env.TELEGRAM_MODE || "polling").toLowerCase();
  const network = (env.NETWORK || "").toLowerCase();
  const port = Number.parseInt(env.PORT || env.API_PORT || "3001", 10);
  const config = {
    host: "0.0.0.0", port, network, telegramMode, telegramEnabled,
    telegramToken: env.TELEGRAM_TOKEN || "", miniAppUrl: env.MINIAPP_URL || "",
    webhookBaseUrl: (env.WEBHOOK_BASE_URL || "").replace(/\/$/, ""),
    webhookPath: env.TELEGRAM_WEBHOOK_PATH || "/telegram/webhook",
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || "", databaseUrl: env.DATABASE_URL || "",
    version: env.APP_VERSION || "1.0.0", commit: env.RENDER_GIT_COMMIT || env.GIT_COMMIT || "unknown",
  };
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("PORT/API_PORT must be a valid TCP port");
  if (!network) errors.push("NETWORK is required");
  if (network !== "testnet" && network !== "mainnet") errors.push("NETWORK must be testnet or mainnet");
  if (network === "mainnet" && env.ALLOW_MAINNET_ACKNOWLEDGEMENT !== "I_UNDERSTAND_MAINNET_RISK") errors.push("NETWORK=mainnet is blocked without explicit acknowledgement");
  if (!MODES.has(telegramMode)) errors.push("TELEGRAM_MODE must be polling or webhook");
  if (telegramEnabled || !allowDisabled) {
    if (!config.telegramToken) errors.push("TELEGRAM_TOKEN is required");
    if (!config.miniAppUrl) errors.push("MINIAPP_URL is required");
  }
  if (telegramEnabled && telegramMode === "webhook") {
    if (!config.webhookBaseUrl || !/^https:\/\//i.test(config.webhookBaseUrl)) errors.push("WEBHOOK_BASE_URL must be an HTTPS URL in webhook mode");
    if (!config.webhookPath.startsWith("/")) errors.push("TELEGRAM_WEBHOOK_PATH must start with /");
    if (!config.webhookSecret) errors.push("TELEGRAM_WEBHOOK_SECRET is required in webhook mode");
  }
  if (errors.length) throw new ConfigurationError(errors);
  return config;
}
