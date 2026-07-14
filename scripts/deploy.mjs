import "dotenv/config";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { ethers } from "ethers";

if (!existsSync("artifacts/ProofGraphRegistry.json")) {
  await import("./compile.mjs");
}

const rpcUrl = process.env.RITUAL_RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!rpcUrl) throw new Error("Missing RITUAL_RPC_URL");
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("Missing DEPLOYER_PRIVATE_KEY. It must be 0x + 64 hex chars.");
}

const chainId = Number(process.env.RITUAL_CHAIN_ID || 1979);
const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
const wallet = new ethers.Wallet(privateKey, provider);
const artifact = JSON.parse(await fs.readFile("artifacts/ProofGraphRegistry.json", "utf8"));
const initialAttestor = process.env.INITIAL_ATTESTOR && ethers.isAddress(process.env.INITIAL_ATTESTOR)
  ? process.env.INITIAL_ATTESTOR
  : wallet.address;

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
const deployRequest = await factory.getDeployTransaction(initialAttestor);
const gasEstimate = await wallet.estimateGas(deployRequest);
const gasPrice = await provider.getFeeData();
const balance = await provider.getBalance(wallet.address);

console.log(`Deployer: ${wallet.address}`);
console.log(`Balance: ${ethers.formatEther(balance)} RITUAL`);
console.log(`Estimated deploy gas: ${gasEstimate}`);
if (gasPrice.gasPrice) console.log(`Estimated fee: ${ethers.formatEther(gasEstimate * gasPrice.gasPrice)} RITUAL`);

const contract = await factory.deploy(initialAttestor);
const tx = contract.deploymentTransaction();
console.log(`Deploy tx: ${tx?.hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();
const receipt = tx ? await provider.getTransactionReceipt(tx.hash) : null;
console.log(`ProofGraphRegistry: ${address}`);

await fs.writeFile(
  "deploy-proofgraph.json",
  JSON.stringify(
    {
      contract: "ProofGraphRegistry",
      address,
      deployTx: tx?.hash,
      deployer: wallet.address,
      initialAttestor,
      gasUsed: receipt?.gasUsed?.toString(),
      chainId
    },
    null,
    2
  )
);
