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
import { PLATFORM_FEE } from "./states.js";

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
  const minUnix = Number(sinceUnix) - 60;

  for (const tx of transactions) {
    const txUnix = Number(tx.utime ?? tx.now ?? 0);
    const incoming = tx.in_msg;

    if (!incoming || txUnix < minUnix) {
      continue;
    }

    const source = incoming.source || incoming.src || "";
    if (source !== fromAddress) {
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

export async function payout({ winnerAddress, potTon, oracleUsed, arbiterAddresses }) {
  try {
    const totalPot = Number(potTon);
    const feeTon = totalPot * PLATFORM_FEE;
    const winnerAmount = Number((totalPot * (1 - PLATFORM_FEE)).toFixed(9));
    const winnerComment = oracleUsed ? "TON Consensus payout with oracle" : "TON Consensus payout";

    let winnerTxHash = null;

    try {
      const winnerResult = await callMcp("send_ton", {
        toAddress: winnerAddress,
        amount: winnerAmount.toString(),
        comment: winnerComment,
      });

      if (!isSuccessfulToolResult(winnerResult)) {
        throw new Error(typeof winnerResult === "string" ? winnerResult : winnerResult?.error || "MCP payout failed");
      }

      winnerTxHash = extractTxHash(winnerResult);
    } catch {
      winnerTxHash = await sendDirectTon({
        to: winnerAddress,
        amountTon: winnerAmount,
        memo: winnerComment,
      });
    }

    const arbiterTxHashes = [];

    if (oracleUsed) {
      const validArbiters = (arbiterAddresses || []).filter(Boolean);
      if (validArbiters.length > 0 && feeTon > 0) {
        const share = Number((feeTon / validArbiters.length).toFixed(9));
        for (const address of validArbiters) {
          try {
            const result = await callMcp("send_ton", {
              toAddress: address,
              amount: share.toString(),
              comment: "TON Consensus oracle fee",
            });

            if (!isSuccessfulToolResult(result)) {
              throw new Error("MCP oracle fee payout failed");
            }

            arbiterTxHashes.push(extractTxHash(result));
          } catch {
            arbiterTxHashes.push(await sendDirectTon({
              to: address,
              amountTon: share,
              memo: "TON Consensus oracle fee",
            }));
          }
        }
      }
    }

    return {
      winnerTxHash,
      arbiterTxHashes,
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

  const winnerAmount = Number((Number(potTon) * 0.9).toFixed(9));
  const feeAmount = Number((Number(potTon) * 0.1).toFixed(9));

  let winnerTx = null;
  try {
    const result = await mcpCall("send_ton", {
      toAddress: winnerAddress,
      amount: winnerAmount.toString(),
      comment: `TON Consensus payout #${betId}`,
    });
    winnerTx = extractTxHash(result);
    logger.info(`[PAYOUT] Winner TX: ${winnerTx}`);
  } catch (error) {
    logger.error(`[PAYOUT] Winner transfer FAILED: ${error.message}`);
    return null;
  }

  if (PLATFORM_WALLET && feeAmount > 0.005) {
    try {
      await mcpCall("send_ton", {
        toAddress: PLATFORM_WALLET,
        amount: feeAmount.toString(),
        comment: `TON Consensus fee #${betId}`,
      });
      logger.info(`[PAYOUT] Fee sent: ${feeAmount} TON`);
    } catch (error) {
      logger.warn(`[PAYOUT] Fee transfer failed (non-critical): ${error.message}`);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
  const confirmed = await verifyTxOnChain(winnerTx);
  logger.info(`[PAYOUT] TX confirmed: ${confirmed} | Hash: ${winnerTx}`);

  return {
    txHash: winnerTx,
    winnerAmount,
    feeAmount,
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
