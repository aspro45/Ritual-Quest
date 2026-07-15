import assert from "node:assert/strict";
import crypto from "node:crypto";
import oauthHandler from "../api/oauth.js";

process.env.OAUTH_STATE_SECRET = "oauth-handoff-test-secret";
process.env.APP_ORIGIN = "https://ritual-quest.vercel.app";

function seal(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", process.env.OAUTH_STATE_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function responseMock() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: "",
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = JSON.stringify(payload);
    },
    writeHead(code, nextHeaders = {}) {
      this.statusCode = code;
      Object.entries(nextHeaders).forEach(([name, value]) => headers.set(name.toLowerCase(), value));
      return this;
    },
    end(payload = "") {
      this.body = String(payload);
    },
    header(name) {
      return headers.get(String(name).toLowerCase());
    }
  };
}

const result = {
  provider: "discord",
  wallet: "0xf6d02F13D7BB5fC24aB6A3D662619641958A3Cf6",
  verifiedAt: Date.now(),
  user: { id: "782672931615539261", username: "ASPRO404" },
  checks: {
    roleSnapshotVersion: 2,
    memberRoleIds: ["1339006464139984906"]
  }
};
const token = seal({
  kind: "discord-handoff",
  result,
  returnTo: "https://ritual-quest.vercel.app/#review",
  expiresAt: Date.now() + 60_000
});
const response = responseMock();

await oauthHandler(
  {
    method: "POST",
    query: { action: "handoff" },
    headers: {
      "x-forwarded-host": "ritual-quest.vercel.app",
      "x-forwarded-proto": "https"
    },
    body: `token=${encodeURIComponent(token)}`
  },
  response
);

const cookie = response.header("set-cookie");
assert.ok(Array.isArray(cookie));
assert.match(cookie.join(";"), /proofgraph_discord_session=/);
assert.match(cookie.join(";"), /Secure/);
assert.match(response.body, /localStorage\.setItem\("proofgraph\.oauth\." \+ result\.provider/);
assert.match(response.body, /https:\/\/ritual-quest\.vercel\.app\/#review/);

console.log(JSON.stringify({ status: "PASS", test: "cross-domain Discord OAuth handoff" }));
