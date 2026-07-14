import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import walletProof from "../api/wallet-proof.js";
import oauth from "../api/oauth.js";
import ritualBlog from "../api/ritual-blog.js";
import calendar from "../api/calendar.js";
import campaigns from "../api/campaigns.js";
import reviews from "../api/reviews.js";

const port = Number(process.env.API_PORT || 5194);
const routes = new Map([
  ["/api/wallet-proof", walletProof],
  ["/api/oauth", oauth],
  ["/api/ritual-blog", ritualBlog],
  ["/api/calendar", calendar],
  ["/api/campaigns", campaigns],
  ["/api/reviews", reviews]
]);

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function responseAdapter(response) {
  const api = {
    setHeader(name, value) {
      response.setHeader(name, value);
      return api;
    },
    status(code) {
      response.statusCode = code;
      return api;
    },
    json(payload) {
      if (!response.headersSent) response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(payload));
    },
    writeHead(code, headers) {
      response.writeHead(code, headers);
      return api;
    },
    end(payload) {
      response.end(payload);
    }
  };
  return api;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const oauthPath = pathname.match(/^\/api\/oauth\/(config|start|callback)$/);
    const handler = routes.get(pathname) || (oauthPath ? oauth : undefined);
    if (!handler) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "API route not found" }));
      return;
    }

    const body = request.method === "POST" || request.method === "PUT" ? await readBody(request) : undefined;
    const query = Object.fromEntries(url.searchParams.entries());
    if (oauthPath && !query.action) query.action = oauthPath[1];
    await handler(
      {
        method: request.method,
        url: request.url,
        headers: request.headers,
        query,
        body
      },
      responseAdapter(response)
    );
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error.message || String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ProofGraph API listening on http://127.0.0.1:${port}`);
});
