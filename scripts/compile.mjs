import fs from "node:fs/promises";
import path from "node:path";
import solc from "solc";

const contractNames = ["ProofGraphRegistry", "ProofReviewDecisions"];
const sources = Object.fromEntries(
  await Promise.all(contractNames.map(async (contractName) => {
    const sourcePath = path.join("contracts", `${contractName}.sol`);
    return [sourcePath, { content: await fs.readFile(sourcePath, "utf8") }];
  }))
);

const input = {
  language: "Solidity",
  sources,
  settings: {
    evmVersion: "paris",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"]
      }
    }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = output.errors?.filter((item) => item.severity === "error") ?? [];
if (errors.length) {
  console.error(errors.map((item) => item.formattedMessage).join("\n"));
  process.exit(1);
}

await fs.mkdir("artifacts", { recursive: true });
for (const contractName of contractNames) {
  const sourcePath = path.join("contracts", `${contractName}.sol`);
  const contract = output.contracts[sourcePath][contractName];
  await fs.writeFile(
    path.join("artifacts", `${contractName}.json`),
    JSON.stringify({ abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` }, null, 2)
  );
  console.log(`Compiled ${contractName}`);
}
