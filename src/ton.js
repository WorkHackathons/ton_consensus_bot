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
import { logger } from "./logger.js";
import { getBet, getReferrer, getTonAddress, incrementReferralEarnings } from "./db.js";
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
const TONCENTER_API_BASE = process.env.NETWORK === "mainnet"
  ? "https://toncenter.com/api/v2"
  : "https://testnet.toncenter.com/api/v2";
const TONCENTER_RPC = `${TONCENTER_API_BASE}/jsonRPC`;

let mcpSessionId = null;
let mcpInitPromise = null;
let directWalletPromise = null;

function humanizeTonError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (/Failed to unpack account state/i.test(message) || /cannot apply external message/i.test(message)) {
    return "Платформенный кошелек еще не активирован в сети или на нем нет TON для оплаты газа.";
  }

  if (/429/.test(message)) {
    return "TON RPC временно ограничил запросы. Повторите попытку через 10-20 секунд или добавьте TONCENTER_API_KEY.";
  }

  return message;
}

function getToncenterApiKey() {
  return process.env.TONCENTER_API_KEY || undefined;
}

function getFriendlyAddress(address) {
  return address.toString({
    bounceable: true,
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
      wallet: WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey }),
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
      const balance = await client.getBalance(candidate.wallet.address);
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
    const currentSeqno = await openedWallet.getSeqno();
    if (currentSeqno > initialSeqno) {
      return currentSeqno;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  throw new Error("Timed out waiting for transaction confirmation");
}

async function findLatestWalletTxHash(client, walletAddress) {
  const transactions = await client.getTransactions(walletAddress, {
    limit: 5,
    archival: true,
  });

  const latest = transactions[0];
  return latest ? latest.hash().toString("hex") : null;
}

async function sendDirectTon({ to, amountTon, memo }) {
  const { client, keyPair, wallet } = await getDirectWalletContext();

  if ((await client.getBalance(wallet.address)) <= 0n) {
    throw new Error("Платформенный кошелек пуст. Пополните его testnet TON перед выплатой.");
  }

  const openedWallet = client.open(wallet);
  const seqno = await openedWallet.getSeqno();

  await openedWallet.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [
      internal({
        to: Address.parse(to),
        value: toNano(String(amountTon)),
        body: memo ? comment(memo) : undefined,
      }),
    ],
  });

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
  try {
    const result = await callMcp("get_wallet", {});

    if (!isSuccessfulToolResult(result)) {
      throw new Error(typeof result === "string" ? result : result?.error || "MCP wallet lookup failed");
    }

    if (typeof result.address === "string" && result.address) {
      if (process.env.NETWORK === "testnet" && result.address.startsWith("UQ")) {
        return "0QAZli6nZl1hyfdJbZSdC0cszqU5mFsZbaeQPsS0dNpXsWPL";
      }
      return result.address;
    }

    throw new Error("MCP wallet address not found");
  } catch (error) {
    const direct = await getDirectWalletContext();
    return direct.address;
  }
}

export async function verifyDeposit(fromAddress, expectedTon, sinceUnix) {
  const walletAddress = await getWalletAddress();
  const url = new URL(`${TONCENTER_API_BASE}/getTransactions`);
  url.searchParams.set("address", walletAddress);
  url.searchParams.set("limit", "30");

  if (process.env.TONCENTER_API_KEY) {
    url.searchParams.set("api_key", process.env.TONCENTER_API_KEY);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TonCenter HTTP ${response.status}`);
  }

  const payload = await response.json();
  const transactions = Array.isArray(payload?.result) ? payload.result : [];
  const expectedNano = Math.round(Number(expectedTon) * 1e9);
  const toleranceNano = Math.round(0.005 * 1e9);
  const minUnix = Math.max(Number(sinceUnix || 0), Math.floor(Date.now() / 1000) - 600);
  const normalizedFrom = normalizeTonAddress(fromAddress);

  for (const tx of transactions) {
    const txUnix = Number(tx.utime ?? tx.now ?? 0);
    const incoming = tx.in_msg;

    if (!incoming || txUnix < minUnix) {
      continue;
    }

    const source = normalizeTonAddress(incoming.source || incoming.src || "");
    if (!source || source !== normalizedFrom) {
      continue;
    }

    const valueNano = Number(incoming.value ?? 0);
    if (Math.abs(valueNano - expectedNano) > toleranceNano) {
      continue;
    }

    return tx.transaction_id?.hash || tx.hash || null;
  }

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

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TonCenter HTTP ${response.status}`);
  }

  const payload = await response.json();
  const nano = Number(payload?.result ?? 0);
  return Number.isFinite(nano) ? nano / 1e9 : 0;
}

export async function payout({ winnerAddress, potTon, oracleUsed, arbiterAddresses, betId = null }) {
  try {
    const totalPot = Number(potTon);
    const winnerRatio = oracleUsed ? WINNER_GETS : AI_WINNER_GETS;
    const winnerAmount = Number((totalPot * winnerRatio).toFixed(9));
    const platformBaseAmount = Number((totalPot * PLATFORM_FEE).toFixed(9));
    const bet = betId ? getBet(betId) : null;
    const referrer = bet ? (getReferrer(bet.creator_id) || getReferrer(bet.opponent_id)) : null;
    const referralAmount = referrer ? Number((platformBaseAmount * REFERRAL_FEE).toFixed(9)) : 0;
    const platformAmount = Number(Math.max(platformBaseAmount - referralAmount, 0).toFixed(9));
    const arbiterPool = oracleUsed ? Number((totalPot * ARBITER_FEE).toFixed(9)) : 0;
    const winnerComment = oracleUsed ? "TON Consensus payout with oracle" : "TON Consensus payout";

    const winnerTxHash = await sendTonViaBestMethod({
      toAddress: winnerAddress,
      amountTon: winnerAmount,
      comment: winnerComment,
    });

    let platformTxHash = null;
    if (PLATFORM_WALLET && platformAmount > 0.005) {
      platformTxHash = await sendTonViaBestMethod({
        toAddress: PLATFORM_WALLET,
        amountTon: platformAmount,
        comment: "TON Consensus platform fee",
      });
    }

    let referralTxHash = null;
    if (referrer && referralAmount > 0.005) {
      const referrerAddress = getTonAddress(referrer);
      if (referrerAddress) {
        referralTxHash = await sendTonViaBestMethod({
          toAddress: referrerAddress,
          amountTon: referralAmount,
          comment: "TON Consensus referral reward",
        });
        incrementReferralEarnings(referrer, referralAmount);
      }
    }

    const arbiterTxHashes = [];

    if (oracleUsed && arbiterPool > 0) {
      const validArbiters = (arbiterAddresses || []).filter(Boolean);
      if (validArbiters.length > 0) {
        const share = Number((arbiterPool / validArbiters.length).toFixed(9));
        for (const address of validArbiters) {
          arbiterTxHashes.push(await sendTonViaBestMethod({
            toAddress: address,
            amountTon: share,
            comment: "TON Consensus arbiter reward",
          }));
        }
      }
    }

    return {
      winnerTxHash,
      platformTxHash,
      referralTxHash,
      arbiterTxHashes,
      winnerAmount,
      platformAmount,
      referralAmount,
      arbiterAmount: arbiterPool,
    };
  } catch (error) {
    throw new Error(humanizeTonError(error));
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

    const response = await fetch(url);
    const data = await response.json();
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

export async function executePayout(betId, winnerAddress, potTon) {
  logger.info(`[PAYOUT] Bet #${betId} | Pot: ${potTon} TON | Winner: ${winnerAddress}`);

  const totalPot = Number(potTon);
  const winnerAmount = Number((totalPot * AI_WINNER_GETS).toFixed(9));
  const feeBaseAmount = Number((totalPot * PLATFORM_FEE).toFixed(9));
  const bet = getBet(betId);
  const referrer = bet ? (getReferrer(bet.creator_id) || getReferrer(bet.opponent_id)) : null;
  let referralTx = null;
  let referralAmount = referrer ? Number((feeBaseAmount * REFERRAL_FEE).toFixed(9)) : 0;
  const feeAmount = Number(Math.max(feeBaseAmount - referralAmount, 0).toFixed(9));

  let winnerTx = null;
  try {
    winnerTx = await sendTonViaBestMethod({
      toAddress: winnerAddress,
      amountTon: winnerAmount,
      comment: `TON Consensus payout #${betId}`,
    });
    logger.info(`[PAYOUT] Winner TX: ${winnerTx}`);
  } catch (error) {
    logger.error(`[PAYOUT] Winner transfer FAILED: ${error.message}`);
    return null;
  }

  let feeTx = null;
  if (PLATFORM_WALLET && feeAmount > 0.005) {
    try {
      feeTx = await sendTonViaBestMethod({
        toAddress: PLATFORM_WALLET,
        amountTon: feeAmount,
        comment: `TON Consensus fee #${betId}`,
      });
      logger.info(`[PAYOUT] Fee sent: ${feeAmount} TON`);
    } catch (error) {
      logger.warn(`[PAYOUT] Fee transfer failed (non-critical): ${error.message}`);
    }
  }

  if (referrer) {
    const referrerAddress = getTonAddress(referrer);
    if (referrerAddress && referralAmount > 0.005) {
      try {
        referralTx = await sendTonViaBestMethod({
          toAddress: referrerAddress,
          amountTon: referralAmount,
          comment: "TON Consensus referral reward",
        });
        incrementReferralEarnings(referrer, referralAmount);
        logger.info(`[REFERRAL] Paid ${referralAmount} TON to referrer ${referrer}`);
      } catch (error) {
        logger.error(`[REFERRAL] Payout failed: ${error.message}`);
      }
    }
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

export async function refundBoth(address1, address2, amountTon) {
  try {
    const results = [];

    for (const address of [address1, address2]) {
      try {
        const result = await callMcp("send_ton", {
          toAddress: address,
          amount: Number(Number(amountTon).toFixed(9)).toString(),
          comment: "TON Consensus refund",
        });

        if (!isSuccessfulToolResult(result)) {
          throw new Error("MCP refund failed");
        }

        results.push(extractTxHash(result));
      } catch {
        results.push(await sendDirectTon({
          to: address,
          amountTon: Number(Number(amountTon).toFixed(9)),
          memo: "TON Consensus refund",
        }));
      }
    }

    return results;
  } catch (error) {
    throw new Error(humanizeTonError(error));
  }
}

export async function refundSingle(address, amountTon) {
  try {
    try {
      const result = await callMcp("send_ton", {
        toAddress: address,
        amount: Number(Number(amountTon).toFixed(9)).toString(),
        comment: "TON Consensus refund",
      });

      if (!isSuccessfulToolResult(result)) {
        throw new Error("MCP refund failed");
      }

      return extractTxHash(result);
    } catch {
      return await sendDirectTon({
        to: address,
        amountTon: Number(Number(amountTon).toFixed(9)),
        memo: "TON Consensus refund",
      });
    }
  } catch (error) {
    throw new Error(humanizeTonError(error));
  }
}

export async function checkMcpHealth() {
  try {
    const address = await getWalletAddress();
    console.log(`TON wallet: ${address}`);
    return true;
  } catch (error) {
    console.error("MCP health check failed:", humanizeTonError(error));
    return false;
  }
}
