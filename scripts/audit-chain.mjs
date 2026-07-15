import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { Contract, JsonRpcProvider, Wallet, formatEther, isAddress } from "ethers";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const registryDeployment = JSON.parse(await readFile("deploy-proofgraph.json", "utf8"));
const decisionsDeployment = JSON.parse(await readFile("deploy-review-decisions.json", "utf8"));
const rpcUrl = String(process.env.RITUAL_RPC_URL || process.env.VITE_RITUAL_RPC_URL || "");
const chainId = Number(process.env.RITUAL_CHAIN_ID || process.env.VITE_RITUAL_CHAIN_ID || 1979);
const registryAddress = String(process.env.VITE_PROOFGRAPH_ADDRESS || "");
const decisionsAddress = String(process.env.VITE_REVIEW_DECISIONS_ADDRESS || "");
const relayerKey = String(process.env.REVIEW_RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "");

assert.match(rpcUrl, /^https:\/\//, "Ritual RPC must use HTTPS");
assert.equal(chainId, 1979, "Ritual testnet chain ID must be 1979");
assert.ok(isAddress(registryAddress), "Registry address is missing");
assert.ok(isAddress(decisionsAddress), "Decision coordinator address is missing");
assert.equal(registryAddress.toLowerCase(), registryDeployment.address.toLowerCase());
assert.equal(decisionsAddress.toLowerCase(), decisionsDeployment.address.toLowerCase());

const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
const network = await provider.getNetwork();
assert.equal(Number(network.chainId), 1979);

const registryCode = await provider.getCode(registryAddress);
const decisionsCode = await provider.getCode(decisionsAddress);
assert.ok(registryCode.length > 100, "Registry has no runtime bytecode");
assert.ok(decisionsCode.length > 100, "Decision coordinator has no runtime bytecode");

const registry = new Contract(registryAddress, [
  "function owner() view returns (address)",
  "function attestors(address) view returns (bool)"
], provider);
const decisions = new Contract(decisionsAddress, [
  "function owner() view returns (address)",
  "function attestors(address) view returns (bool)"
], provider);
const expectedRelayer = /^0x[0-9a-f]{64}$/i.test(relayerKey)
  ? new Wallet(relayerKey).address
  : decisionsDeployment.initialAttestor;
assert.ok(isAddress(expectedRelayer), "Expected review relayer address is missing");

assert.equal((await registry.owner()).toLowerCase(), registryDeployment.deployer.toLowerCase());
assert.equal((await decisions.owner()).toLowerCase(), decisionsDeployment.deployer.toLowerCase());
assert.equal(await registry.attestors(decisionsAddress), true, "Decision coordinator is not trusted by the registry");
assert.equal(await registry.attestors(registryDeployment.deployer), false, "Direct registry scoring bypass is still enabled");
assert.equal(await decisions.attestors(expectedRelayer), true, "Review relayer is not an authorized decision attestor");

let confirmedHistoricalTransactions = 0;
for (const hash of [
  registryDeployment.deployTx,
  decisionsDeployment.deployTx,
  decisionsDeployment.coordinatorGrantTx,
  decisionsDeployment.directAttestorRevokeTx
]) {
  const receipt = await provider.getTransactionReceipt(hash);
  if (receipt) {
    assert.equal(receipt.status, 1, `Transaction ${hash} was not confirmed successfully`);
    confirmedHistoricalTransactions += 1;
  }
}

const balance = await provider.getBalance(expectedRelayer);
assert.ok(balance > 0n, "Review relayer has no testnet balance");

console.log(JSON.stringify({
  status: "PASS",
  chainId: Number(network.chainId),
  registry: registryAddress,
  decisions: decisionsAddress,
  relayer: expectedRelayer,
  relayerBalance: `${formatEther(balance)} RITUAL`,
  confirmedHistoricalTransactions,
  checks: [
    "runtime bytecode present",
    "deployment and authorization transactions confirmed",
    "decision coordinator trusted",
    "direct registry scoring disabled",
    "review relayer authorized and funded"
  ]
}, null, 2));
