import "dotenv/config";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { ethers } from "ethers";

if (!existsSync("artifacts/ProofReviewDecisions.json")) {
  await import("./compile.mjs");
}

const rpcUrl = process.env.RITUAL_RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
const registryAddress = process.env.VITE_PROOFGRAPH_ADDRESS;
if (!rpcUrl) throw new Error("Missing RITUAL_RPC_URL");
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Missing DEPLOYER_PRIVATE_KEY.");
if (!registryAddress || !ethers.isAddress(registryAddress)) throw new Error("Missing VITE_PROOFGRAPH_ADDRESS.");

const chainId = Number(process.env.RITUAL_CHAIN_ID || 1979);
const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
const wallet = new ethers.Wallet(privateKey, provider);
const artifact = JSON.parse(await fs.readFile("artifacts/ProofReviewDecisions.json", "utf8"));
const initialAttestor = process.env.INITIAL_ATTESTOR && ethers.isAddress(process.env.INITIAL_ATTESTOR)
  ? process.env.INITIAL_ATTESTOR
  : wallet.address;
const registry = new ethers.Contract(
  registryAddress,
  ["function owner() view returns (address)", "function setAttestor(address attestor, bool trusted)"],
  wallet
);

const registryOwner = await registry.owner();
if (registryOwner.toLowerCase() !== wallet.address.toLowerCase()) {
  throw new Error(`Deployer ${wallet.address} is not the ProofGraphRegistry owner ${registryOwner}.`);
}

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployRequest = await factory.getDeployTransaction(registryAddress, initialAttestor);
const gasEstimate = await wallet.estimateGas(deployRequest);
const feeData = await provider.getFeeData();
const balance = await provider.getBalance(wallet.address);

console.log(`Deployer: ${wallet.address}`);
console.log(`Balance: ${ethers.formatEther(balance)} RITUAL`);
console.log(`Estimated coordinator deploy gas: ${gasEstimate}`);
if (feeData.gasPrice) console.log(`Estimated deploy fee: ${ethers.formatEther(gasEstimate * feeData.gasPrice)} RITUAL`);
if (process.argv.includes("--estimate-only")) {
  console.log("Estimate only. No transaction was sent.");
  process.exit(0);
}

const decisions = await factory.deploy(registryAddress, initialAttestor);
const deployTx = decisions.deploymentTransaction();
await decisions.waitForDeployment();
const decisionsAddress = await decisions.getAddress();
const deployReceipt = deployTx ? await provider.getTransactionReceipt(deployTx.hash) : null;

const grantTx = await registry.setAttestor(decisionsAddress, true);
await grantTx.wait();
let revokeTxHash = "";
if ((process.env.REVOKE_DIRECT_REGISTRY_ATTESTOR || "true").toLowerCase() === "true") {
  const revokeTx = await registry.setAttestor(wallet.address, false);
  await revokeTx.wait();
  revokeTxHash = revokeTx.hash;
}

const deployment = {
  contract: "ProofReviewDecisions",
  address: decisionsAddress,
  deployTx: deployTx?.hash,
  deployBlock: deployReceipt?.blockNumber,
  registry: registryAddress,
  coordinatorGrantTx: grantTx.hash,
  directAttestorRevokeTx: revokeTxHash,
  deployer: wallet.address,
  initialAttestor,
  gasUsed: deployReceipt?.gasUsed?.toString(),
  chainId
};
await fs.writeFile("deploy-review-decisions.json", JSON.stringify(deployment, null, 2));
console.log(JSON.stringify(deployment, null, 2));
