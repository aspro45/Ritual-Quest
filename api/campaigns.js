import crypto from "node:crypto";
import { canUseDiscordSessions, readDiscordSession } from "./discord-session.js";

const SUPABASE_REST = "/rest/v1/quest_campaigns";
const ALLOWED_CATEGORIES = new Set(["Builder", "Agents", "Community", "Onchain", "Discord"]);
const ALLOWED_TASK_IDS = new Set([
  "wallet-link",
  "chain-activity",
  "contract-deploy",
  "native-agent",
  "discord-oath",
  "x-proof",
  "x-follow",
  "blog-insight",
  "build-log",
  "agent-update"
]);

class RequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function campaignManagerRoleIds() {
  return String(process.env.DISCORD_CAMPAIGN_MANAGER_ROLE_IDS || "")
    .split(",")
    .map((role) => role.trim())
    .filter((role, index, all) => /^\d{15,25}$/.test(role) && all.indexOf(role) === index);
}

function campaignManagerWallets() {
  return String(process.env.DISCORD_CAMPAIGN_MANAGER_WALLETS || "")
    .split(",")
    .map((wallet) => wallet.trim().toLowerCase())
    .filter((wallet, index, all) => /^0x[a-f0-9]{40}$/.test(wallet) && all.indexOf(wallet) === index);
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  return { url, key, configured: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key.length > 20 };
}

function json(response, status, payload) {
  response.status(status).json(payload);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function cleanCampaignId(value) {
  const id = String(value || "").trim();
  return /^community-[a-z0-9-]{3,80}$/.test(id) ? id : "";
}

function cleanTaskIds(value) {
  const source = Array.isArray(value) ? value : [];
  const selected = source.map(String).filter((taskId) => ALLOWED_TASK_IDS.has(taskId) && taskId !== "wallet-link");
  return ["wallet-link", ...new Set(selected)].slice(0, 5);
}

function cleanXPostUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!["x.com", "twitter.com"].includes(host) || !/^\/[^/]+\/status\/\d+\/?$/.test(parsed.pathname)) return "";
    parsed.protocol = "https:";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeCustomTask(value) {
  if (!value || typeof value !== "object") return null;
  const title = cleanText(value.title, 60);
  const instructions = cleanText(value.instructions, 220);
  const postPrompt = cleanText(value.postPrompt, 240);
  const rawPostUrl = String(value.postUrl || "").trim();
  const postUrl = cleanXPostUrl(rawPostUrl);
  const accounts = [...new Set((Array.isArray(value.accounts) ? value.accounts : String(value.accounts || "").split(","))
    .map((account) => String(account).trim().replace(/^@/, "").toLowerCase())
    .filter((account) => /^[a-z0-9_]{1,15}$/.test(account)))].slice(0, 5);
  const engagements = [...new Set((Array.isArray(value.engagements) ? value.engagements : [])
    .map(String)
    .filter((engagement) => ["like", "repost", "reply"].includes(engagement)))];

  if (!title && !instructions && !postPrompt && !rawPostUrl && !accounts.length && !engagements.length) return null;
  if (title.length < 3) throw new RequestError("Custom quest title must be at least 3 characters.");
  if (instructions.length < 8) throw new RequestError("Custom quest instructions must be at least 8 characters.");
  if (rawPostUrl && !postUrl) throw new RequestError("Target post must be a valid public X post URL.");
  if (engagements.length && !postUrl) throw new RequestError("Add a target X post before choosing like, repost, or reply.");
  if (!accounts.length && !postUrl && !postPrompt) throw new RequestError("Add an X account, target post, or post prompt to the custom quest.");
  return { title, instructions, accounts, postUrl, engagements, postPrompt, verification: "self-attested", timerSeconds: 60 };
}

function campaignSlug(title) {
  const base = cleanText(title, 70)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "campaign";
  return `community-${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function cleanCampaignPayload(request) {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const title = cleanText(body.title, 70);
  const description = cleanText(body.description, 280);
  const category = cleanText(body.category, 20);
  const rawImageUrl = String(body.imageUrl || "").trim();
  const imageUrl = cleanImageUrl(rawImageUrl);
  const selectedTaskIds = [...new Set((Array.isArray(body.taskIds) ? body.taskIds : []).map(String)
    .filter((taskId) => ALLOWED_TASK_IDS.has(taskId) && taskId !== "wallet-link"))];
  const taskIds = cleanTaskIds(selectedTaskIds);
  const customTask = normalizeCustomTask(body.customTask);

  if (title.length < 3) throw new RequestError("Campaign title must be at least 3 characters.");
  if (description.length < 12) throw new RequestError("Campaign description must be at least 12 characters.");
  if (!ALLOWED_CATEGORIES.has(category)) throw new RequestError("Choose a valid campaign category.");
  if (rawImageUrl && !imageUrl) throw new RequestError("Campaign image must use a valid HTTPS URL.");
  if (selectedTaskIds.length + (customTask ? 1 : 0) > 4) throw new RequestError("Choose no more than four campaign tasks in total.");
  if (taskIds.length < 2 && !customTask) throw new RequestError("Choose at least one campaign task.");
  return { title, description, category, imageUrl, taskIds, customTask };
}

function normalizeCampaignRecord(row) {
  const title = cleanText(row?.title, 70);
  const description = cleanText(row?.description, 280);
  const category = cleanText(row?.category, 20);
  const taskIds = cleanTaskIds(row?.task_ids || row?.taskIds);
  let customTask = null;
  try {
    customTask = normalizeCustomTask(row?.custom_task || row?.customTask);
  } catch {
    return null;
  }
  const id = cleanCampaignId(row?.id);
  if (!id || !title || !description || !ALLOWED_CATEGORIES.has(category) || (taskIds.length < 2 && !customTask)) return null;
  return {
    id,
    title,
    description,
    category,
    imageUrl: cleanImageUrl(row?.image_url || row?.imageUrl),
    badge: `${category} campaign`,
    taskIds,
    customTask,
    createdBy: cleanText(row?.created_by_name || row?.createdBy, 80),
    createdByDiscordId: cleanText(row?.created_by_discord_id || row?.createdByDiscordId, 25),
    createdAt: String(row?.created_at || row?.createdAt || "")
  };
}

function publicCampaign(record, session) {
  if (!record) return null;
  const { createdByDiscordId, ...campaign } = record;
  return {
    ...campaign,
    canManage: Boolean(session?.user?.id && createdByDiscordId && session.user.id === createdByDiscordId)
  };
}

function requestedCampaignId(request) {
  const id = cleanCampaignId(request.query?.id || request.body?.id);
  if (!id) throw new RequestError("A valid campaign ID is required.");
  return id;
}

function canCreate(session, managerRoles, managerWallets) {
  if (!session) return false;
  const hasRole = managerRoles.length > 0 && session.roles.some((role) => managerRoles.includes(role));
  const hasWallet = managerWallets.length > 0 && managerWallets.includes(String(session.wallet || "").toLowerCase());
  return hasRole || hasWallet;
}

function payloadBase() {
  const managerRoles = campaignManagerRoleIds();
  const managerWallets = campaignManagerWallets();
  const store = supabaseConfig();
  return {
    configured: store.configured,
    editorRoleConfigured: managerRoles.length > 0,
    editorWalletConfigured: managerWallets.length > 0,
    sessionConfigured: canUseDiscordSessions()
  };
}

async function supabaseFetch(requestPath, options = {}) {
  const store = supabaseConfig();
  const result = await fetch(`${store.url}${requestPath}`, {
    ...options,
    headers: {
      apikey: store.key,
      authorization: `Bearer ${store.key}`,
      accept: "application/json",
      ...options.headers
    },
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.message || payload.hint || `Campaign store returned ${result.status}`);
  return payload;
}

async function listCampaignRecords() {
  const rows = await supabaseFetch(`${SUPABASE_REST}?select=id,title,description,category,image_url,task_ids,custom_task,created_by_discord_id,created_by_name,created_at&published=eq.true&order=created_at.desc&limit=50`);
  return Array.isArray(rows) ? rows.map(normalizeCampaignRecord).filter(Boolean) : [];
}

async function findCampaignRecord(id) {
  const rows = await supabaseFetch(`${SUPABASE_REST}?select=id,title,description,category,image_url,task_ids,custom_task,created_by_discord_id,created_by_name,created_at&id=eq.${encodeURIComponent(id)}&limit=1`);
  return normalizeCampaignRecord(Array.isArray(rows) ? rows[0] : null);
}

function assertOwner(record, session) {
  if (!record) throw new RequestError("Campaign not found.", 404);
  if (!session?.user?.id || !record.createdByDiscordId || record.createdByDiscordId !== session.user.id) {
    throw new RequestError("Only the Discord account that created this campaign can change it.", 403);
  }
}

async function createCampaign(request, session) {
  const values = cleanCampaignPayload(request);
  const rows = await supabaseFetch(SUPABASE_REST, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      id: campaignSlug(values.title),
      title: values.title,
      description: values.description,
      category: values.category,
      image_url: values.imageUrl,
      task_ids: values.taskIds,
      custom_task: values.customTask,
      created_by_discord_id: session.user.id,
      created_by_name: session.user.username,
      published: true
    })
  });
  return publicCampaign(normalizeCampaignRecord(rows?.[0]), session);
}

async function updateCampaign(request, session) {
  const id = requestedCampaignId(request);
  const existing = await findCampaignRecord(id);
  assertOwner(existing, session);
  const values = cleanCampaignPayload(request);
  const rows = await supabaseFetch(`${SUPABASE_REST}?id=eq.${encodeURIComponent(id)}&created_by_discord_id=eq.${encodeURIComponent(session.user.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      title: values.title,
      description: values.description,
      category: values.category,
      image_url: values.imageUrl,
      task_ids: values.taskIds,
      custom_task: values.customTask
    })
  });
  const updated = normalizeCampaignRecord(rows?.[0]);
  if (!updated) throw new RequestError("Campaign could not be updated.", 409);
  return publicCampaign(updated, session);
}

async function deleteCampaign(request, session) {
  const id = requestedCampaignId(request);
  const existing = await findCampaignRecord(id);
  assertOwner(existing, session);
  const rows = await supabaseFetch(`${SUPABASE_REST}?id=eq.${encodeURIComponent(id)}&created_by_discord_id=eq.${encodeURIComponent(session.user.id)}`, {
    method: "DELETE",
    headers: { prefer: "return=representation" }
  });
  if (!Array.isArray(rows) || !rows.length) throw new RequestError("Campaign could not be deleted.", 409);
  return id;
}

export default async function campaigns(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") return response.status(204).end();

  const base = payloadBase();
  const session = readDiscordSession(request);
  const access = canCreate(session, campaignManagerRoleIds(), campaignManagerWallets());

  if (!base.configured) {
    if (request.method !== "GET") return json(response, 503, { error: "Campaign storage has not been configured yet." });
    return json(response, 200, { ...base, canCreate: access, campaigns: [], notice: "Campaign storage has not been configured yet." });
  }

  try {
    if (request.method === "GET") {
      const records = await listCampaignRecords();
      return json(response, 200, { ...base, canCreate: access, campaigns: records.map((campaign) => publicCampaign(campaign, session)) });
    }
    if (!base.sessionConfigured) return json(response, 503, { error: "Set OAUTH_STATE_SECRET before enabling campaign writes." });
    if (!session) return json(response, 401, { error: "Link Discord again before changing a campaign." });
    if (request.method === "POST") {
      if (!base.editorRoleConfigured && !base.editorWalletConfigured) return json(response, 503, { error: "No campaign manager roles or wallets are configured." });
      if (!access) return json(response, 403, { error: "Your Discord roles cannot create campaigns." });
      return json(response, 201, { ...base, canCreate: true, campaign: await createCampaign(request, session) });
    }
    if (request.method === "PUT") {
      return json(response, 200, { ...base, canCreate: access, campaign: await updateCampaign(request, session) });
    }
    if (request.method === "DELETE") {
      return json(response, 200, { ...base, canCreate: access, deletedId: await deleteCampaign(request, session) });
    }
    return json(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error instanceof RequestError ? error.statusCode : 502;
    return json(response, status, { error: error instanceof Error ? error.message : String(error) });
  }
}
