import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDiscordSessionCookie, readDiscordSession } from "../api/discord-session.js";

const managerRoleIds = [
  "1349043996114161704", // Event Manager
  "1430908117331218442", // Radiant Ritualist
  "1339006464139984906", // Ritualist
  "1218322564573822986" // Mods
];

const knownRoles = new Map([
  ["1349043996114161704", "Event Manager"],
  ["1430908117331218442", "Radiant Ritualist"],
  ["1218322564573822986", "Mods"],
  ["1339006464139984906", "Ritualist"],
  ["1430904963340566661", "ritty"],
  ["1339080087558950922", "Forerunner"],
  ["1430904348757725325", "bitty"],
  ["1339625125162520656", "Mage"],
  ["1210469665541984257", "Server Booster"],
  ["1311411636367527976", "Blessed"],
  ["1349829585461706792", "Ascendant"],
  ["1516137404342337628", "Academy Trainer"],
  ["1212485735039508561", "Initiate"],
  ["1410218208069423115", "NPC"],
  ["1332395598233735299", "insights"],
  ["1244817463502307382", "Ticket Support"],
  ["1349063171033530469", "Events"],
  ["1349063327745179708", "Workshops"],
  ["1350157308365246484", "DevUpdates"],
  ["1350157472672776192", "Official"],
  ["1350157558148497508", "Community"],
  ["1511785201687072889", "Active"],
  ["1514370417568256021", "Gifted"],
  ["1518706523948187830", "Genesis 1000"],
  ["1358735073930772550", "Pledge Initiated"],
  ["1389560311236792350", "Allegiance Encoded"],
  ["1395158156702781531", "#MyRitualChain"]
]);

function envList(source, key) {
  const match = source.match(new RegExp(`^${key}=["']?([^"'\\r\\n]+)`, "m"));
  return match ? match[1].split(",").map((value) => value.trim()).filter(Boolean) : [];
}

const source = await readFile(new URL("../src/quest-app.ts", import.meta.url), "utf8");
for (const [roleId, roleName] of knownRoles) {
  assert.ok(source.includes(`["${roleId}", "${roleName}"`), `${roleName} must map to ${roleId}`);
}
assert.doesNotMatch(source, /roles\.slice\(0,\s*18\)/, "The passport must not truncate Discord roles");
assert.match(source, /\.filter\(\(roleId\) => \/\^\\d\{15,25\}\$\/\.test\(roleId\) && roleById\.has\(roleId\)\)/, "The passport must show only configured Discord roles");
assert.doesNotMatch(source, /Discord role \$\{roleId\.slice/, "Unknown Discord roles must not receive a visible fallback label");

for (const envName of [".env", ".env.local"]) {
  const env = await readFile(new URL(`../${envName}`, import.meta.url), "utf8");
  for (const key of [
    "DISCORD_ATTESTOR_ROLE_IDS",
    "DISCORD_CAMPAIGN_MANAGER_ROLE_IDS",
    "DISCORD_EVENT_MANAGER_ROLE_IDS"
  ]) {
    assert.deepEqual(envList(env, key), managerRoleIds, `${key} in ${envName} must match the approved roles`);
  }
}

process.env.OAUTH_STATE_SECRET = "discord-role-regression-secret";
const roleSnapshot = [...knownRoles.keys(), "999999999999999999"];
const request = { headers: { "x-forwarded-proto": "https" } };
const cookie = createDiscordSessionCookie(request, {
  provider: "discord",
  wallet: "0xf6d02F13D7BB5fC24aB6A3D662619641958A3Cf6",
  user: { id: "782672931615539261", username: "ASPRO404" },
  checks: { memberRoleIds: roleSnapshot }
});

assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Lax/);
assert.match(cookie, /Secure/);
const session = readDiscordSession({ headers: { cookie: cookie.split(";")[0] } });
assert.deepEqual(session.roles, roleSnapshot, "The signed session must preserve every role returned by Discord");
assert.equal(session.wallet, "0xf6d02f13d7bb5fc24ab6a3d662619641958a3cf6");

const cookiePair = cookie.split(";")[0];
const tampered = `${cookiePair.slice(0, -1)}${cookiePair.endsWith("a") ? "b" : "a"}`;
assert.equal(readDiscordSession({ headers: { cookie: tampered } }), null, "A modified Discord session must be rejected");

console.log(`Discord role audit passed: ${knownRoles.size} mapped roles, ${managerRoleIds.length} privileged roles.`);
