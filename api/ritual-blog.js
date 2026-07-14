import { externalFetch } from "./external-fetch.js";

const BLOG_INDEX = "https://www.ritualfoundation.org/blog";
const BLOG_ORIGIN = "https://www.ritualfoundation.org";
const CACHE_TTL_MS = 10 * 60 * 1000;

let cachedFeed;

const OFFICIAL_ARTICLE_SNAPSHOT = [
  {
    title: "Ritual Fellowship 2025 - A Program for the Next Generation of Crypto + AI Talent",
    excerpt: "Ritual is building the infrastructure for a new class of decentralized applications at the intersection of crypto x AI and beyond.",
    image: "https://cdn.sanity.io/images/cowr9u8f/production/0148f1634da07e75ad59b2feba6ac1660796b64d-2880x1616.png?rect=0,56,2880,1505&w=1200&h=627&fit=crop&auto=format",
    publishedAt: "2025-05-25",
    url: `${BLOG_ORIGIN}/blog/fellowship`
  },
  {
    title: "Ritual Shrine - Forging the Future of AI and Crypto",
    excerpt: "The convergence of AI and crypto represents one of the most promising frontiers in technology today.",
    image: "https://cdn.sanity.io/images/cowr9u8f/production/28a932f22f7ac12d8377e9dd1cfa72b68fa18534-2880x1616.png?rect=0,56,2880,1505&w=1200&h=627&fit=crop&auto=format",
    publishedAt: "2025-05-19",
    url: `${BLOG_ORIGIN}/blog/shrine`
  },
  {
    title: "Unveiling Ritual",
    excerpt: "A comprehensive look at Ritual Chain architecture and expressive onchain computation.",
    image: "https://cdn.sanity.io/images/cowr9u8f/production/04a5fa86edcd1d8197e986c3f8f20ab3e1cf45f3-1920x1080.webp?rect=0,39,1920,1003&w=1200&h=627&fit=crop&auto=format",
    publishedAt: "2025-02-26",
    url: `${BLOG_ORIGIN}/blog/unveiling-ritual`
  },
  {
    title: "Introducing Ritual Foundation",
    excerpt: "The launch of the independent foundation stewarding and accelerating Ritual Chain and its ecosystem.",
    image: "https://cdn.sanity.io/images/cowr9u8f/production/0030fa9015369128497049a9b4ff6c3219af1381-1920x1080.webp?rect=0,39,1920,1003&w=1200&h=627&fit=crop&auto=format",
    publishedAt: "2024-11-18",
    url: `${BLOG_ORIGIN}/blog/introducing-ritual-foundation`
  }
];

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2f;/gi, "/");
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || "");
}

function metaValue(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const expected = key.toLowerCase();
  const tag = tags.find((item) => {
    const property = attribute(item, "property").toLowerCase();
    const name = attribute(item, "name").toLowerCase();
    return property === expected || name === expected;
  });
  return tag ? attribute(tag, "content") : "";
}

function firstMatch(html, expression) {
  const match = html.match(expression);
  return match ? stripHtml(match[1]) : "";
}

function extractPostUrls(html) {
  const urls = new Set();
  for (const match of html.matchAll(/href\s*=\s*(["'])((?:https?:\/\/www\.ritualfoundation\.org)?\/blog\/[^"'?#]+)\1/gi)) {
    const path = match[2].replace(BLOG_ORIGIN, "").replace(/\/$/, "");
    if (path !== "/blog") urls.add(new URL(path, BLOG_ORIGIN).toString());
  }
  return [...urls].slice(0, 12);
}

function formatArticle(url, html) {
  const title = metaValue(html, "og:title") || firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || "Ritual Foundation article";
  const excerpt = metaValue(html, "og:description") || metaValue(html, "description") || "Read the full article from Ritual Foundation.";
  const image = metaValue(html, "og:image");
  const publishedAt = metaValue(html, "article:published_time") || firstMatch(html, /\b(\d{2}\/\d{2}\/\d{4})\b/);

  return {
    title: title.replace(/\s*\|\s*Ritual Foundation\s*$/i, "").trim(),
    excerpt,
    image,
    publishedAt,
    url
  };
}

async function fetchHtml(url) {
  const response = await externalFetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "RitualProofGraph/1.0 (+https://ritualfoundation.org)"
    },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Ritual Foundation returned ${response.status}`);
  return response.text();
}

async function readFeed(force = false) {
  if (!force && cachedFeed && Date.now() - cachedFeed.cachedAt < CACHE_TTL_MS) return cachedFeed;

  const indexHtml = await fetchHtml(BLOG_INDEX);
  const urls = extractPostUrls(indexHtml);
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const articleHtml = await fetchHtml(url);
      return formatArticle(url, articleHtml);
    })
  );
  const articles = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  if (!articles.length) throw new Error("No Ritual Foundation articles were found");

  const feed = {
    source: BLOG_INDEX,
    cachedAt: Date.now(),
    articles: articles.filter((article) => article.title)
  };
  cachedFeed = feed;
  return feed;
}

export default async function ritualBlog(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const requestUrl = new URL(request.url || "/api/ritual-blog", "http://localhost");
    const force = request.query?.refresh === "1" || requestUrl.searchParams.get("refresh") === "1";
    const feed = await readFeed(force);
    response.setHeader("cache-control", "public, max-age=120, s-maxage=600, stale-while-revalidate=600");
    response.status(200).json(feed);
  } catch (error) {
    response.setHeader("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
    response.status(200).json({
      source: BLOG_INDEX,
      cachedAt: Date.now(),
      stale: true,
      articles: cachedFeed?.articles?.length ? cachedFeed.articles : OFFICIAL_ARTICLE_SNAPSHOT,
      warning: error instanceof Error ? error.message : String(error)
    });
  }
}
