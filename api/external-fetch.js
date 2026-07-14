import { spawn } from "node:child_process";

class PortableResponse {
  constructor(status, body) {
    this.status = Number(status || 0);
    this.ok = this.status >= 200 && this.status < 300;
    this.body = String(body || "");
    this.headers = { get: () => null };
  }

  async text() {
    return this.body;
  }

  async json() {
    return JSON.parse(this.body || "null");
  }
}

const POWERSHELL_FETCH = String.raw`
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$headers = @{}
if ($payload.headers) {
  foreach ($property in $payload.headers.PSObject.Properties) {
    $headers[$property.Name] = [string]$property.Value
  }
}
$arguments = @{
  Uri = [string]$payload.url
  Method = [string]$payload.method
  Headers = $headers
  UseBasicParsing = $true
  TimeoutSec = 25
}
if ($null -ne $payload.body -and [string]$payload.body -ne "") {
  $arguments.Body = [string]$payload.body
}
try {
  $result = Invoke-WebRequest @arguments
  $output = @{ status = [int]$result.StatusCode; body = [string]$result.Content }
} catch {
  $status = 0
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $status = [int]$_.Exception.Response.StatusCode
  }
  $body = [string]$_.ErrorDetails.Message
  if (-not $body) { $body = [string]$_.Exception.Message }
  $output = @{ status = $status; body = $body }
}
$output | ConvertTo-Json -Compress -Depth 4
`;

function powershellFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", POWERSHELL_FETCH],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 30_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `PowerShell transport exited with ${code}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout.trim());
        resolve(new PortableResponse(payload.status, payload.body));
      } catch {
        reject(new Error(stderr.trim() || "PowerShell transport returned invalid JSON"));
      }
    });

    const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
    child.stdin.end(JSON.stringify({
      url: String(url),
      method: String(options.method || "GET").toUpperCase(),
      headers,
      body: options.body == null ? "" : String(options.body)
    }));
  });
}

async function localBridgeFetch(url, options = {}) {
  const bridgeUrl = process.env.LOCAL_UPSTREAM_BRIDGE || "http://127.0.0.1:5195/fetch";
  const response = await fetch(bridgeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: String(url),
      method: String(options.method || "GET").toUpperCase(),
      headers: Object.fromEntries(new Headers(options.headers || {}).entries()),
      body: options.body == null ? "" : String(options.body)
    })
  });
  if (!response.ok) throw new Error(`Local upstream bridge returned ${response.status}`);
  const payload = await response.json();
  return new PortableResponse(payload.status, payload.body);
}

export async function externalFetch(url, options = {}) {
  try {
    return await fetch(url, options);
  } catch (error) {
    const canUseLocalBridge = process.platform === "win32" && !process.env.VERCEL;
    if (!canUseLocalBridge || options.signal?.aborted) throw error;
    try {
      return await localBridgeFetch(url, options);
    } catch {
      return powershellFetch(url, options);
    }
  }
}
