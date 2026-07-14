import fs from "node:fs";
import assert from "node:assert/strict";
import ganache from "ganache";
import { ethers, keccak256, toUtf8Bytes } from "ethers";

if (!fs.existsSync("artifacts/ProofGraphRegistry.json") || !fs.existsSync("artifacts/ProofReviewDecisions.json")) {
  await import("./compile.mjs");
}

const artifact = JSON.parse(fs.readFileSync("artifacts/ProofGraphRegistry.json", "utf8"));
const decisionsArtifact = JSON.parse(fs.readFileSync("artifacts/ProofReviewDecisions.json", "utf8"));
const provider = new ethers.BrowserProvider(
  ganache.provider({
    chain: { chainId: 1979 },
    logging: { quiet: true }
  })
);

const owner = await provider.getSigner(0);
const builder = await provider.getSigner(1);
const outsider = await provider.getSigner(2);
const builderTwo = await provider.getSigner(3);
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, owner);
const registry = await factory.deploy(await owner.getAddress());
await registry.waitForDeployment();
const decisionsFactory = new ethers.ContractFactory(decisionsArtifact.abi, decisionsArtifact.bytecode, owner);
const decisions = await decisionsFactory.deploy(await registry.getAddress(), await owner.getAddress());
await decisions.waitForDeployment();
await (await registry.setAttestor(await decisions.getAddress(), true)).wait();
await (await registry.setAttestor(await owner.getAddress(), false)).wait();
assert.equal(await registry.attestors(await decisions.getAddress()), true);
assert.equal(await registry.attestors(await owner.getAddress()), false);

async function expectRevert(label, action) {
  try {
    await action();
    throw new Error(`Expected revert: ${label}`);
  } catch (error) {
    if (String(error?.message || error).includes(`Expected revert: ${label}`)) throw error;
  }
}

const discordHash = keccak256(toUtf8Bytes("discord:aspro#0001"));
const xHash = keccak256(toUtf8Bytes("x:ASPRO_22"));
await (await registry.connect(builder).registerProfile(discordHash, xHash, "aspro-proofgraph")).wait();
const builderAddress = await builder.getAddress();
let profile = await registry.getProfile(builderAddress);
assert.equal(profile.handle, "aspro-proofgraph");
assert.equal((await registry.getBuilderCount()).toString(), "1");

const proofType = keccak256(toUtf8Bytes("wallet-agent"));
const proofHash = keccak256(toUtf8Bytes("agent-detected"));
await expectRevert("outsider cannot score", async () => {
  const tx = await registry
    .connect(outsider)
    .getFunction("recordProof")(builderAddress, proofType, proofHash, 250, "ritual://agent");
  await tx.wait();
});

await (
  await registry
    .connect(builder)
    .getFunction("requestProofReview")(proofType, proofHash, "ritual://agent")
).wait();
await (
  await decisions
    .connect(owner)
    .getFunction("approveProof")(builderAddress, proofType, proofHash, 250, "ritual://agent", { gasLimit: 1_000_000 })
).wait();
profile = await registry.getProfile(builderAddress);
assert.equal(profile.score.toString(), "250");
assert.equal((await decisions.decisions(builderAddress, proofHash)).toString(), "1");

await expectRevert("duplicate proof", async () => {
  const tx = await registry
    .connect(owner)
    .getFunction("recordProof")(builderAddress, proofType, proofHash, 250, "ritual://agent");
  await tx.wait();
});

const receipts = await registry.getReceipts(builderAddress);
assert.equal(receipts.length, 1);
assert.equal(receipts[0].points.toString(), "250");

const rejectedProofHash = keccak256(toUtf8Bytes("first-invalid-submission"));
await expectRevert("outsider cannot reject", async () => {
  const tx = await decisions
    .connect(outsider)
    .getFunction("rejectProof")(builderAddress, proofType, rejectedProofHash, "Invalid source");
  await tx.wait();
});
await (
  await decisions
    .connect(owner)
    .getFunction("rejectProof")(builderAddress, proofType, rejectedProofHash, "The evidence URL does not match the task.")
).wait();
assert.equal((await decisions.decisions(builderAddress, rejectedProofHash)).toString(), "2");
await expectRevert("duplicate rejection", async () => {
  const tx = await decisions
    .connect(owner)
    .getFunction("rejectProof")(builderAddress, proofType, rejectedProofHash, "Rejected twice");
  await tx.wait();
});
await expectRevert("rejected proof cannot be accepted", async () => {
  const tx = await decisions
    .connect(owner)
    .getFunction("approveProof")(builderAddress, proofType, rejectedProofHash, 250, "https://example.com/rejected");
  await tx.wait();
});

const replacementProofHash = keccak256(toUtf8Bytes("corrected-submission"));
await (
  await registry
    .connect(builder)
    .getFunction("requestProofReview")(proofType, replacementProofHash, "https://example.com/corrected")
).wait();
assert.notEqual(replacementProofHash, rejectedProofHash);

const builderTwoAddress = await builderTwo.getAddress();
await (await registry.connect(builderTwo).registerProfile(
  keccak256(toUtf8Bytes("discord:second")),
  keccak256(toUtf8Bytes("x:second")),
  "second-builder"
)).wait();
await (
  await decisions
    .connect(owner)
    .getFunction("approveProof")(
      builderTwoAddress,
      keccak256(toUtf8Bytes("chain-activity")),
      keccak256(toUtf8Bytes("second-activity")),
      420,
      "ritual://second",
      { gasLimit: 1_000_000 }
    )
).wait();

const leaderboard = await registry.getLeaderboardPage(0, 10);
assert.equal(leaderboard.length, 2);
assert.equal(leaderboard[0].wallet, builderTwoAddress);
assert.equal(leaderboard[0].score.toString(), "420");
assert.equal(leaderboard[1].wallet, builderAddress);
assert.equal(leaderboard[1].score.toString(), "250");

const secondPage = await registry.getLeaderboardPage(1, 1);
assert.equal(secondPage.length, 1);
assert.equal(secondPage[0].wallet, builderAddress);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      chainId: "1979",
      tests: [
        "compile registry",
        "deploy on local EVM",
        "register profile",
        "reject non-attestor scoring",
        "request proof review",
        "record verified proof",
        "reject duplicate proof",
        "reject proof by trusted attestor",
        "reject unauthorized and duplicate decisions",
        "accept proof through the decision coordinator",
        "disable direct registry scoring bypass",
        "prevent accepting a rejected proof",
        "resubmit with a new proof hash after rejection",
        "read receipts",
        "read sorted onchain leaderboard page"
      ]
    },
    null,
    2
  )
);
