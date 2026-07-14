import { canUseEventSessions, readDiscordSession } from "./discord-session.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_REST = "/rest/v1/calendar_events";
const LOCAL_STORE = path.join(process.cwd(), ".local-data", "calendar-events.json");

class RequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function eventManagerRoleIds() {
  return String(process.env.DISCORD_EVENT_MANAGER_ROLE_IDS || "")
    .split(",")
    .map((role) => role.trim())
    .filter((role, index, all) => /^\d{15,25}$/.test(role) && all.indexOf(role) === index);
}

function eventManagerWallets() {
  return String(process.env.DISCORD_EVENT_MANAGER_WALLETS || "")
    .split(",")
    .map((wallet) => wallet.trim().toLowerCase())
    .filter((wallet, index, all) => /^0x[a-f0-9]{40}$/.test(wallet) && all.indexOf(wallet) === index);
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  return { url, key, configured: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && key.length > 20 };
}

function localStoreEnabled() {
  return !process.env.VERCEL && process.env.NODE_ENV !== "production";
}

function json(response, status, payload) {
  response.status(status).json(payload);
}

function isoDate(value) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
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

function cleanEventId(value) {
  const id = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function normalizeEventRecord(event) {
  const startsAt = isoDate(event?.starts_at || event?.startsAt);
  const endsAt = isoDate(event?.ends_at || event?.endsAt);
  const title = cleanText(event?.title, 100);
  const id = cleanEventId(event?.id);
  if (!id || !title || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) return null;
  return {
    id,
    title,
    startsAt,
    endsAt,
    description: cleanText(event?.description, 1000),
    location: cleanText(event?.location, 100),
    url: cleanUrl(event?.url),
    imageUrl: cleanImageUrl(event?.image_url || event?.imageUrl),
    createdBy: cleanText(event?.created_by_name || event?.createdBy, 80),
    createdByDiscordId: cleanText(event?.created_by_discord_id || event?.createdByDiscordId, 25),
    createdAt: isoDate(event?.created_at || event?.createdAt)
  };
}

function publicEvent(record, session) {
  if (!record) return null;
  const { createdByDiscordId, ...event } = record;
  return {
    ...event,
    canManage: Boolean(session?.user?.id && createdByDiscordId && session.user.id === createdByDiscordId)
  };
}

function cleanEventPayload(request, { requireFuture = false } = {}) {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const title = cleanText(body.title, 100);
  const description = cleanText(body.description, 1000);
  const location = cleanText(body.location, 100);
  const url = cleanUrl(body.url);
  const rawImageUrl = String(body.imageUrl || "").trim();
  const imageUrl = cleanImageUrl(rawImageUrl);
  const startsAt = isoDate(body.startsAt);
  const endsAt = isoDate(body.endsAt);
  if (!title || !url || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new RequestError("Title, event link, start time, and a later end time are required.");
  }
  if (requireFuture && Date.parse(startsAt) < Date.now() - 1000 * 60 * 5) {
    throw new RequestError("Events must start in the future.");
  }
  if (rawImageUrl && !imageUrl) throw new RequestError("Event image must use a valid public HTTPS URL.");
  return { title, description, location, url, imageUrl, startsAt, endsAt };
}

function requestedEventId(request) {
  const id = cleanEventId(request.query?.id || request.body?.id);
  if (!id) throw new RequestError("A valid event ID is required.");
  return id;
}

function canCreate(session, managerRoles, managerWallets) {
  if (!session) return false;
  const hasRole = managerRoles.length > 0 && session.roles.some((role) => managerRoles.includes(role));
  const hasWallet = managerWallets.length > 0 && managerWallets.includes(String(session.wallet || "").toLowerCase());
  return hasRole || hasWallet;
}

function payloadBase() {
  const managerRoles = eventManagerRoleIds();
  const managerWallets = eventManagerWallets();
  const store = supabaseConfig();
  const local = !store.configured && localStoreEnabled();
  return {
    configured: store.configured || local,
    editorRoleConfigured: managerRoles.length > 0,
    editorWalletConfigured: managerWallets.length > 0,
    sessionConfigured: canUseEventSessions(),
    storageMode: store.configured ? "supabase" : local ? "local" : "unconfigured",
    source: store.configured ? `${store.url}${SUPABASE_REST}` : local ? "local-persistent-store" : ""
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
  if (!result.ok) throw new Error(payload.message || payload.hint || `Calendar store returned ${result.status}`);
  return payload;
}

async function readLocalEventRecords() {
  try {
    const rows = JSON.parse(await readFile(LOCAL_STORE, "utf8"));
    return Array.isArray(rows) ? rows.map(normalizeEventRecord).filter(Boolean) : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalEventRecords(records) {
  const ordered = records.slice().sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  await mkdir(path.dirname(LOCAL_STORE), { recursive: true });
  const temporary = `${LOCAL_STORE}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
  await rename(temporary, LOCAL_STORE);
}

async function listEventRecords() {
  if (!supabaseConfig().configured && localStoreEnabled()) return readLocalEventRecords();
  const rows = await supabaseFetch(`${SUPABASE_REST}?select=id,title,description,starts_at,ends_at,location,url,image_url,created_by_discord_id,created_by_name,created_at&order=starts_at.asc&limit=100`);
  return Array.isArray(rows) ? rows.map(normalizeEventRecord).filter(Boolean) : [];
}

async function findEventRecord(id) {
  if (!supabaseConfig().configured && localStoreEnabled()) {
    return (await readLocalEventRecords()).find((event) => event.id === id) || null;
  }
  const rows = await supabaseFetch(`${SUPABASE_REST}?select=id,title,description,starts_at,ends_at,location,url,image_url,created_by_discord_id,created_by_name,created_at&id=eq.${encodeURIComponent(id)}&limit=1`);
  return normalizeEventRecord(Array.isArray(rows) ? rows[0] : null);
}

function assertOwner(record, session) {
  if (!record) throw new RequestError("Event not found.", 404);
  if (!session?.user?.id || !record.createdByDiscordId || record.createdByDiscordId !== session.user.id) {
    throw new RequestError("Only the Discord account that created this event can change it.", 403);
  }
}

async function createEvent(request, session) {
  const values = cleanEventPayload(request, { requireFuture: true });
  if (!supabaseConfig().configured && localStoreEnabled()) {
    const event = normalizeEventRecord({
      id: crypto.randomUUID(),
      ...values,
      createdBy: session.user.username,
      createdByDiscordId: session.user.id,
      createdAt: new Date().toISOString()
    });
    if (!event) throw new Error("Event data could not be normalized.");
    await writeLocalEventRecords([...(await readLocalEventRecords()), event]);
    return publicEvent(event, session);
  }
  const rows = await supabaseFetch(SUPABASE_REST, {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      title: values.title,
      description: values.description,
      starts_at: values.startsAt,
      ends_at: values.endsAt,
      location: values.location,
      url: values.url,
      image_url: values.imageUrl,
      created_by_discord_id: session.user.id,
      created_by_name: session.user.username
    })
  });
  return publicEvent(normalizeEventRecord(rows?.[0]), session);
}

async function updateEvent(request, session) {
  const id = requestedEventId(request);
  const existing = await findEventRecord(id);
  assertOwner(existing, session);
  const values = cleanEventPayload(request);
  if (!supabaseConfig().configured && localStoreEnabled()) {
    const records = await readLocalEventRecords();
    const updated = normalizeEventRecord({ ...existing, ...values });
    await writeLocalEventRecords(records.map((event) => event.id === id ? updated : event));
    return publicEvent(updated, session);
  }
  const rows = await supabaseFetch(`${SUPABASE_REST}?id=eq.${encodeURIComponent(id)}&created_by_discord_id=eq.${encodeURIComponent(session.user.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      title: values.title,
      description: values.description,
      starts_at: values.startsAt,
      ends_at: values.endsAt,
      location: values.location,
      url: values.url,
      image_url: values.imageUrl
    })
  });
  const updated = normalizeEventRecord(rows?.[0]);
  if (!updated) throw new RequestError("Event could not be updated.", 409);
  return publicEvent(updated, session);
}

async function deleteEvent(request, session) {
  const id = requestedEventId(request);
  const existing = await findEventRecord(id);
  assertOwner(existing, session);
  if (!supabaseConfig().configured && localStoreEnabled()) {
    const records = await readLocalEventRecords();
    await writeLocalEventRecords(records.filter((event) => event.id !== id));
    return id;
  }
  const rows = await supabaseFetch(`${SUPABASE_REST}?id=eq.${encodeURIComponent(id)}&created_by_discord_id=eq.${encodeURIComponent(session.user.id)}`, {
    method: "DELETE",
    headers: { prefer: "return=representation" }
  });
  if (!Array.isArray(rows) || !rows.length) throw new RequestError("Event could not be deleted.", 409);
  return id;
}

export default async function calendar(request, response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") return response.status(204).end();

  const base = payloadBase();
  const session = readDiscordSession(request);
  const access = canCreate(session, eventManagerRoleIds(), eventManagerWallets());

  if (!base.configured) {
    if (request.method !== "GET") return json(response, 503, { error: "Calendar storage has not been configured yet." });
    return json(response, 200, { ...base, canCreate: false, events: [], notice: "Calendar storage has not been configured yet." });
  }

  try {
    if (request.method === "GET") {
      const records = await listEventRecords();
      return json(response, 200, { ...base, canCreate: access, events: records.map((event) => publicEvent(event, session)) });
    }
    if (!base.sessionConfigured) return json(response, 503, { error: "Set OAUTH_STATE_SECRET before enabling event writes." });
    if (!session) return json(response, 401, { error: "Link Discord again before changing an event." });
    if (request.method === "POST") {
      if (!base.editorRoleConfigured && !base.editorWalletConfigured) return json(response, 503, { error: "No event manager roles or wallets are configured." });
      if (!access) return json(response, 403, { error: "Your Discord roles cannot create calendar events." });
      return json(response, 201, { ...base, canCreate: true, event: await createEvent(request, session) });
    }
    if (request.method === "PUT") {
      return json(response, 200, { ...base, canCreate: access, event: await updateEvent(request, session) });
    }
    if (request.method === "DELETE") {
      return json(response, 200, { ...base, canCreate: access, deletedId: await deleteEvent(request, session) });
    }
    return json(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const status = error instanceof RequestError ? error.statusCode : 502;
    return json(response, status, { error: error instanceof Error ? error.message : String(error) });
  }
}
