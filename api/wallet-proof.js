const EXPLORER_BASE = "https://explorer.ritualfoundation.org";
const RPC_URL = "https://rpc.ritualfoundation.org";
// Optional transport overrides keep public explorer links canonical while
// allowing restricted local environments to route reads through a local bridge.
const EXPLORER_API_BASE = process.env.RITUAL_EXPLORER_API_BASE || EXPLORER_BASE;
const RPC_TRANSPORT_URL = process.env.RITUAL_RPC_TRANSPORT_URL || RPC_URL;
const AGENT_HEARTBEAT_ADDRESS = "0xef505e801f1db392b5289690e2ffc20e840a3aca";
const SOVEREIGN_AGENT_FACTORY = "0x9dc4c054e53bcc4ce0a0ff09e890a7a8e817f304";
const DEPLOY_SOVEREIGN_HARNESS_SELECTOR = "0x3293993b";
const CONFIGURE_SOVEREIGN_HARNESS_SELECTOR = "0xb1906702";
const OWNER_SELECTOR = "0x8da5cb5b";
const AGENT_SELECTORS = {
  count: "0xb7dc1284",
  byIndex: "0x2f80c54f",
  info: "0x152052b0"
};
const AGENT_REGISTERED_TOPIC = "0x6bd2ccd1aee53ca4e8719e5ce088ba80c1283b11a2c6c5469f159119891db5e6";
const MAX_AGENT_REGISTRY_SCAN = 512;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function formatEtherLike(hexWei) {
  try {
    const wei = BigInt(hexWei || 0);
    const whole = wei / 10n ** 18n;
    const fraction = String((wei % 10n ** 18n) / 10n ** 12n).padStart(6, "0");
    return `${whole}.${fraction}`.replace(/\.?0+$/, "");
  } catch {
    return "0";
  }
}

async function rpc(method, params) {
  const response = await externalFetch(RPC_TRANSPORT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  if (!response.ok) throw new Error(`RPC ${method} failed`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || `RPC ${method} failed`);
  return payload.result;
}

async function rpcBatch(calls) {
  const response = await externalFetch(RPC_TRANSPORT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(calls)
  });
  if (!response.ok) throw new Error("Ritual RPC batch failed");
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("Ritual RPC returned an invalid batch response");
  const byId = new Map(payload.map((item) => [item.id, item]));
  return calls.map((call) => {
    const item = byId.get(call.id);
    return item && !item.error ? item.result : null;
  });
}

async function fetchJson(url) {
  const response = await externalFetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `Explorer request failed: ${response.status}`);
  }
  return response.json();
}

async function fetchTransactions(address, from, to) {
  const base = `${EXPLORER_API_BASE}/api/indexer-proxy/api/v1/addresses/${address}/transactions`;
  const windows = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    const windowEnd = new Date(cursor);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 6);
    if (windowEnd > to) windowEnd.setTime(to.getTime());
    windows.push({ from: new Date(cursor), to: new Date(windowEnd) });
    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const requests = windows.map((window) => {
    const url = `${base}?limit=50&offset=0&from_date=${toDateInput(window.from)}&to_date=${toDateInput(window.to)}`;
    return fetchJson(url).then((payload) => ({ payload, url }));
  });
  const settled = await Promise.allSettled(requests);
  const successful = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  if (!successful.length) {
    const failure = settled.find((result) => result.status === "rejected");
    throw failure?.reason || new Error("Ritual explorer transaction windows failed");
  }

  const byHash = new Map();
  for (const result of successful) {
    for (const transaction of Array.isArray(result.payload?.transactions) ? result.payload.transactions : []) {
      const hash = String(transaction?.tx_hash || "").toLowerCase();
      if (hash && !byHash.has(hash)) byHash.set(hash, transaction);
    }
  }
  const transactions = [...byHash.values()].sort((left, right) => Number(right?.block_number || 0) - Number(left?.block_number || 0));
  return {
    payload: { transactions, count: transactions.length },
    url: `${base}?from_date=${toDateInput(from)}&to_date=${toDateInput(to)}&window_days=7`
  };
}

function padWord(value) {
  return String(value || "").replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function wordAddress(word) {
  return `0x${word.slice(-40).toLowerCase()}`;
}

function wordNumber(word) {
  try {
    const value = BigInt(`0x${word}`);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : 0;
  } catch {
    return 0;
  }
}

function decodeDynamicString(payload, offsetWord) {
  const offset = wordNumber(offsetWord) * 2;
  if (!offset || offset + 64 > payload.length) return "";
  const byteLength = wordNumber(payload.slice(offset, offset + 64));
  const start = offset + 64;
  const end = start + byteLength * 2;
  if (!byteLength || end > payload.length) return "";
  try {
    const bytes = new Uint8Array(byteLength);
    for (let index = 0; index < byteLength; index += 1) bytes[index] = Number.parseInt(payload.slice(start + index * 2, start + index * 2 + 2), 16);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function decodeAgentInfo(result) {
  const raw = String(result || "").replace(/^0x/, "");
  if (raw.length < 64) return null;
  const offset = wordNumber(raw.slice(0, 64)) * 2;
  if (!offset || offset + 64 * 8 > raw.length) return null;
  const payload = raw.slice(offset);
  const word = (index) => payload.slice(index * 64, (index + 1) * 64);
  const owner = wordAddress(word(0));
  const address = wordAddress(word(1));
  if (address === ZERO_ADDRESS) return null;
  const state = ["MONITORED", "FAILED", "REVIVING"][wordNumber(word(7))] || "MONITORED";
  return {
    address,
    owner,
    source: "heartbeat-registry",
    state,
    isAlive: state === "MONITORED",
    lastHeartbeatBlock: wordNumber(word(3)),
    latestManifestCID: decodeDynamicString(payload, word(6))
  };
}

function cacheAgentsForWallet(agentCache, normalized) {
  return (Array.isArray(agentCache?.persistent) ? agentCache.persistent : [])
    .map((agent) => {
      const info = agent?.info || {};
      return {
        address: String(info.agentAddress || agent?.address || "").toLowerCase(),
        owner: String(info.owner || "").toLowerCase(),
        source: "explorer-cache",
        state: String(info.state || "MONITORED"),
        isAlive: Boolean(info.isAlive),
        lastHeartbeatBlock: Number(info.lastHeartbeatBlock || 0),
        latestManifestCID: String(info.latestManifestCID || "")
      };
    })
    .filter((agent) => agent.owner === normalized || agent.address === normalized);
}

async function sovereignCacheAgentsForWallet(agentCache, normalized) {
  const sovereign = (Array.isArray(agentCache?.sovereign) ? agentCache.sovereign : [])
    .filter((agent) => isAddress(agent?.address));
  if (!sovereign.length) return [];

  const owners = await rpcBatch(sovereign.map((agent, index) => ({
    jsonrpc: "2.0",
    id: `sovereign-cache-owner-${index}`,
    method: "eth_call",
    params: [{ to: agent.address, data: OWNER_SELECTOR }, "latest"]
  })));
  return sovereign.flatMap((agent, index) => {
    const rawOwner = String(owners[index] || "").replace(/^0x/, "");
    const owner = /^[0-9a-fA-F]{64}$/.test(rawOwner) ? wordAddress(rawOwner) : ZERO_ADDRESS;
    const address = String(agent.address).toLowerCase();
    if (owner !== normalized && address !== normalized) return [];
    return [{
      address,
      owner,
      source: "explorer-sovereign-cache",
      state: "MONITORED",
      isAlive: true,
      lastHeartbeatBlock: Number(agent.lastActivityBlock || 0),
      latestManifestCID: ""
    }];
  });
}

function uniqueAgents(agents) {
  return [...new Map(agents.map((agent) => [agent.address, agent])).values()];
}

async function registeredAgentsForWallet(normalized) {
  const count = Math.min(wordNumber(String(await rpc("eth_call", [{ to: AGENT_HEARTBEAT_ADDRESS, data: AGENT_SELECTORS.count }, "latest"])).replace(/^0x/, "")), MAX_AGENT_REGISTRY_SCAN);
  if (!count) return [];

  const addresses = await rpcBatch(Array.from({ length: count }, (_, index) => ({
    jsonrpc: "2.0",
    id: `agent-address-${index}`,
    method: "eth_call",
    params: [{ to: AGENT_HEARTBEAT_ADDRESS, data: `${AGENT_SELECTORS.byIndex}${padWord(index)}` }, "latest"]
  })));
  const agentAddresses = addresses
    .filter((result) => /^0x[0-9a-fA-F]{64}$/.test(String(result || "")))
    .map((result) => wordAddress(String(result).replace(/^0x/, "")))
    .filter((address) => address !== ZERO_ADDRESS);
  if (!agentAddresses.length) return [];

  const infoResults = await rpcBatch(agentAddresses.map((address, index) => ({
    jsonrpc: "2.0",
    id: `agent-info-${index}`,
    method: "eth_call",
    params: [{ to: AGENT_HEARTBEAT_ADDRESS, data: `${AGENT_SELECTORS.info}${padWord(address)}` }, "latest"]
  })));
  return infoResults
    .map(decodeAgentInfo)
    .filter((agent) => agent && (agent.owner === normalized || agent.address === normalized));
}

async function historicalAgentDeployments(transactions, normalized) {
  const walletTransactions = transactions
    .filter((transaction) => String(transaction?.from_address || "").toLowerCase() === normalized && typeof transaction?.tx_hash === "string")
    .slice(0, 50);
  if (!walletTransactions.length) return [];

  const receipts = await rpcBatch(walletTransactions.map((transaction, index) => ({
    jsonrpc: "2.0",
    id: `agent-receipt-${index}`,
    method: "eth_getTransactionReceipt",
    params: [transaction.tx_hash]
  })));
  const found = new Map();
  for (const receipt of receipts) {
    const registered = Array.isArray(receipt?.logs)
      ? receipt.logs.find((log) => String(log?.address || "").toLowerCase() === AGENT_HEARTBEAT_ADDRESS && String(log?.topics?.[0] || "").toLowerCase() === AGENT_REGISTERED_TOPIC)
      : null;
    const topic = registered?.topics?.[1];
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(topic || ""))) continue;
    const address = wordAddress(topic.slice(2));
    found.set(address, {
      address,
      owner: normalized,
      source: "deployment-history",
      state: "HISTORICAL",
      isAlive: false,
      lastHeartbeatBlock: wordNumber(String(receipt?.blockNumber || "").replace(/^0x/, "")),
      latestManifestCID: ""
    });
  }
  return [...found.values()];
}

async function sovereignHarnessDeployments(transactions, normalized) {
  const factoryDeployments = transactions
    .filter((transaction) => {
      const sender = String(transaction?.from_address || "").toLowerCase();
      const target = String(transaction?.to_address || "").toLowerCase();
      const selector = String(transaction?.method_selector || "").toLowerCase();
      return sender === normalized && target === SOVEREIGN_AGENT_FACTORY && selector === DEPLOY_SOVEREIGN_HARNESS_SELECTOR && Number(transaction?.status) === 1;
    });
  if (!factoryDeployments.length) return [];

  const candidateHarnesses = transactions.filter((transaction) => {
    const sender = String(transaction?.from_address || "").toLowerCase();
    const target = String(transaction?.to_address || "").toLowerCase();
    const selector = String(transaction?.method_selector || "").toLowerCase();
    return sender === normalized && isAddress(target) && target !== SOVEREIGN_AGENT_FACTORY && selector === CONFIGURE_SOVEREIGN_HARNESS_SELECTOR && Number(transaction?.status) === 1;
  });
  if (!candidateHarnesses.length) return [];

  const owners = await rpcBatch(candidateHarnesses.map((transaction, index) => ({
    jsonrpc: "2.0",
    id: `sovereign-owner-${index}`,
    method: "eth_call",
    params: [{ to: transaction.to_address, data: OWNER_SELECTOR }, "latest"]
  })));
  return candidateHarnesses.flatMap((transaction, index) => {
    const ownerResult = String(owners[index] || "").replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(ownerResult) || wordAddress(ownerResult) !== normalized) return [];
    const configuredAt = Number(transaction?.block_number || 0);
    const deployment = factoryDeployments
      .filter((item) => Number(item?.block_number || 0) <= configuredAt)
      .sort((left, right) => Number(right?.block_number || 0) - Number(left?.block_number || 0))[0];
    return [{
      // Explorer omits stopped sovereign agents from its live cache. Ownership and
      // configureFundAndStart are verified directly against the deployed harness.
      address: String(transaction.to_address).toLowerCase(),
      owner: normalized,
      source: "sovereign-factory-deployment",
      state: "DEPLOYED",
      isAlive: false,
      lastHeartbeatBlock: configuredAt,
      latestManifestCID: "",
      deploymentTx: String(deployment?.tx_hash || ""),
      configurationTx: String(transaction?.tx_hash || "")
    }];
  });
}

export function collectContractDeployments(transactions, receipts, normalized) {
  const deployments = new Map();
  transactions.forEach((transaction, index) => {
    const sender = String(transaction?.from_address || "").toLowerCase();
    if (sender !== normalized || Number(transaction?.status) !== 1) return;
    const receipt = receipts[index];
    const contractAddress = String(receipt?.contractAddress || "").toLowerCase();
    const directCreation = !transaction?.to_address || String(transaction.to_address).toLowerCase() === ZERO_ADDRESS;
    if (!directCreation && !isAddress(contractAddress)) return;
    const hash = String(transaction?.tx_hash || receipt?.transactionHash || `deployment-${index}`).toLowerCase();
    deployments.set(hash, {
      hash,
      contractAddress: isAddress(contractAddress) ? contractAddress : "",
      blockNumber: Number(transaction?.block_number || wordNumber(String(receipt?.blockNumber || "").replace(/^0x/, "")) || 0)
    });
  });
  return [...deployments.values()];
}

async function contractDeploymentsForWallet(transactions, normalized) {
  const walletTransactions = transactions.filter((transaction) =>
    String(transaction?.from_address || "").toLowerCase() === normalized
    && Number(transaction?.status) === 1
    && typeof transaction?.tx_hash === "string"
  );
  if (!walletTransactions.length) return [];
  const receipts = await rpcBatch(walletTransactions.map((transaction, index) => ({
    jsonrpc: "2.0",
    id: `contract-receipt-${index}`,
    method: "eth_getTransactionReceipt",
    params: [transaction.tx_hash]
  }))).catch(() => walletTransactions.map(() => null));
  return collectContractDeployments(walletTransactions, receipts, normalized);
}

function scoreWallet({ transactionCount, contractDeployCount, nativeAgents, recentActivity }) {
  return (
    50 +
    Math.min(250, transactionCount * 5) +
    Math.min(300, contractDeployCount * 75) +
    (nativeAgents.length ? 250 : 0) +
    (recentActivity ? 75 : 0)
  );
}

export default async function handler(request, response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const address = String(request.query?.address || "").trim();
  if (!isAddress(address)) {
    response.status(400).json({ error: "Valid wallet address is required" });
    return;
  }

  const normalized = address.toLowerCase();
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 45);

  const [balanceWei, transactionCountHex, transactionFeed, agentCache] = await Promise.all([
    rpc("eth_getBalance", [address, "latest"]),
    rpc("eth_getTransactionCount", [address, "latest"]),
    fetchTransactions(address, from, today),
    fetchJson(`${EXPLORER_API_BASE}/api/agents/cache`).catch(() => ({ persistent: [] }))
  ]);

  const transactionData = transactionFeed.payload;
  const transactions = Array.isArray(transactionData?.transactions) ? transactionData.transactions : [];
  const persistentCacheAgents = cacheAgentsForWallet(agentCache, normalized);
  const sovereignCacheAgents = await sovereignCacheAgentsForWallet(agentCache, normalized).catch(() => []);
  let nativeAgents = uniqueAgents([...persistentCacheAgents, ...sovereignCacheAgents]);
  let agentSource = persistentCacheAgents.length && sovereignCacheAgents.length
    ? "explorer-mixed-cache"
    : sovereignCacheAgents.length
      ? "explorer-sovereign-cache"
      : "explorer-cache";
  if (!nativeAgents.length) {
    nativeAgents = await registeredAgentsForWallet(normalized);
    if (nativeAgents.length) agentSource = "heartbeat-registry";
  }
  if (!nativeAgents.length) {
    nativeAgents = await historicalAgentDeployments(transactions, normalized);
    agentSource = nativeAgents.length ? "deployment-history" : "no-match";
  }
  if (!nativeAgents.length) {
    nativeAgents = await sovereignHarnessDeployments(transactions, normalized);
    agentSource = nativeAgents.length ? "sovereign-factory-deployment" : "no-match";
  }

  const contractDeploys = await contractDeploymentsForWallet(transactions, normalized);
  const latestTimestamp = Math.max(0, ...transactions.map((tx) => Number(tx.block_timestamp || 0)));
  const recentActivity = latestTimestamp > 0 && Date.now() - latestTimestamp < 1000 * 60 * 60 * 24 * 14;
  const transactionCount = Number.parseInt(String(transactionCountHex || "0x0"), 16);

  response.status(200).json({
    address,
    explorerUrl: `${EXPLORER_BASE}/address/${address}`,
    balanceWei,
    balance: formatEtherLike(balanceWei),
    transactionCount,
    explorerTransactionCount: Number(transactionData?.count || transactions.length || 0),
    contractDeployCount: contractDeploys.length,
    contractDeployments: contractDeploys,
    recentActivity,
    nativeAgents,
    score: scoreWallet({ transactionCount, contractDeployCount: contractDeploys.length, nativeAgents, recentActivity }),
    transactions: transactions.slice(0, 12).map((tx) => ({
      hash: tx.tx_hash,
      blockNumber: Number(tx.block_number || 0),
      timestamp: Number(tx.block_timestamp || 0),
      from: tx.from_address || "",
      to: tx.to_address || "",
      value: tx.value || "0x0",
      gasUsed: Number(tx.gas_used || 0),
      status: Number(tx.status || 0),
      methodSelector: tx.method_selector || ""
    })),
    source: {
      transactions: transactionFeed.url,
      agents: `${EXPLORER_BASE}/api/agents/cache`,
      agentRegistry: AGENT_HEARTBEAT_ADDRESS,
      sovereignFactory: SOVEREIGN_AGENT_FACTORY,
      agentSource,
      rpc: RPC_URL
    }
  });
}
import { externalFetch } from "./external-fetch.js";
