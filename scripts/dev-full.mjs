import { spawn } from "node:child_process";
import path from "node:path";

const api = spawn(process.execPath, ["scripts/api-server.mjs"], {
  stdio: "inherit",
  env: { ...process.env, API_PORT: process.env.API_PORT || "5194" }
});

const viteBin = path.join("node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", process.env.PORT || "5192", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env }
});

function stop(code = 0) {
  api.kill();
  vite.kill();
  process.exit(code);
}

api.on("exit", (code) => {
  if (code) stop(code);
});

vite.on("exit", (code) => {
  if (code) stop(code);
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
