import assert from "node:assert/strict";
import calendar from "../api/calendar.js";
import campaigns from "../api/campaigns.js";
import { createDiscordSessionCookie } from "../api/discord-session.js";

const ownerWallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";

process.env.OAUTH_STATE_SECRET = "proofgraph-ownership-test-secret";
process.env.DISCORD_EVENT_MANAGER_WALLETS = ownerWallet;
process.env.DISCORD_CAMPAIGN_MANAGER_WALLETS = ownerWallet;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VERCEL;
process.env.NODE_ENV = "test-local";

function sessionCookie(id, username, wallet) {
  const value = createDiscordSessionCookie(
    { headers: {} },
    { provider: "discord", wallet, user: { id, username }, checks: { memberRoleIds: [] } }
  );
  return value.split(";")[0];
}

const ownerCookie = sessionCookie("100000000000000001", "owner", ownerWallet);
const otherCookie = sessionCookie("100000000000000002", "other", otherWallet);

async function invoke(handler, { method = "GET", body = {}, query = {}, cookie = "" } = {}) {
  const result = { status: 0, payload: undefined };
  const response = {
    setHeader() {},
    status(status) {
      result.status = status;
      return this;
    },
    json(payload) {
      result.payload = payload;
      return this;
    },
    end() {
      return this;
    }
  };
  await handler({ method, body, query, headers: { cookie } }, response);
  return result;
}

const startsAt = new Date(Date.now() - 3_600_000).toISOString();
const endsAt = new Date(Date.now() + 3_600_000).toISOString();
const eventUrl = "https://example.com/ritual-event";
const createdEvent = await invoke(calendar, {
  method: "POST",
  cookie: ownerCookie,
  body: { title: "Owner event", startsAt, endsAt, url: eventUrl, description: "Created by the owner account." }
});
assert.equal(createdEvent.status, 201);
assert.equal(createdEvent.payload.event.canManage, true);
const eventId = createdEvent.payload.event.id;

const foreignEventUpdate = await invoke(calendar, {
  method: "PUT",
  cookie: otherCookie,
  query: { id: eventId },
  body: { title: "Foreign edit", startsAt, endsAt, url: eventUrl, description: "This request must be rejected." }
});
assert.equal(foreignEventUpdate.status, 403);

const ownerEventUpdate = await invoke(calendar, {
  method: "PUT",
  cookie: ownerCookie,
  query: { id: eventId },
  body: { title: "Owner event updated", startsAt, endsAt, url: eventUrl, description: "Only the creator can save this change." }
});
assert.equal(ownerEventUpdate.status, 200);
assert.equal(ownerEventUpdate.payload.event.title, "Owner event updated");

const foreignEventDelete = await invoke(calendar, { method: "DELETE", cookie: otherCookie, query: { id: eventId } });
assert.equal(foreignEventDelete.status, 403);
const ownerEventDelete = await invoke(calendar, { method: "DELETE", cookie: ownerCookie, query: { id: eventId } });
assert.equal(ownerEventDelete.status, 200);

process.env.SUPABASE_URL = "https://ownership-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "ownership-test-service-role-key";
const campaignRows = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url));
  const method = String(options.method || "GET").toUpperCase();
  const id = parsed.searchParams.get("id")?.replace(/^eq\./, "") || "";
  if (method === "POST") {
    const body = JSON.parse(options.body);
    const row = { ...body, created_at: new Date().toISOString() };
    campaignRows.push(row);
    return Response.json([row]);
  }
  if (method === "PATCH") {
    const index = campaignRows.findIndex((row) => row.id === id);
    if (index < 0) return Response.json([]);
    campaignRows[index] = { ...campaignRows[index], ...JSON.parse(options.body) };
    return Response.json([campaignRows[index]]);
  }
  if (method === "DELETE") {
    const index = campaignRows.findIndex((row) => row.id === id);
    if (index < 0) return Response.json([]);
    return Response.json(campaignRows.splice(index, 1));
  }
  const rows = id ? campaignRows.filter((row) => row.id === id) : campaignRows;
  return Response.json(rows);
};

try {
  const campaignBody = {
    title: "Owner campaign",
    description: "A campaign that belongs to its Discord creator.",
    category: "Builder",
    imageUrl: "",
    taskIds: ["chain-activity"],
    customTask: null
  };
  const createdCampaign = await invoke(campaigns, { method: "POST", cookie: ownerCookie, body: campaignBody });
  assert.equal(createdCampaign.status, 201);
  assert.equal(createdCampaign.payload.campaign.canManage, true);
  const campaignId = createdCampaign.payload.campaign.id;

  const foreignCampaignUpdate = await invoke(campaigns, {
    method: "PUT",
    cookie: otherCookie,
    query: { id: campaignId },
    body: { ...campaignBody, title: "Foreign campaign edit" }
  });
  assert.equal(foreignCampaignUpdate.status, 403);

  const ownerCampaignUpdate = await invoke(campaigns, {
    method: "PUT",
    cookie: ownerCookie,
    query: { id: campaignId },
    body: { ...campaignBody, title: "Owner campaign updated" }
  });
  assert.equal(ownerCampaignUpdate.status, 200);
  assert.equal(ownerCampaignUpdate.payload.campaign.title, "Owner campaign updated");

  const foreignCampaignDelete = await invoke(campaigns, { method: "DELETE", cookie: otherCookie, query: { id: campaignId } });
  assert.equal(foreignCampaignDelete.status, 403);
  const ownerCampaignDelete = await invoke(campaigns, { method: "DELETE", cookie: ownerCookie, query: { id: campaignId } });
  assert.equal(ownerCampaignDelete.status, 200);
} finally {
  globalThis.fetch = nativeFetch;
}

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "calendar creator can publish an ongoing event, edit it, and delete it",
    "calendar non-creator receives 403",
    "campaign creator can edit and delete",
    "campaign non-creator receives 403"
  ]
}, null, 2));
