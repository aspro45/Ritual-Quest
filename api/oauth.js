import crypto from "node:crypto";
import { id, verifyMessage } from "ethers";
import { createDiscordSessionCookie } from "./discord-session.js";
import { externalFetch } from "./external-fetch.js";

const DISCORD_AUTH = "https://discord.com/oauth2/authorize";
const DISCORD_API = "https://discord.com/api";
const X_AUTH = "https://twitter.com/i/oauth2/authorize";
const X_API = "https://api.x.com/2";
const COOKIE_NAME = "proofgraph_oauth";

function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
}

function getOrigin(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "127.0.0.1:5192";
  const proto = request.headers["x-forwarded-proto"] || (String(host).startsWith("127.") || String(host).startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function frontendOrigin(request) {
  const configured = process.env.APP_ORIGIN || process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL;
  if (configured) return String(configured).replace(/\/$/, "");
  const origin = getOrigin(request);
  try {
    const url = new URL(origin);
    if (["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "5194") url.port = "5192";
    return url.origin;
  } catch {
    return origin;
  }
}

export function oauthReturnTarget(request, value) {
  const fallback = `${frontendOrigin(request)}/#verify`;
  try {
    const target = new URL(String(value || fallback), fallback);
    if (!["http:", "https:"].includes(target.protocol)) return fallback;
    const frontend = new URL(frontendOrigin(request));
    const localPair = ["127.0.0.1", "localhost"].includes(frontend.hostname)
      && ["127.0.0.1", "localhost"].includes(target.hostname);
    return target.origin === frontend.origin || localPair ? target.toString() : fallback;
  } catch {
    return fallback;
  }
}

function redirectUri(request, provider) {
  const envValue = provider === "discord" ? process.env.DISCORD_REDIRECT_URI : process.env.X_REDIRECT_URI;
  return envValue || `${getOrigin(request)}/api/oauth?action=callback&provider=${provider}`;
}

function secret() {
  return process.env.OAUTH_STATE_SECRET || "ritual-proofgraph-local-dev-secret";
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

function seal(payload) {
  const body = base64Url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function unseal(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) throw new Error("Missing OAuth state cookie");
  const expected = sign(body);
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new Error("Invalid OAuth state");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function cookieHeader(request, value, maxAge = 600) {
  const secure = String(request.headers["x-forwarded-proto"] || "").includes("https");
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function linkMessage(provider, wallet, nonce) {
  return `Ritual ProofGraph social link\nProvider: ${provider}\nWallet: ${wallet}\nNonce: ${nonce}`;
}

function json(response, status, payload) {
  response.status(status).json(payload);
}

function redirect(response, url, cookie) {
  if (cookie) response.setHeader("set-cookie", cookie);
  response.writeHead(302, { location: url });
  response.end();
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return Object.fromEntries(new URLSearchParams(request.body));
    }
  }
  return {};
}

function configPayload() {
  const requiredRoleIds = discordRequiredRoleIds();
  const attestorRoleIds = discordAttestorRoleIds();
  return {
    discord: {
      enabled: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
      guildIdConfigured: Boolean(process.env.DISCORD_GUILD_ID),
      requiredRoleConfigured: requiredRoleIds.length > 0,
      requiredRoleCount: requiredRoleIds.length
    },
    attestor: {
      roleIds: attestorRoleIds,
      roleConfigured: attestorRoleIds.length > 0,
      roleCount: attestorRoleIds.length
    },
    x: {
      enabled: Boolean(process.env.X_CLIENT_ID),
      targetUserConfigured: Boolean(process.env.X_TARGET_USER_ID),
      targetTweetConfigured: Boolean(process.env.X_TARGET_TWEET_ID)
    },
    warning: process.env.OAUTH_STATE_SECRET ? "" : "Using local OAuth state secret. Set OAUTH_STATE_SECRET before production deploy."
  };
}

function discordRequiredRoleIds() {
  return discordRoleIds(process.env.DISCORD_REQUIRED_ROLE_ID, process.env.DISCORD_REQUIRED_ROLE_IDS);
}

function discordAttestorRoleIds() {
  return discordRoleIds(process.env.DISCORD_ATTESTOR_ROLE_ID, process.env.DISCORD_ATTESTOR_ROLE_IDS);
}

function discordRoleIds(...values) {
  return [
    ...values
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter((value, index, all) => /^\d{15,25}$/.test(value) && all.indexOf(value) === index);
}

async function start(request, response, provider) {
  const body = await readBody(request);
  const wallet = String(body.wallet || "").trim();
  const nonce = String(body.nonce || "").trim();
  const signature = String(body.signature || "").trim();
  const returnTo = oauthReturnTarget(request, body.returnTo);

  if (!["discord", "x"].includes(provider)) return json(response, 400, { error: "Unknown provider" });
  if (!isAddress(wallet) || !nonce || !signature) return json(response, 400, { error: "Wallet, nonce, and signature are required" });

  const recovered = verifyMessage(linkMessage(provider, wallet, nonce), signature);
  if (recovered.toLowerCase() !== wallet.toLowerCase()) return json(response, 401, { error: "Wallet signature does not match" });

  const cfg = configPayload();
  if (provider === "discord" && !cfg.discord.enabled) return json(response, 400, { error: "Discord OAuth env is missing" });
  if (provider === "x" && !cfg.x.enabled) return json(response, 400, { error: "X OAuth env is missing" });

  const state = crypto.randomBytes(24).toString("hex");
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const cookie = cookieHeader(
    request,
    seal({
      provider,
      state,
      wallet,
      nonce,
      signature,
      returnTo,
      codeVerifier,
      createdAt: Date.now()
    })
  );

  if (provider === "discord") {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri(request, "discord"),
      response_type: "code",
      scope: process.env.DISCORD_GUILD_ID ? "identify guilds.members.read" : "identify",
      prompt: "consent",
      state
    });
    response.setHeader("set-cookie", cookie);
    return json(response, 200, { url: `${DISCORD_AUTH}?${params.toString()}` });
  }

  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: redirectUri(request, "x"),
    response_type: "code",
    scope: "users.read tweet.read follows.read like.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });
  response.setHeader("set-cookie", cookie);
  return json(response, 200, { url: `${X_AUTH}?${params.toString()}` });
}

async function callback(request, response, provider) {
  let returnTo = oauthReturnTarget(request);
  try {
    const code = String(request.query?.code || "");
    const state = String(request.query?.state || "");
    const error = String(request.query?.error || "");
    if (error) throw new Error(error);
    if (!code || !state) throw new Error("Missing OAuth code or state");

    const cookie = parseCookies(request.headers.cookie)[COOKIE_NAME];
    const saved = unseal(cookie);
    returnTo = oauthReturnTarget(request, saved.returnTo);
    if (saved.provider !== provider || saved.state !== state) throw new Error("OAuth state mismatch");
    if (Date.now() - Number(saved.createdAt || 0) > 1000 * 60 * 10) throw new Error("OAuth state expired");

    const result = provider === "discord" ? await completeDiscord(request, code, saved) : await completeX(request, code, saved);
    return finish(request, response, returnTo, result);
  } catch (error) {
    return finish(request, response, returnTo, { provider, error: error.message || String(error), verifiedAt: Date.now() });
  }
}

async function completeDiscord(request, code, saved) {
  const token = await postForm(`${DISCORD_API}/oauth2/token`, {
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(request, "discord")
  });

  const user = await discordFetch("/users/@me", token.access_token);
  let member = null;
  let memberFetchError = "";
  if (process.env.DISCORD_GUILD_ID) {
    member = await discordFetch(`/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`, token.access_token).catch((error) => {
      memberFetchError = error.message || String(error);
      return null;
    });
  }

  const roles = Array.isArray(member?.roles) ? member.roles : [];
  const requiredRoleIds = discordRequiredRoleIds();
  const guildMember = process.env.DISCORD_GUILD_ID ? Boolean(member?.user || member?.roles) : true;
  const matchedRoleIds = requiredRoleIds.filter((roleId) => roles.includes(roleId));
  const hasRequiredRole = requiredRoleIds.length ? matchedRoleIds.length > 0 : null;

  return {
    provider: "discord",
    wallet: saved.wallet,
    verifiedAt: Date.now(),
    user: {
      id: user.id,
      username: user.global_name || user.username,
      displayName: user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : ""
    },
    checks: {
      // A snapshot is accepted by the UI only when it was produced by the
      // current member endpoint. This prevents older cached role data from
      // being treated as a live Discord role list.
      roleSnapshotVersion: 2,
      identityVerified: true,
      guildMember,
      hasRequiredRole,
      matchedRoleIds,
      memberRoleIds: roles,
      memberFetchError,
      requiredRoleCount: requiredRoleIds.length,
      roleCount: roles.length
    },
    identityHash: id(`discord:${user.id}`),
    evidenceUri: `oauth://discord/${user.id}`
  };
}

async function completeX(request, code, saved) {
  const token = await xToken(request, code, saved.codeVerifier);
  const me = await xFetch("/users/me?user.fields=username,name,verified", token.access_token);
  const user = me.data;

  const followsTarget = process.env.X_TARGET_USER_ID ? await xUserFollows(user.id, process.env.X_TARGET_USER_ID, token.access_token) : null;
  const likedTargetTweet = process.env.X_TARGET_TWEET_ID ? await xUserLikedTweet(user.id, process.env.X_TARGET_TWEET_ID, token.access_token) : null;
  const referencedTargetTweet = process.env.X_TARGET_TWEET_ID ? await xUserReferencedTweet(user.id, process.env.X_TARGET_TWEET_ID, token.access_token) : null;

  return {
    provider: "x",
    wallet: saved.wallet,
    verifiedAt: Date.now(),
    user: {
      id: user.id,
      username: user.username,
      displayName: user.name,
      avatar: ""
    },
    checks: {
      identityVerified: true,
      followsTarget,
      likedTargetTweet,
      referencedTargetTweet
    },
    identityHash: id(`x:${user.id}`),
    evidenceUri: `oauth://x/${user.id}`
  };
}

async function postForm(url, fields, headers = {}) {
  const response = await externalFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || `OAuth token exchange failed: ${response.status}`);
  return payload;
}

async function discordFetch(path, accessToken) {
  const response = await externalFetch(`${DISCORD_API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Discord API failed: ${response.status}`);
  return payload;
}

async function xToken(request, code, codeVerifier) {
  const headers = {};
  if (process.env.X_CLIENT_SECRET) {
    headers.authorization = `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64")}`;
  }
  return postForm(
    `${X_API}/oauth2/token`,
    {
      client_id: process.env.X_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(request, "x"),
      code_verifier: codeVerifier
    },
    headers
  );
}

async function xFetch(path, accessToken) {
  const response = await externalFetch(`${X_API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.title || `X API failed: ${response.status}`);
  return payload;
}

async function xUserFollows(userId, targetUserId, accessToken) {
  let pagination = "";
  for (let page = 0; page < 3; page += 1) {
    const payload = await xFetch(`/users/${userId}/following?max_results=1000&user.fields=username${pagination}`, accessToken).catch(() => null);
    if (!payload) return null;
    if ((payload.data || []).some((user) => user.id === targetUserId)) return true;
    if (!payload.meta?.next_token) return false;
    pagination = `&pagination_token=${payload.meta.next_token}`;
  }
  return false;
}

async function xUserLikedTweet(userId, targetTweetId, accessToken) {
  const payload = await xFetch(`/users/${userId}/liked_tweets?max_results=100`, accessToken).catch(() => null);
  if (!payload) return null;
  return (payload.data || []).some((tweet) => tweet.id === targetTweetId);
}

async function xUserReferencedTweet(userId, targetTweetId, accessToken) {
  const payload = await xFetch(`/users/${userId}/tweets?max_results=100&tweet.fields=referenced_tweets,conversation_id`, accessToken).catch(() => null);
  if (!payload) return null;
  return (payload.data || []).some((tweet) =>
    (tweet.referenced_tweets || []).some((reference) => reference.id === targetTweetId)
  );
}

function finish(request, response, returnTo, result) {
  const currentOrigin = getOrigin(request);
  let targetOrigin = currentOrigin;
  try {
    targetOrigin = new URL(returnTo, currentOrigin).origin;
  } catch {
    // oauthReturnTarget already provides a validated fallback.
  }

  if (!result.error && result.provider === "discord" && targetOrigin !== currentOrigin) {
    const handoff = seal({
      kind: "discord-handoff",
      result,
      returnTo,
      expiresAt: Date.now() + 1000 * 60 * 2
    });
    const action = `${targetOrigin}/api/oauth?action=handoff`;
    response.setHeader("set-cookie", clearCookie());
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Ritual Quest OAuth</title></head>
<body>
<form id="oauth-handoff" method="post" action=${JSON.stringify(action)}>
  <input type="hidden" name="token" value=${JSON.stringify(handoff)}>
</form>
<script>document.getElementById("oauth-handoff").submit();</script>
OAuth complete. Returning to Ritual Quest...
</body></html>`);
    return;
  }

  return finishHere(request, response, returnTo, result);
}

function finishHere(request, response, returnTo, result) {
  const sessionCookie = createDiscordSessionCookie(request, result);
  response.setHeader("set-cookie", sessionCookie ? [clearCookie(), sessionCookie] : clearCookie());
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Ritual Quest OAuth</title></head>
<body>
<script>
  const result = ${JSON.stringify(result).replace(/</g, "\\u003c")};
  if (result.provider && !result.error) localStorage.setItem("proofgraph.oauth." + result.provider, JSON.stringify(result));
  if (result.error) localStorage.setItem("proofgraph.oauth.error", JSON.stringify(result));
  location.replace(${JSON.stringify(returnTo || "/#verify")});
</script>
OAuth complete. Returning to Ritual Quest...
</body></html>`);
}

async function completeHandoff(request, response) {
  try {
    const body = await readBody(request);
    const saved = unseal(body.token);
    if (saved.kind !== "discord-handoff" || Number(saved.expiresAt || 0) < Date.now()) {
      throw new Error("OAuth handoff expired");
    }
    const returnTo = oauthReturnTarget(request, saved.returnTo);
    return finishHere(request, response, returnTo, saved.result);
  } catch (error) {
    const returnTo = oauthReturnTarget(request);
    return finishHere(request, response, returnTo, {
      provider: "discord",
      error: error.message || String(error),
      verifiedAt: Date.now()
    });
  }
}

export default async function handler(request, response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("cache-control", "no-store");

  if (request.method === "OPTIONS") return response.status(204).end();

  const action = String(request.query?.action || "config");
  const provider = String(request.query?.provider || "");

  if (action === "config") return json(response, 200, configPayload());
  if (action === "start" && request.method === "POST") return start(request, response, provider);
  if (action === "callback" && request.method === "GET") return callback(request, response, provider);
  if (action === "handoff" && request.method === "POST") return completeHandoff(request, response);
  return json(response, 404, { error: "Unknown OAuth action" });
}
