import crypto from "node:crypto";

export const DISCORD_SESSION_COOKIE = "proofgraph_discord_session";

function sessionSecret() {
  return process.env.OAUTH_STATE_SECRET || "ritual-proofgraph-local-dev-secret";
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function seal(payload) {
  const body = base64Url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function unseal(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  const received = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function cookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

export function canUseDiscordSessions() {
  return Boolean(process.env.OAUTH_STATE_SECRET);
}

export function canUseEventSessions() {
  return canUseDiscordSessions();
}

export function createDiscordSessionCookie(request, result) {
  if (!canUseDiscordSessions() || result?.provider !== "discord" || !result?.user?.id) return "";
  const secure = String(request.headers["x-forwarded-proto"] || "").includes("https");
  const wallet = /^0x[a-fA-F0-9]{40}$/.test(String(result.wallet || "")) ? String(result.wallet).toLowerCase() : "";
  const payload = {
    provider: "discord",
    wallet,
    user: {
      id: String(result.user.id),
      username: String(result.user.username || "")
    },
    roles: Array.isArray(result.checks?.memberRoleIds) ? result.checks.memberRoleIds.map(String) : [],
    verifiedAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 8
  };
  return `${DISCORD_SESSION_COOKIE}=${encodeURIComponent(seal(payload))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`;
}

export function readDiscordSession(request) {
  if (!canUseDiscordSessions()) return null;
  const payload = unseal(cookies(request.headers.cookie)[DISCORD_SESSION_COOKIE]);
  if (!payload || payload.provider !== "discord" || !payload.user?.id || Number(payload.expiresAt || 0) < Date.now()) return null;
  return {
    wallet: /^0x[a-fA-F0-9]{40}$/.test(String(payload.wallet || "")) ? String(payload.wallet).toLowerCase() : "",
    user: { id: String(payload.user.id), username: String(payload.user.username || "") },
    roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
    verifiedAt: Number(payload.verifiedAt || 0)
  };
}
