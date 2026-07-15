import { Contract, JsonRpcProvider, Wallet, isAddress, keccak256, toUtf8Bytes, verifyMessage } from "ethers";
import { canUseDiscordSessions, readDiscordSession } from "./discord-session.js";

const REVIEW_TASK_POINTS = new Map([
  ["x-proof", 130],
  ["x-follow", 90],
  ["blog-insight", 160],
  ["build-log", 410],
  ["agent-update", 370],
  ["receipt-anchor", 240]
]);

const registryAbi = [
  "event ProofReviewRequested(address indexed builder, bytes32 indexed proofType, bytes32 indexed proofHash, string evidenceUri)"
];

const decisionsAbi = [
  "function attestors(address) view returns (bool)",
  "function approveProof(address builder, bytes32 proofType, bytes32 proofHash, uint16 points, string evidenceUri)",
  "function rejectProof(address builder, bytes32 proofType, bytes32 proofHash, string reason)"
];

class RequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function reviewerRoleIds() {
  return String(process.env.DISCORD_ATTESTOR_ROLE_IDS || process.env.DISCORD_ATTESTOR_ROLE_ID || "")
    .split(",")
    .map((role) => role.trim())
    .filter((role, index, all) => /^\d{15,25}$/.test(role) && all.indexOf(role) === index);
}

function reviewerWallets() {
  return String(process.env.DISCORD_ATTESTOR_WALLETS || "")
    .split(",")
    .map((wallet) => wallet.trim().toLowerCase())
    .filter((wallet, index, all) => isAddress(wallet) && all.indexOf(wallet) === index);
}

function relayConfig() {
  const rpcUrl = String(process.env.RITUAL_RPC_URL || process.env.VITE_RITUAL_RPC_URL || "").trim();
  const chainId = Number(process.env.RITUAL_CHAIN_ID || process.env.VITE_RITUAL_CHAIN_ID || 1979);
  const registryAddress = String(process.env.VITE_PROOFGRAPH_ADDRESS || "").trim();
  const decisionsAddress = String(process.env.VITE_REVIEW_DECISIONS_ADDRESS || "").trim();
  const privateKey = String(process.env.REVIEW_RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "").trim();
  return {
    rpcUrl,
    chainId,
    registryAddress,
    decisionsAddress,
    privateKey,
    configured: /^https?:\/\//i.test(rpcUrl)
      && Number.isSafeInteger(chainId)
      && chainId > 0
      && isAddress(registryAddress)
      && isAddress(decisionsAddress)
      && /^0x[0-9a-f]{64}$/i.test(privateKey)
  };
}

function json(response, status, payload) {
  response.status(status).json(payload);
}

function hasReviewerRole(session, roles) {
  return Boolean(session && roles.length && session.roles.some((role) => roles.includes(role)));
}

export function reviewAuthorizationMessage(values, expiresAt) {
  return [
    "Ritual Quest review decision",
    `Reviewer: ${values.reviewerWallet}`,
    `Action: ${values.action}`,
    `Builder: ${values.builder.toLowerCase()}`,
    `Proof type: ${values.proofType.toLowerCase()}`,
    `Proof hash: ${values.proofHash.toLowerCase()}`,
    `Task: ${values.taskId}`,
    `Evidence: ${values.evidenceUri}`,
    `Reason: ${values.reason}`,
    `Expires: ${expiresAt}`
  ].join("\n");
}

export function hasWalletAuthorization(body, values, wallets) {
  if (!wallets.includes(values.reviewerWallet)) return false;
  const expiresAt = Number(body.authorizationExpiresAt || 0);
  const signature = String(body.reviewerSignature || "");
  const now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + 1000 * 60 * 5 || !signature) return false;
  try {
    return verifyMessage(reviewAuthorizationMessage(values, expiresAt), signature).toLowerCase() === values.reviewerWallet;
  } catch {
    return false;
  }
}

function cleanHex(value) {
  const text = String(value || "").trim();
  return /^0x[0-9a-f]{64}$/i.test(text) ? text : "";
}

function cleanUrl(value) {
  const text = String(value || "").trim();
  try {
    const parsed = new URL(text);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function taskTemplate(taskId) {
  const value = String(taskId || "").trim();
  if (!/^[a-z0-9:-]{3,140}$/i.test(value)) return "";
  const template = value.split(":").at(-1) || "";
  return REVIEW_TASK_POINTS.has(template) ? template : "";
}

function cleanDecisionPayload(request) {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const action = body.action === "accept" || body.action === "reject" ? body.action : "";
  const reviewerWallet = String(body.reviewerWallet || "").trim().toLowerCase();
  const builder = String(body.builder || "").trim();
  const proofType = cleanHex(body.proofType);
  const proofHash = cleanHex(body.proofHash);
  const evidenceUri = cleanUrl(body.evidenceUri);
  const taskId = String(body.taskId || "").trim();
  const template = taskTemplate(taskId);
  const reason = String(body.reason || "").trim().replace(/\s+/g, " ");

  if (!action || !isAddress(reviewerWallet) || !isAddress(builder) || !proofType || !proofHash || !template) {
    throw new RequestError("The review request is invalid.");
  }
  const expectedProofType = keccak256(toUtf8Bytes(`proofgraph:${taskId}`));
  if (expectedProofType.toLowerCase() !== proofType.toLowerCase()) {
    throw new RequestError("The task does not match this proof request.");
  }
  if (action === "accept" && !evidenceUri) throw new RequestError("A public evidence URL is required.");
  if (action === "reject" && (reason.length < 4 || reason.length > 280)) {
    throw new RequestError("The rejection reason must be between 4 and 280 characters.");
  }
  return {
    action,
    reviewerWallet,
    builder,
    proofType,
    proofHash,
    evidenceUri,
    reason,
    taskId,
    points: REVIEW_TASK_POINTS.get(template)
  };
}

async function findReviewRequest(registry, values, fromBlock) {
  const provider = registry.runner?.provider;
  const latestBlock = await provider.getBlockNumber();
  const startBlock = Math.max(0, Number.isSafeInteger(fromBlock) && fromBlock > 0 ? fromBlock : latestBlock - 250_000);
  const filter = registry.filters.ProofReviewRequested(values.builder, values.proofType, values.proofHash);
  const windowSize = 50_000;
  for (let start = startBlock; start <= latestBlock; start += windowSize) {
    const end = Math.min(latestBlock, start + windowSize - 1);
    const logs = await registry.queryFilter(filter, start, end);
    const match = logs.find((log) => String(log.args?.evidenceUri || "") === values.evidenceUri);
    if (match) return match;
  }
  return null;
}

async function writeDecision(values) {
  const config = relayConfig();
  if (!config.configured) throw new RequestError("The review relay is not configured.", 503);
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
  const relay = new Wallet(config.privateKey, provider);
  const decisions = new Contract(config.decisionsAddress, decisionsAbi, relay);
  if (!await decisions.attestors(relay.address)) {
    throw new RequestError("The review relay is not authorized by the decision contract.", 503);
  }

  const registry = new Contract(config.registryAddress, registryAbi, provider);
  const fromBlock = Number(process.env.VITE_PROOFGRAPH_REVIEW_START_BLOCK || 0);
  if (!await findReviewRequest(registry, values, fromBlock)) {
    throw new RequestError("No matching onchain proof request was found.", 409);
  }

  const transaction = values.action === "accept"
    ? await decisions.approveProof(values.builder, values.proofType, values.proofHash, values.points, values.evidenceUri)
    : await decisions.rejectProof(values.builder, values.proofType, values.proofHash, values.reason);
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error("The review transaction was not confirmed.");
  return { transactionHash: transaction.hash, blockNumber: receipt.blockNumber };
}

export default async function reviews(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") return response.status(204).end();

  const session = readDiscordSession(request);
  const roles = reviewerRoleIds();
  const wallets = reviewerWallets();
  const requestedWallet = String(request.query?.wallet || "").trim().toLowerCase();
  const canReview = hasReviewerRole(session, roles) || wallets.includes(requestedWallet);
  const relay = relayConfig();

  if (request.method === "GET") {
    return json(response, 200, {
      canReview,
      roleConfigured: roles.length > 0,
      walletConfigured: wallets.length > 0,
      relayConfigured: relay.configured,
      sessionConfigured: canUseDiscordSessions()
    });
  }
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
  if (!roles.length && !wallets.length) return json(response, 503, { error: "No reviewer access is configured." });

  try {
    const values = cleanDecisionPayload(request);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const roleAuthorized = hasReviewerRole(session, roles) && session.wallet === values.reviewerWallet;
    const walletAuthorized = hasWalletAuthorization(body, values, wallets);
    if (!roleAuthorized && !walletAuthorized) {
      throw new RequestError("Reviewer access requires an approved Discord role or an authorized reviewer wallet signature.", 403);
    }
    const result = await writeDecision(values);
    return json(response, 200, { ok: true, action: values.action, ...result });
  } catch (error) {
    const status = error instanceof RequestError ? error.statusCode : 502;
    return json(response, status, { error: error instanceof Error ? error.message : String(error) });
  }
}
