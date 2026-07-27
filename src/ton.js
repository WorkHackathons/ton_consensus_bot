import fetch from "node-fetch";
import { mnemonicToPrivateKey } from "@ton/crypto";
import {
  Address,
  comment,
  internal,
  SendMode,
  toNano,
  TonClient,
  WalletContractV4,
  WalletContractV5R1,
} from "@ton/ton";
import { logger, redactWalletAddress } from "./logger.js";
import { getDatabase } from "./db/index.js";
import {
  AI_WINNER_GETS,
  ARBITER_FEE,
  PLATFORM_FEE,
  REFERRAL_FEE,
  WINNER_GETS,
} from "./states.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:3000";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const PLATFORM_WALLET = process.env.PLATFORM_FEE_WALLET;
const TON_WALLET_MODE = (process.env.TON_WALLET_MODE || "direct").toLowerCase();
const TONCENTER_API_BASE = process.env.NETWORK === "mainnet"
  ? "https://toncenter.com/api/v2"
  : "https://testnet.toncenter.com/api/v2";
const TONCENTER_RPC = `${TONCENTER_API_BASE}/jsonRPC`;

let mcpSessionId = null;
let mcpInitPromise = null;
let directWalletPromise = null;

function isTonRpcRateLimit(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|too many requests|rate limit|etimedout|timeout|econnreset|socket hang up|fetch failed/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTonRpcRetry(label, operation, options = {}) {
  const attempts = Number(options.attempts || 4);
  const baseDelayMs = Number(options.baseDelayMs || 1500);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTonRpcRateLimit(error) || attempt === attempts) {
        throw error;
      }

      const waitMs = baseDelayMs * attempt;
      logger.warn(`[TON RPC] ${label} rate-limited on attempt ${attempt}/${attempts}; retrying in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

function humanizeTonError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (/Failed to unpack account state/i.test(message) || /cannot apply external message/i.test(message)) {
    return "Платформенный кошелек еще не активирован в сети или на нем нет TON для оплаты газа.";
  }

  if (isTonRpcRateLimit(message)) {
    return "TON RPC временно ограничил запросы. Повторите попытку через 10-20 секунд или добавьте TONCENTER_API_KEY.";
  }

  return message;
}

function getToncenterApiKey() {
  return process.env.TONCENTER_API_KEY || undefined;
}

function preferDirectWallet() {
  return TON_WALLET_MODE !== "mcp";
}

function getNetworkGlobalId() {
  return process.env.NETWORK === "mainnet" ? -239 : -3;
}

function hasConfiguredMcp() {
  return Boolean(process.env.MCP_URL?.trim());
}

function getFriendlyAddress(address) {
  return address.toString({
    bounceable: true,
    testOnly: process.env.NETWORK !== "mainnet",
  });
}

function getDepositDisplayAddress(address) {
  return address.toString({
    bounceable: false,
    testOnly: process.env.NETWORK !== "mainnet",
  });
}

function normalizeTonAddress(address) {
  if (!address || typeof address !== "string") {
    return null;
  }

  try {
    return getFriendlyAddress(Address.parse(address.trim()));
  } catch {
    return address.trim();
  }
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseSseJson(text) {
  const payloads = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (payloads.length === 0) {
    return null;
  }

  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(payloads[i]);
    } catch {
    }
  }

  return null;
}

async function parseRpcResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let data = null;

  if (contentType.includes("application/json")) {
    data = text ? JSON.parse(text) : null;
  } else if (contentType.includes("text/event-stream")) {
    data = parseSseJson(text);
  } else {
    data = parseMaybeJson(text);
  }

  if (!response.ok) {
    const errorMessage = data?.error?.message || text || `MCP HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return data;
}

async function initializeMcpSession(force = false) {
  if (mcpSessionId && !force) {
    return mcpSessionId;
  }

  if (mcpInitPromise && !force) {
    return mcpInitPromise;
  }

  mcpInitPromise = (async () => {
    const response = await fetch(`${MCP_URL.replace(/\/$/, "")}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "ton-consensus",
            version: "1.0.0",
          },
        },
      }),
    });

    const data = await parseRpcResponse(response);
    if (data?.error) {
      throw new Error(data.error.message || "MCP initialize error");
    }

    const sessionId = response.headers.get("mcp-session-id");
    if (!sessionId) {
      throw new Error("MCP session id was not returned by server");
    }

    mcpSessionId = sessionId;

    try {
      await fetch(`${MCP_URL.replace(/\/$/, "")}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          "mcp-session-id": mcpSessionId,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });
    } catch {
    }

    return sessionId;
  })();

  try {
    return await mcpInitPromise;
  } finally {
    mcpInitPromise = null;
  }
}

async function callMcp(toolName, args = {}, retried = false) {
  await initializeMcpSession(retried);

  try {
    const response = await fetch(`${MCP_URL.replace(/\/$/, "")}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "mcp-session-id": mcpSessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    const data = await parseRpcResponse(response);
    if (data?.error) {
      throw new Error(data.error.message || "MCP error");
    }

    const raw = data?.result?.content?.[0]?.text;
    return typeof raw === "string" ? parseMaybeJson(raw) : data?.result ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sessionBroken = /session/i.test(message) || /not initialized/i.test(message);

    if (!retried && sessionBroken) {
      mcpSessionId = null;
      return callMcp(toolName, args, true);
    }

    throw error;
  }
}

async function mcpCall(toolName, args = {}) {
  return callMcp(toolName, args);
}

async function fetchToncenterJson(url, label) {
  return withTonRpcRetry(label, async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TonCenter HTTP ${response.status}`);
    }
    return response.json();
  });
}

async function buildDirectWalletContext() {
  const mnemonic = process.env.MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error("MNEMONIC is required for direct TON fallback");
  }

  const keyPair = await mnemonicToPrivateKey(mnemonic.split(/\s+/));
  const client = new TonClient({
    endpoint: TONCENTER_RPC,
    apiKey: getToncenterApiKey(),
  });

  const candidates = [];
  const requestedVersion = (process.env.WALLET_VERSION || "").toLowerCase();

  if (!requestedVersion || requestedVersion === "v5r1") {
    candidates.push({
      version: "v5r1",
      wallet: WalletContractV5R1.create({
        workchain: 0,
        publicKey: keyPair.publicKey,
        walletId: {
          networkGlobalId: getNetworkGlobalId(),
          context: {
            workchain: 0,
            walletVersion: "v5r1",
            subwalletNumber: 0,
          },
        },
      }),
    });
  }

  if (!requestedVersion || requestedVersion === "v4r2" || requestedVersion === "v4") {
    candidates.push({
      version: "v4r2",
      wallet: WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey }),
    });
  }

  let selected = null;

  for (const candidate of candidates) {
    try {
      const balance = await withTonRpcRetry(
        `buildDirectWalletContext:getBalance:${candidate.version}`,
        () => client.getBalance(candidate.wallet.address),
      );
      if (!selected || balance > selected.balance) {
        selected = { ...candidate, balance };
      }
      if (balance > 0n) {
        break;
      }
    } catch {
      if (!selected) {
        selected = { ...candidate, balance: 0n };
      }
    }
  }

  if (!selected) {
    throw new Error("Failed to derive wallet from mnemonic");
  }

  return {
    client,
    keyPair,
    wallet: selected.wallet,
    balance: selected.balance,
    version: selected.version,
    address: getFriendlyAddress(selected.wallet.address),
  };
}

async function getDirectWalletContext() {
  if (!directWalletPromise) {
    directWalletPromise = buildDirectWalletContext();
  }
  return directWalletPromise;
}

async function waitForSeqnoChange(openedWallet, initialSeqno) {
  const timeoutAt = Date.now() + 60_000;

  while (Date.now() < timeoutAt) {
    try {
      const currentSeqno = await withTonRpcRetry(
        "waitForSeqnoChange:getSeqno",
        () => openedWallet.getSeqno(),
        { attempts: 3, baseDelayMs: 1200 },
      );
      if (currentSeqno > initialSeqno) {
        return currentSeqno;
      }
    } catch (error) {
      if (!isTonRpcRateLimit(error)) {
        throw error;
      }
    }
    await sleep(2500);
  }

  throw new Error("Timed out waiting for transaction confirmation");
}

async function findLatestWalletTxHash(client, walletAddress) {
  const transactions = await withTonRpcRetry(
    "findLatestWalletTxHash:getTransactions",
    () => client.getTransactions(walletAddress, {
      limit: 5,
      archival: true,
    }),
  );

  const latest = transactions[0];
  return latest ? latest.hash().toString("hex") : null;
}

async function sendTransferWithRetry(openedWallet, secretKey, seqno, message) {
  const attempts = 3;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await openedWallet.sendTransfer({
        secretKey,
        seqno,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [message],
      });
      return;
    } catch (error) {
      if (!isTonRpcRateLimit(error) || attempt === attempts) {
        throw error;
      }

      logger.warn(`[TON RPC] sendDirectTon:sendTransfer rate-limited on attempt ${attempt}/${attempts}`);

      try {
        const currentSeqno = await withTonRpcRetry(
          "sendDirectTon:postErrorGetSeqno",
          () => openedWallet.getSeqno(),
          { attempts: 2, baseDelayMs: 1000 },
        );
        if (currentSeqno > seqno) {
          logger.info("[TON RPC] sendTransfer likely succeeded despite rate limit; seqno already advanced");
          return;
        }
      } catch (seqnoError) {
        if (!isTonRpcRateLimit(seqnoError)) {
          throw seqnoError;
        }
      }

      await sleep(1500 * attempt);
    }
  }
}

async function sendDirectTon({ to, amountTon, memo }) {
  const { client, keyPair, wallet } = await getDirectWalletContext();

  const walletBalance = await withTonRpcRetry(
    "sendDirectTon:getBalance",
    () => client.getBalance(wallet.address),
  );
  if (walletBalance <= 0n) {
    throw new Error("Платформенный кошелек пуст. Пополните его testnet TON перед выплатой.");
  }

  const openedWallet = client.open(wallet);
  const seqno = await withTonRpcRetry(
    "sendDirectTon:getSeqno",
    () => openedWallet.getSeqno(),
  );

  await sendTransferWithRetry(
    openedWallet,
    keyPair.secretKey,
    seqno,
    internal({
      to: Address.parse(to),
      value: toNano(String(amountTon)),
      body: memo ? comment(memo) : undefined,
    }),
  );

  await waitForSeqnoChange(openedWallet, seqno);
  return findLatestWalletTxHash(client, wallet.address);
}

function isSuccessfulToolResult(result) {
  if (!result || typeof result !== "object") {
    return false;
  }

  if (result.success === false || result.isError === true) {
    return false;
  }

  return true;
}

export function extractTxHash(result) {
  if (!result) {
    return null;
  }

  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }

  if (Array.isArray(result)) {
    for (const item of result) {
      const hash = extractTxHash(item);
      if (hash) {
        return hash;
      }
    }
  }

  if (typeof result === "object") {
    const direct = [
      result.normalizedHash,
      result.txHash,
      result.txhash,
      result.hash,
      result.transactionHash,
      result.details?.normalizedHash,
      result.result?.normalizedHash,
      result.result?.txHash,
      result.result?.txhash,
      result.result?.hash,
      result.data?.txHash,
      result.data?.txhash,
    ];

    for (const candidate of direct) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    for (const value of Object.values(result)) {
      const hash = extractTxHash(value);
      if (hash) {
        return hash;
      }
    }
  }

  return null;
}

async function sendTonViaBestMethod({ toAddress, amountTon, comment }) {
  if (preferDirectWallet()) {
    try {
      return await sendDirectTon({
        to: toAddress,
        amountTon: Number(Number(amountTon).toFixed(9)),
        memo: comment,
      });
    } catch (directError) {
      if (!hasConfiguredMcp()) {
        throw directError;
      }

      const result = await callMcp("send_ton", {
        toAddress,
        amount: Number(amountTon).toFixed(9),
        comment,
      });

      if (!isSuccessfulToolResult(result)) {
        throw new Error(typeof result === "string" ? result : result?.error || "MCP transfer failed");
      }

      return extractTxHash(result);
    }
  }

  try {
    const result = await callMcp("send_ton", {
      toAddress,
      amount: Number(amountTon).toFixed(9),
      comment,
    });

    if (!isSuccessfulToolResult(result)) {
      throw new Error(typeof result === "string" ? result : result?.error || "MCP transfer failed");
    }

    return extractTxHash(result);
  } catch {
    return sendDirectTon({
      to: toAddress,
      amountTon: Number(Number(amountTon).toFixed(9)),
      memo: comment,
    });
  }
}

export async function getWalletAddress() {
  if (preferDirectWallet()) {
    try {
      const direct = await getDirectWalletContext();
      return direct.address;
    } catch {
    }
  }

  if (!hasConfiguredMcp()) {
    const direct = await getDirectWalletContext();
    return getDepositDisplayAddress(direct.wallet.address);
  }

  try {
    const result = await callMcp("get_wallet", {});

    if (!isSuccessfulToolResult(result)) {
      throw new Error(typeof result === "string" ? result : result?.error || "MCP wallet lookup failed");
    }

    if (typeof result.address === "string" && result.address) {
      try {
        return getDepositDisplayAddress(Address.parse(result.address));
      } catch {
        return result.address;
      }
    }

    throw new Error("MCP wallet address not found");
  } catch (error) {
    const direct = await getDirectWalletContext();
    return getDepositDisplayAddress(direct.wallet.address);
  }
}

export async function verifyDeposit(fromAddress, expectedTon, sinceUnix) {
  logger.info(`Starting verifyDeposit for wallet: ${redactWalletAddress(fromAddress)}, amount: ${expectedTon}`);
  const walletAddress = await getWalletAddress();
  const url = new URL(`${TONCENTER_API_BASE}/getTransactions`);
  url.searchParams.set("address", walletAddress);
  url.searchParams.set("limit", "100");

  if (process.env.TONCENTER_API_KEY) {
    url.searchParams.set("api_key", process.env.TONCENTER_API_KEY);
  }

  const payload = await fetchToncenterJson(url, "verifyDeposit:getTransactions");
  const transactions = Array.isArray(payload?.result) ? payload.result : [];
  const expectedNano = Math.round(Number(expectedTon) * 1e9);
  const toleranceNano = Math.round(0.005 * 1e9);
  const requestUnix = Math.floor(Date.now() / 1000);
  // Allow for clock skew between Render, TonCenter indexing, and the chain itself.
  // Without a small buffer, deposits sent immediately after market creation can be skipped forever.
  const minUnix = Math.max(0, Number(sinceUnix || requestUnix) - 180);
  const normalizedFrom = normalizeTonAddress(fromAddress);
  const amountMatchedFrom = new Set();

  logger.info(
    `verifyDeposit scanning ${transactions.length} txs for deposit wallet: ${redactWalletAddress(walletAddress)}, sender: ${redactWalletAddress(normalizedFrom)}, minUnix: ${minUnix}`,
  );

  for (const tx of transactions) {
    const txUnix = Number(tx.utime ?? tx.now ?? 0);
    const incoming = tx.in_msg;

    if (!incoming || txUnix < minUnix) {
      continue;
    }

    const source = normalizeTonAddress(incoming.source || incoming.src || "");
    const valueNano = Number(incoming.value ?? 0);
    if (Math.abs(valueNano - expectedNano) > toleranceNano) {
      continue;
    }

    if (source && source !== normalizedFrom) {
      amountMatchedFrom.add(source);
      continue;
    }

    if (!source || source !== normalizedFrom) {
      continue;
    }

    logger.info(`verifyDeposit completed successfully: ${tx.transaction_id?.hash || tx.hash || "matched_without_hash"}`);
    return tx.transaction_id?.hash || tx.hash || null;
  }

  if (amountMatchedFrom.size > 0) {
    logger.warn(
      `verifyDeposit found matching amount from different sender(s): ${Array.from(amountMatchedFrom).join(", ")}`,
    );
  }
  logger.warn(`verifyDeposit failed to find matching transaction for wallet: ${redactWalletAddress(fromAddress)}, amount: ${expectedTon}`);
  return null;
}

export async function getAddressBalance(address) {
  const normalized = normalizeTonAddress(address);
  if (!normalized) {
    throw new Error("Wallet address is required");
  }

  const url = new URL(`${TONCENTER_API_BASE}/getAddressBalance`);
  url.searchParams.set("address", normalized);

  if (process.env.TONCENTER_API_KEY) {
    url.searchParams.set("api_key", process.env.TONCENTER_API_KEY);
  }

  const payload = await fetchToncenterJson(url, "getAddressBalance");
  const nano = Number(payload?.result ?? 0);
  return Number.isFinite(nano) ? nano / 1e9 : 0;
}

function preBroadcastSettlementError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.beforeBroadcast = true;
  return error;
}

function financialTransferError(error, { partialTransfer = false, transferKey = null } = {}) {
  const wrapped = new Error(humanizeTonError(error));
  for (const key of ["beforeBroadcast", "partialTransfer", "transferKey", "code"]) {
    if (error?.[key] !== undefined) wrapped[key] = error[key];
  }
  if (partialTransfer) wrapped.partialTransfer = true;
  if (transferKey && !wrapped.transferKey) wrapped.transferKey = transferKey;
  return wrapped;
}

async function getSettlementReceiptContext(betId) {
  const normalizedBetId = Number(betId);
  if (!Number.isInteger(normalizedBetId) || normalizedBetId <= 0) {
    throw preBroadcastSettlementError("SETTLEMENT_RECEIPT_CONTEXT_REQUIRED", "Settlement transfers require a claimed bet id");
  }

  const database = getDatabase();
  const bet = await database.bets.getById(normalizedBetId);
  if (!bet || bet.status !== "settling" || !bet.settlement_kind) {
    throw preBroadcastSettlementError("SETTLEMENT_RECEIPT_NOT_CLAIMED", "Settlement transfers require a claimed settlement");
  }
  return { database, bet };
}

async function recordSettlementTransfer(context, { transferKey, recipientRole, amountTon, txHash }) {
  const normalizedHash = typeof txHash === "string" ? txHash.trim() : "";
  if (!normalizedHash) {
    const error = new Error("Successful transfer did not return a transaction hash");
    error.code = "TRANSFER_HASH_MISSING";
    error.transferKey = transferKey;
    throw error;
  }
  await context.database.settlements.recordTransferReceipt(context.bet.id, {
    settlementKind: context.bet.settlement_kind,
    transferKey,
    recipientRole,
    amountTon,
    txHash: normalizedHash,
  });
}

export async function payout({ winnerAddress, potTon, oracleUsed, arbiterAddresses, betId = null, transferFn = sendTonViaBestMethod }) {
  logger.info(`Starting payout for bet_id: ${betId ?? "unknown"}`);
  let successfulTransfer = false;
  let transferKey = "winner";
  try {
    const totalPot = Number(potTon);
    const winnerRatio = oracleUsed ? WINNER_GETS : AI_WINNER_GETS;
    const winnerAmount = Number((totalPot * winnerRatio).toFixed(9));
    const platformBaseAmount = Number((totalPot * PLATFORM_FEE).toFixed(9));
    const context = await getSettlementReceiptContext(betId);
    const { database, bet } = context;
    const referrer = await database.referrals.get(bet.creator_id) || await database.referrals.get(bet.opponent_id);
    const referralAmount = referrer ? Number((platformBaseAmount * REFERRAL_FEE).toFixed(9)) : 0;
    const platformAmount = Number(Math.max(platformBaseAmount - referralAmount, 0).toFixed(9));
    const arbiterPool = oracleUsed ? Number((totalPot * ARBITER_FEE).toFixed(9)) : 0;
    const winnerComment = oracleUsed ? "TON Consensus payout with oracle" : "TON Consensus payout";

    const winnerTxHash = await transferFn({
      toAddress: winnerAddress,
      amountTon: winnerAmount,
      comment: winnerComment,
    });
    successfulTransfer = true;
    await recordSettlementTransfer(context, {
      transferKey,
      recipientRole: "winner",
      amountTon: winnerAmount,
      txHash: winnerTxHash,
    });

    let platformTxHash = null;
    if (PLATFORM_WALLET && platformAmount > 0.005) {
      transferKey = "platform_fee";
      platformTxHash = await transferFn({
        toAddress: PLATFORM_WALLET,
        amountTon: platformAmount,
        comment: "TON Consensus platform fee",
      });
      successfulTransfer = true;
      await recordSettlementTransfer(context, {
        transferKey,
        recipientRole: "platform",
        amountTon: platformAmount,
        txHash: platformTxHash,
      });
    }

    let referralTxHash = null;
    if (referrer && referralAmount > 0.005) {
      const referrerAddress = await database.users.getTonAddress(referrer);
      if (referrerAddress) {
        transferKey = `referral:${referrer}`;
        referralTxHash = await transferFn({
          toAddress: referrerAddress,
          amountTon: referralAmount,
          comment: "TON Consensus referral reward",
        });
        successfulTransfer = true;
        await recordSettlementTransfer(context, {
          transferKey,
          recipientRole: "referrer",
          amountTon: referralAmount,
          txHash: referralTxHash,
        });
        await database.referrals.incrementEarnings(referrer, referralAmount);
      }
    }

    const arbiterTxHashes = [];

    if (oracleUsed && arbiterPool > 0) {
      const validArbiters = (arbiterAddresses || []).filter(Boolean);
      if (validArbiters.length > 0) {
        const share = Number((arbiterPool / validArbiters.length).toFixed(9));
        for (const [index, address] of validArbiters.entries()) {
          transferKey = `arbiter:${index}`;
          const arbiterTxHash = await transferFn({
            toAddress: address,
            amountTon: share,
            comment: "TON Consensus arbiter reward",
          });
          successfulTransfer = true;
          await recordSettlementTransfer(context, {
            transferKey,
            recipientRole: "arbiter",
            amountTon: share,
            txHash: arbiterTxHash,
          });
          arbiterTxHashes.push(arbiterTxHash);
        }
      }
    }

    const result = {
      winnerTxHash,
      platformTxHash,
      referralTxHash,
      arbiterTxHashes,
      winnerAmount,
      platformAmount,
      referralAmount,
      arbiterAmount: arbiterPool,
    };
    logger.info(`payout completed successfully: ${winnerTxHash}`);
    return result;
  } catch (error) {
    const settlementError = financialTransferError(error, { partialTransfer: successfulTransfer, transferKey });
    logger.error(`payout failed for bet_id: ${betId ?? "unknown"}, reason: ${settlementError.message}`);
    throw settlementError;
  }
}

async function verifyTxOnChain(txHash) {
  if (!txHash || txHash === "pending" || txHash === "unknown") {
    return false;
  }

  try {
    const url = new URL(`${TONCENTER_API_BASE}/getTransactions`);
    url.searchParams.set("address", await getWalletAddress());
    url.searchParams.set("limit", "10");

    if (process.env.TONCENTER_API_KEY) {
      url.searchParams.set("api_key", process.env.TONCENTER_API_KEY);
    }

    const data = await fetchToncenterJson(url, "verifyTxOnChain:getTransactions");
    if (!data?.ok) {
      return false;
    }

    return (data.result || []).some(
      (tx) => tx?.transaction_id?.hash === txHash || tx?.hash === txHash,
    );
  } catch {
    return false;
  }
}

export async function executePayout(betId, winnerAddress, potTon, { transferFn = sendTonViaBestMethod } = {}) {
  logger.info(`[PAYOUT] Bet #${betId} | Pot: ${potTon} TON | Winner: ${redactWalletAddress(winnerAddress)}`);

  let successfulTransfer = false;
  let transferKey = "winner";
  let winnerTx = null;
  let feeTx = null;
  let referralTx = null;
  let winnerAmount;
  let feeAmount;
  let referralAmount;
  try {
    const totalPot = Number(potTon);
    winnerAmount = Number((totalPot * AI_WINNER_GETS).toFixed(9));
    const feeBaseAmount = Number((totalPot * PLATFORM_FEE).toFixed(9));
    const context = await getSettlementReceiptContext(betId);
    const { database, bet } = context;
    const referrer = await database.referrals.get(bet.creator_id) || await database.referrals.get(bet.opponent_id);
    referralAmount = referrer ? Number((feeBaseAmount * REFERRAL_FEE).toFixed(9)) : 0;
    feeAmount = Number(Math.max(feeBaseAmount - referralAmount, 0).toFixed(9));

    winnerTx = await transferFn({
      toAddress: winnerAddress,
      amountTon: winnerAmount,
      comment: `TON Consensus payout #${betId}`,
    });
    successfulTransfer = true;
    await recordSettlementTransfer(context, {
      transferKey,
      recipientRole: "winner",
      amountTon: winnerAmount,
      txHash: winnerTx,
    });
    logger.info(`[PAYOUT] Winner TX: ${winnerTx}`);

    if (PLATFORM_WALLET && feeAmount > 0.005) {
      transferKey = "platform_fee";
      feeTx = await transferFn({
        toAddress: PLATFORM_WALLET,
        amountTon: feeAmount,
        comment: `TON Consensus fee #${betId}`,
      });
      successfulTransfer = true;
      await recordSettlementTransfer(context, {
        transferKey,
        recipientRole: "platform",
        amountTon: feeAmount,
        txHash: feeTx,
      });
      logger.info(`[PAYOUT] Fee sent: ${feeAmount} TON`);
    }

    if (referrer) {
      const referrerAddress = await database.users.getTonAddress(referrer);
      if (referrerAddress && referralAmount > 0.005) {
        transferKey = `referral:${referrer}`;
        referralTx = await transferFn({
          toAddress: referrerAddress,
          amountTon: referralAmount,
          comment: "TON Consensus referral reward",
        });
        successfulTransfer = true;
        await recordSettlementTransfer(context, {
          transferKey,
          recipientRole: "referrer",
          amountTon: referralAmount,
          txHash: referralTx,
        });
        try {
          await database.referrals.incrementEarnings(referrer, referralAmount);
        } catch (error) {
          logger.warn(`[REFERRAL] Accounting failed: ${error?.name || "Error"}`);
        }
        logger.info(`[REFERRAL] Paid ${referralAmount} TON to referrer ${referrer}`);
      }
    }
  } catch (error) {
    const settlementError = financialTransferError(error, { partialTransfer: successfulTransfer, transferKey });
    logger.error(`[PAYOUT] Transfer failed: ${settlementError.message}`);
    throw settlementError;
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
  const confirmed = await verifyTxOnChain(winnerTx);
  logger.info(`[PAYOUT] TX confirmed: ${confirmed} | Hash: ${winnerTx}`);

  return {
    txHash: winnerTx,
    winnerAmount,
    feeAmount,
    feeTx,
    referralAmount,
    referralTx,
    confirmed,
  };
}

export async function refundBoth(address1, address2, amountTon, {
  betId = null,
  recipientRoles = ["creator", "opponent"],
  transferFn = sendTonViaBestMethod,
} = {}) {
  let successfulTransfer = false;
  let transferKey = "refund:creator";
  try {
    const context = await getSettlementReceiptContext(betId);
    const results = [];

    for (const [index, address] of [address1, address2].entries()) {
      const recipientRole = recipientRoles[index] || `participant_${index + 1}`;
      transferKey = `refund:${recipientRole}`;
      const txHash = await transferFn({
        toAddress: address,
        amountTon: Number(Number(amountTon).toFixed(9)),
        comment: "TON Consensus refund",
      });
      successfulTransfer = true;
      await recordSettlementTransfer(context, {
        transferKey,
        recipientRole,
        amountTon,
        txHash,
      });
      results.push(txHash);
    }

    return results;
  } catch (error) {
    throw financialTransferError(error, { partialTransfer: successfulTransfer, transferKey });
  }
}

export async function refundSingle(address, amountTon, {
  betId = null,
  recipientRole = "creator",
  transferFn = sendTonViaBestMethod,
} = {}) {
  const transferKey = `refund:${recipientRole}`;
  let successfulTransfer = false;
  try {
    const context = await getSettlementReceiptContext(betId);
    const txHash = await transferFn({
      toAddress: address,
      amountTon: Number(Number(amountTon).toFixed(9)),
      comment: "TON Consensus refund",
    });
    successfulTransfer = true;
    await recordSettlementTransfer(context, {
      transferKey,
      recipientRole,
      amountTon,
      txHash,
    });
    return txHash;
  } catch (error) {
    throw financialTransferError(error, { partialTransfer: successfulTransfer, transferKey });
  }
}

export async function checkMcpHealth() {
  try {
    const address = await getWalletAddress();
    console.log(`TON wallet: ${redactWalletAddress(address)}`);
    return true;
  } catch (error) {
    console.error("MCP health check failed:", humanizeTonError(error));
    return false;
  }
}
