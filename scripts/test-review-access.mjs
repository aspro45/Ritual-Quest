import assert from "node:assert/strict";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import reviews, { hasWalletAuthorization, reviewAuthorizationMessage } from "../api/reviews.js";

const reviewer = Wallet.createRandom();
process.env.DISCORD_ATTESTOR_WALLETS = reviewer.address;

function responseMock() {
  return {
    statusCode: 200,
    headers: new Map(),
    body: "",
    setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = JSON.stringify(payload); return this; },
    end(payload = "") { this.body = String(payload); return this; }
  };
}

const getResponse = responseMock();
await reviews({ method: "GET", query: { wallet: reviewer.address }, headers: {} }, getResponse);
assert.equal(getResponse.statusCode, 200);
assert.equal(JSON.parse(getResponse.body).canReview, true);

const taskId = "builder-launch:build-log";
const values = {
  action: "accept",
  reviewerWallet: reviewer.address.toLowerCase(),
  builder: Wallet.createRandom().address,
  proofType: keccak256(toUtf8Bytes(`proofgraph:${taskId}`)),
  proofHash: keccak256(toUtf8Bytes("review-access-test")),
  taskId,
  evidenceUri: "https://github.com/aspro45/Ritual-Quest",
  reason: ""
};
const authorizationExpiresAt = Date.now() + 60_000;
const reviewerSignature = await reviewer.signMessage(reviewAuthorizationMessage(values, authorizationExpiresAt));
assert.equal(
  hasWalletAuthorization({ authorizationExpiresAt, reviewerSignature }, values, [reviewer.address.toLowerCase()]),
  true
);
assert.equal(
  hasWalletAuthorization({ authorizationExpiresAt, reviewerSignature }, values, [Wallet.createRandom().address.toLowerCase()]),
  false
);

console.log(JSON.stringify({ status: "PASS", tests: ["review wallet allowlist", "signed review authorization"] }));
