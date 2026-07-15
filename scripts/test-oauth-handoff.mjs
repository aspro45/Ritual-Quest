import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Wallet } from "ethers";
import oauthHandler from "../api/oauth.js";

process.env.OAUTH_STATE_SECRET = "oauth-handoff-test-secret";
process.env.APP_ORIGIN = "https://ritual-quest.vercel.app";
process.env.DISCORD_CLIENT_ID = "1523326543869382777";
process.env.DISCORD_CLIENT_SECRET = "discord-client-secret-for-tests";
process.env.DISCORD_GUILD_ID = "1210468736205852672";
process.env.DISCORD_REDIRECT_URI = "https://ritual-proofgraph.vercel.app/api/discord-callback";

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

const signer = Wallet.createRandom();
const nonce = "0x1234";
const linkMessage = `Ritual ProofGraph social link\nProvider: discord\nWallet: ${signer.address}\nNonce: ${nonce}`;
const signature = await signer.signMessage(linkMessage);
const startResponse = responseMock();
await oauthHandler(
  {
    method: "POST",
    query: { action: "start", provider: "discord" },
    headers: {
      "x-forwarded-host": "ritual-quest.vercel.app",
      "x-forwarded-proto": "https"
    },
    body: {
      wallet: signer.address,
      nonce,
      signature,
      returnTo: "https://ritual-quest.vercel.app/#identity"
    }
  },
  startResponse
);

assert.equal(startResponse.statusCode, 200);
const startPayload = JSON.parse(startResponse.body);
assert.equal(startPayload.bridgeUrl, "https://ritual-proofgraph.vercel.app/api/oauth?action=bridge&provider=discord");
assert.ok(startPayload.bridgeToken);

const bridgeResponse = responseMock();
await oauthHandler(
  {
    method: "POST",
    query: { action: "bridge", provider: "discord" },
    headers: {
      "x-forwarded-host": "ritual-proofgraph.vercel.app",
      "x-forwarded-proto": "https"
    },
    body: `token=${encodeURIComponent(startPayload.bridgeToken)}`
  },
  bridgeResponse
);

assert.equal(bridgeResponse.statusCode, 302);
assert.match(bridgeResponse.header("location"), /^https:\/\/discord\.com\/oauth2\/authorize\?/);
assert.match(bridgeResponse.header("location"), /redirect_uri=https%3A%2F%2Fritual-proofgraph\.vercel\.app%2Fapi%2Fdiscord-callback/);
assert.match(bridgeResponse.header("set-cookie"), /proofgraph_oauth=/);
assert.match(bridgeResponse.header("set-cookie"), /Secure/);

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

console.log(JSON.stringify({ status: "PASS", tests: ["cross-domain OAuth start bridge", "cross-domain Discord proof handoff"] }));
