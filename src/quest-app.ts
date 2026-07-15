import { Contract, JsonRpcProvider, ethers, formatEther, isAddress, keccak256, toUtf8Bytes } from "ethers";
import gsap from "gsap";
import { ArrowRight, AtSign, Check, CircleDashed, ExternalLink, Image as ImageIcon, LockKeyhole, MessageCircle, Pencil, Plus, Search, Send, Trash2, Users, X, createElement } from "lucide";
import * as THREE from "three";
import { parseAbi } from "viem";
import { getRainbowWallet, mountRainbowKit } from "./wallet-rainbow";
import "./quest.css";

type Route = "explore" | "campaign" | "identity" | "leaderboard" | "review" | "architecture" | "blog" | "calendar";
type TaskKind = "automatic" | "oauth-discord" | "review" | "self-attested";
type TaskStatus = "locked" | "open" | "checking" | "complete" | "pending";

type WalletProof = {
  address: string;
  explorerUrl: string;
  balance: string;
  balanceWei: string;
  transactionCount: number;
  explorerTransactionCount: number;
  contractDeployCount: number;
  recentActivity: boolean;
  nativeAgents: Array<{
    address: string;
    owner: string;
    source?: "explorer-cache" | "explorer-sovereign-cache" | "heartbeat-registry" | "deployment-history" | "sovereign-factory-deployment";
    state: string;
    isAlive: boolean;
    lastHeartbeatBlock: number;
    latestManifestCID: string;
    deploymentTx?: string;
    configurationTx?: string;
  }>;
  score: number;
  transactions: Array<{
    hash: string;
    blockNumber: number;
    timestamp: number;
    from: string;
    to: string;
    value: string;
    gasUsed: number;
    status: number;
    methodSelector: string;
  }>;
  source: { transactions: string; agents: string; rpc: string };
};

type Profile = {
  wallet: string;
  discordHash: string;
  xHash: string;
  handle: string;
  score: bigint;
  createdAt: bigint;
  updatedAt: bigint;
  active: boolean;
};

type Receipt = {
  proofType: string;
  proofHash: string;
  points: bigint;
  evidenceUri: string;
  attestor: string;
  createdAt: bigint;
};

type PendingReview = {
  builder: string;
  taskId: string;
  taskLabel: string;
  proofType: string;
  proofHash: string;
  evidenceUri: string;
  createdAt: number;
};

type ReviewRequest = {
  builder: string;
  proofType: string;
  proofHash: string;
  evidenceUri: string;
  blockNumber: number;
};

type ReviewRejection = {
  builder: string;
  proofType: string;
  proofHash: string;
  reason: string;
  attestor: string;
  blockNumber: number;
};

type OAuthConfig = {
  discord: { enabled: boolean; guildIdConfigured: boolean; requiredRoleConfigured: boolean; requiredRoleCount?: number };
  attestor: { roleIds: string[]; roleConfigured: boolean; roleCount: number };
  x: { enabled: boolean; targetUserConfigured: boolean; targetTweetConfigured: boolean };
  warning?: string;
};

type SocialProof = {
  provider: "discord" | "x";
  wallet: string;
  verifiedAt: number;
  user: { id: string; username: string; displayName?: string; avatar?: string };
  checks: Record<string, boolean | string | number | string[] | null>;
  identityHash: string;
  evidenceUri: string;
};

type RitualBlogArticle = {
  title: string;
  excerpt: string;
  image: string;
  publishedAt: string;
  url: string;
};

type RitualBlogFeed = {
  source: string;
  cachedAt: number;
  articles: RitualBlogArticle[];
};

type CalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  description: string;
  location: string;
  url: string;
  imageUrl: string;
  createdBy: string;
  createdAt: string;
  canManage: boolean;
};

type CalendarView = "schedule" | "week";
type CalendarFilter = "all" | "upcoming" | "completed";

type CalendarFeed = {
  configured: boolean;
  editorRoleConfigured: boolean;
  editorWalletConfigured: boolean;
  sessionConfigured: boolean;
  canCreate: boolean;
  source: string;
  notice?: string;
  events: CalendarEvent[];
};

type CalendarDraft = Pick<CalendarEvent, "title" | "startsAt" | "endsAt" | "description" | "location" | "url" | "imageUrl">;

type CampaignTask = {
  id: string;
  templateId?: string;
  label: string;
  points: number;
  kind: TaskKind;
  requirement: string;
  detail: string;
  evidencePlaceholder?: string;
  actionLabel?: string;
  actionUrl?: string;
  actionLinks?: Array<{ label: string; url: string }>;
  timerSeconds?: number;
};

type CustomSocialTask = {
  title: string;
  instructions: string;
  accounts: string[];
  posts: Array<{
    url: string;
    engagements: string[];
  }>;
  postUrl?: string;
  engagements?: string[];
  postPrompt: string;
  verification: "self-attested";
  timerSeconds: number;
};

type Campaign = {
  id: string;
  title: string;
  short: string;
  description: string;
  host: string;
  category: string;
  reward: string;
  badge: string;
  accent: "builder" | "agents" | "community" | "onchain" | "discord";
  tags: string[];
  tasks: CampaignTask[];
  imageUrl?: string;
  createdBy?: string;
  community?: boolean;
  taskIds?: string[];
  customTask?: CustomSocialTask | null;
  canManage?: boolean;
};

type CampaignApiItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  imageUrl: string;
  badge: string;
  taskIds: string[];
  customTask?: CustomSocialTask | null;
  createdBy: string;
  createdAt: string;
  canManage: boolean;
};

type CampaignDirectoryFeed = {
  configured: boolean;
  editorRoleConfigured: boolean;
  editorWalletConfigured: boolean;
  sessionConfigured: boolean;
  canCreate: boolean;
  notice?: string;
  campaigns: Campaign[];
};

const RITUAL_RPC_URL = import.meta.env.VITE_RITUAL_RPC_URL || "https://rpc.ritualfoundation.org";
const RITUAL_CHAIN_ID = Number(import.meta.env.VITE_RITUAL_CHAIN_ID || 1979);
const PROOFGRAPH_ADDRESS = import.meta.env.VITE_PROOFGRAPH_ADDRESS || "";
const configuredReviewStartBlock = Number(import.meta.env.VITE_PROOFGRAPH_REVIEW_START_BLOCK || 0);
const PROOFGRAPH_REVIEW_START_BLOCK = Number.isSafeInteger(configuredReviewStartBlock) && configuredReviewStartBlock > 0 ? configuredReviewStartBlock : 0;
const REVIEW_DECISIONS_ADDRESS = import.meta.env.VITE_REVIEW_DECISIONS_ADDRESS || "";
const configuredDecisionStartBlock = Number(import.meta.env.VITE_REVIEW_DECISIONS_START_BLOCK || 0);
const REVIEW_DECISIONS_START_BLOCK = Number.isSafeInteger(configuredDecisionStartBlock) && configuredDecisionStartBlock > 0 ? configuredDecisionStartBlock : 0;
const EXPLORER_BASE = "https://explorer.ritualfoundation.org";
const AGENT_HEARTBEAT_ADDRESS = "0xef505e801f1db392b5289690e2ffc20e840a3aca";
const MAX_AGENT_REGISTRY_SCAN = 512;
const HERO_ART = "/assets/signal-atlas-hero.png";
const LOGO = "/assets/ritual-logo-mark.png";
const CATEGORY_ART: Record<string, string> = {
  All: HERO_ART,
  Builder: "/assets/category-builder-foundry.png",
  Agents: "/assets/category-agents-scheduler.png",
  Community: "/assets/category-community-signal.png",
  Onchain: "/assets/category-onchain-ledger.png",
  Discord: "/assets/category-discord-gate.png"
};
const FILTER_CHIPS = ["All", "Builder", "Agents", "Community", "Onchain", "Discord"];
const CREATOR_TASK_IDS = ["chain-activity", "contract-deploy", "native-agent", "discord-oath", "x-proof", "x-follow", "blog-insight", "build-log", "agent-update"];

const registryAbi = [
  "function registerProfile(bytes32 discordHash, bytes32 xHash, string handle)",
  "function requestProofReview(bytes32 proofType, bytes32 proofHash, string evidenceUri)",
  "function recordProof(address builder, bytes32 proofType, bytes32 proofHash, uint16 points, string evidenceUri)",
  "function attestors(address) view returns (bool)",
  "function getProfile(address builder) view returns (tuple(address wallet, bytes32 discordHash, bytes32 xHash, string handle, uint256 score, uint64 createdAt, uint64 updatedAt, bool active))",
  "function getReceipts(address builder) view returns (tuple(bytes32 proofType, bytes32 proofHash, uint16 points, string evidenceUri, address attestor, uint64 createdAt)[])",
  "function getBuilderCount() view returns (uint256)",
  "function getBuilderAt(uint256 index) view returns (address)",
  "function getLeaderboardPage(uint256 offset, uint256 limit) view returns (tuple(address wallet, bytes32 discordHash, bytes32 xHash, string handle, uint256 score, uint64 createdAt, uint64 updatedAt, bool active)[])",
  "event ProofReviewRequested(address indexed builder, bytes32 indexed proofType, bytes32 indexed proofHash, string evidenceUri)",
  "event ProofRecorded(address indexed builder, bytes32 indexed proofType, bytes32 indexed proofHash, uint16 points, address attestor)"
];
const registryWriteAbi = parseAbi([
  "function registerProfile(bytes32 discordHash, bytes32 xHash, string handle)",
  "function requestProofReview(bytes32 proofType, bytes32 proofHash, string evidenceUri)",
  "function recordProof(address builder, bytes32 proofType, bytes32 proofHash, uint16 points, string evidenceUri)"
]);
const reviewDecisionsAbi = [
  "function attestors(address) view returns (bool)",
  "function decisions(address builder, bytes32 proofHash) view returns (uint8)",
  "event ProofAccepted(address indexed builder, bytes32 indexed proofType, bytes32 indexed proofHash, uint16 points, address attestor)",
  "event ProofRejected(address indexed builder, bytes32 indexed proofType, bytes32 indexed proofHash, string reason, address attestor)"
];

const roleMeta = [
  ["1349043996114161704", "Event Manager", "#f472b6"],
  ["1430908117331218442", "Radiant Ritualist", "#f4d20b"],
  ["1218322564573822986", "Mods", "#f3a6a6"],
  ["1339006464139984906", "Ritualist", "#35d36f"],
  ["1430904963340566661", "ritty", "#a78bfa"],
  ["1339080087558950922", "Forerunner", "#42a5f5"],
  ["1430904348757725325", "bitty", "#3498db"],
  ["1339625125162520656", "Mage", "#b56ad9"],
  ["1311411636367527976", "Blessed", "#c7a938"],
  ["1349829585461706792", "Ascendant", "#cfd6dc"],
  ["1212485735039508561", "Initiate", "#cfd6dc"],
  ["1410218208069423115", "NPC", "#79552f"],
  ["1511785201687072889", "Active", "#cfd6dc"],
  ["1514370417568256021", "Gifted", "#cfd6dc"],
  ["1518706523948187830", "Genesis 1000", "#cfd6dc"],
  ["1358735073930772550", "Pledged to Synful", "#cfd6dc"],
  ["1389560311236792350", "Simplified", "#cfd6dc"],
  ["1395158156702781531", "#MyRitualChain", "#cfd6dc"],
  ["1210469665541984257", "Server Booster", "#d946ef"],
  ["1516137404342337628", "Academy Trainer", "#cfd6dc"],
  ["1332395598233735299", "insights", "#cfd6dc"],
  ["1244817463502307382", "Ticket Support", "#607d8b"],
  ["1349063171033530469", "Events", "#e91e63"],
  ["1349063327745179708", "Workshops", "#f04d43"],
  ["1350157308365246484", "DevUpdates", "#f1c40f"],
  ["1350157472672776192", "Official", "#35d36f"],
  ["1350157558148497508", "Community", "#3498db"]
].map(([id, name, color]) => ({ id, name, color }));

const roleById = new Map(roleMeta.map((role) => [role.id, role]));

const taskBook: Record<string, CampaignTask> = {
  "wallet-link": {
    id: "wallet-link",
    label: "Connect wallet",
    points: 50,
    kind: "automatic",
    requirement: "Ritual Chain 1979",
    detail: "Connect the wallet you want to use for this campaign."
  },
  "chain-activity": {
    id: "chain-activity",
    label: "Make a transaction",
    points: 110,
    kind: "automatic",
    requirement: "At least 1 transaction",
    detail: "We check this wallet for activity on Ritual Chain."
  },
  "contract-deploy": {
    id: "contract-deploy",
    label: "Deploy a contract",
    points: 220,
    kind: "automatic",
    requirement: "At least 1 contract",
    detail: "We check whether this wallet deployed a smart contract."
  },
  "native-agent": {
    id: "native-agent",
    label: "Deploy an agent",
    points: 360,
    kind: "automatic",
    requirement: "Agent registry match",
    detail: "We look for a Ritual agent deployed by this wallet. Paused agents still count."
  },
  "discord-oath": {
    id: "discord-oath",
    label: "Connect Discord",
    points: 140,
    kind: "oauth-discord",
    requirement: "Discord OAuth",
    detail: "Sign in with Discord so we can read your Ritual server roles."
  },
  "x-proof": {
    id: "x-proof",
    label: "Post about Ritual",
    points: 130,
    kind: "review",
    requirement: "Public X post",
    detail: "Write an original post about Ritual, publish it, then paste the public post URL.",
    evidencePlaceholder: "https://x.com/your-handle/status/...",
    actionLabel: "Write post on X",
    actionUrl: "https://x.com/intent/post?text=I%20have%20been%20exploring%20%40ritualnet.%20One%20thing%20I%20learned%20about%20sovereign%20AI%20agents%20is%3A%20"
  },
  "x-follow": {
    id: "x-follow",
    label: "Follow Ritual on X",
    points: 90,
    kind: "review",
    requirement: "Follow @ritualnet",
    detail: "Follow Ritual on X, then paste your public X profile for reviewer verification.",
    evidencePlaceholder: "https://x.com/your-handle",
    actionLabel: "Open @ritualnet",
    actionUrl: "https://x.com/ritualnet"
  },
  "blog-insight": {
    id: "blog-insight",
    label: "Share a blog insight",
    points: 160,
    kind: "review",
    requirement: "Article link + public takeaway",
    detail: "Read one Ritual article and publish one specific takeaway with the article link on X.",
    evidencePlaceholder: "https://x.com/your-handle/status/...",
    actionLabel: "Read Ritual blog",
    actionUrl: "https://www.ritualfoundation.org/blog"
  },
  "build-log": {
    id: "build-log",
    label: "Submit your project",
    points: 410,
    kind: "review",
    requirement: "GitHub or docs link",
    detail: "Submit one public project link. Points are added after a reviewer approves it.",
    evidencePlaceholder: "https://github.com/... or ipfs://..."
  },
  "agent-update": {
    id: "agent-update",
    label: "Submit your agent",
    points: 370,
    kind: "review",
    requirement: "X, GitHub, or docs link",
    detail: "Submit one public link that shows your deployed agent and what it does.",
    evidencePlaceholder: "https://x.com/... or https://github.com/..."
  },
  // Legacy requests stay recognizable to reviewers, but this is no longer a user-facing campaign step.
  "receipt-anchor": {
    id: "receipt-anchor",
    label: "Get proof approved",
    points: 240,
    kind: "review",
    requirement: "Reviewer approval",
    detail: "An approved submission adds points to your onchain profile.",
    evidencePlaceholder: "https://..."
  }
};

const campaigns: Campaign[] = [
  {
    id: "builder-launch",
    title: "Builder Launch",
    short: "Complete the core checks for a Ritual builder.",
    description: "Prove that your wallet is active, your contract is deployed, and your project is public.",
    host: "Ritual ProofGraph",
    category: "Builder",
    reward: "790 pts",
    badge: "Onchain checks",
    accent: "builder",
    tags: ["Wallet activity", "Contract deploy", "Project link"],
    tasks: [taskBook["wallet-link"], taskBook["chain-activity"], taskBook["contract-deploy"], taskBook["build-log"]]
  },
  {
    id: "agent-genesis",
    title: "Agent Genesis",
    short: "Verify the Ritual agent deployed by your wallet.",
    description: "Prove that this wallet deployed a Ritual agent. A paused agent still counts.",
    host: "Ritual Agents",
    category: "Agents",
    reward: "890 pts",
    badge: "Agent check",
    accent: "agents",
    tags: ["Agent registry", "Wallet activity", "Agent link"],
    tasks: [taskBook["wallet-link"], taskBook["native-agent"], taskBook["chain-activity"], taskBook["agent-update"]]
  },
  {
    id: "community-signal",
    title: "Community Signal",
    short: "Connect your community identity to your wallet.",
    description: "Connect Discord and submit public updates that show your work in the Ritual community.",
    host: "Ritual Community",
    category: "Community",
    reward: "730 pts",
    badge: "Social checks",
    accent: "community",
    tags: ["Discord roles", "X post", "Project link"],
    tasks: [taskBook["wallet-link"], taskBook["discord-oath"], taskBook["x-proof"], taskBook["build-log"]]
  },
  {
    id: "onchain-receipt-trail",
    title: "Onchain Trail",
    short: "Verify activity directly from Ritual Chain.",
    description: "Verify your transactions, contract deployments, and approved proofs directly on Ritual Chain.",
    host: "Ritual Ledger",
    category: "Onchain",
    reward: "790 pts",
    badge: "Chain checks",
    accent: "onchain",
    tags: ["Transactions", "Deployments", "Proof approvals"],
    tasks: [taskBook["wallet-link"], taskBook["chain-activity"], taskBook["contract-deploy"], taskBook["build-log"]]
  },
  {
    id: "discord-role-passport",
    title: "Discord Passport",
    short: "Connect your Ritual Discord roles to your wallet.",
    description: "Connect Discord and prove which Ritual server roles belong to your wallet.",
    host: "Ritual Discord",
    category: "Discord",
    reward: "730 pts",
    badge: "Discord check",
    accent: "discord",
    tags: ["Discord OAuth", "Server roles", "Wallet link"],
    tasks: [taskBook["wallet-link"], taskBook["discord-oath"], taskBook["x-proof"], taskBook["build-log"]]
  }
];

const state: {
  route: Route;
  campaignId: string;
  activeTab: "all" | "smart" | "following" | "watchlist";
  filter: string;
  filtersOpen: boolean;
  sort: "trending" | "points" | "progress";
  query: string;
  view: "list" | "grid";
  account: string;
  proof?: WalletProof;
  profile?: Profile;
  receipts: Receipt[];
  leaderboard: Profile[];
  pending: PendingReview[];
  rejections: ReviewRejection[];
  oauthConfig?: OAuthConfig;
  social: Partial<Record<"discord" | "x", SocialProof>>;
  following: string[];
  campaignDirectory: { loading: boolean; loaded: boolean; error: string; composerOpen: boolean; editingId: string; feed?: CampaignDirectoryFeed };
  blog: { loading: boolean; loaded: boolean; error: string; feed?: RitualBlogFeed };
  calendar: { loading: boolean; loaded: boolean; error: string; formError: string; weekOffset: number; view: CalendarView; filter: CalendarFilter; query: string; editingId: string; draft?: CalendarDraft; feed?: CalendarFeed };
  review: { loading: boolean; loaded: boolean; error: string; queue: ReviewRequest[] };
  busy: boolean;
  status: string;
} = {
  ...routeFromHash(),
  activeTab: "all",
  filter: "All",
  filtersOpen: false,
  sort: "trending",
  query: "",
  view: "list",
  account: "",
  receipts: [],
  leaderboard: [],
  pending: loadPendingReviews(),
  rejections: [],
  social: loadSocialProofs(),
  following: loadFollowing(),
  campaignDirectory: { loading: false, loaded: false, error: "", composerOpen: false, editingId: "" },
  blog: { loading: false, loaded: false, error: "" },
  calendar: { loading: false, loaded: false, error: "", formError: "", weekOffset: 0, view: "schedule", filter: "all", query: "", editingId: "" },
  review: { loading: false, loaded: false, error: "", queue: [] },
  busy: false,
  status: ""
};

let sceneMounted = false;
let currentMotionRoute = "";
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

void loadOAuthConfig();
render();
mountQuestScene();
if (state.route === "leaderboard") void readLeaderboard(false);

window.addEventListener("hashchange", () => {
  Object.assign(state, routeFromHash());
  window.scrollTo(0, 0);
  render();
  if (state.route === "leaderboard") void readLeaderboard(false);
});

window.addEventListener("ritual-wallet-change", (event) => {
  const detail = (event as CustomEvent<{ address?: string; connected: boolean }>).detail;
  const nextAccount = detail?.connected && detail.address ? detail.address : "";
  if (state.account.toLowerCase() === nextAccount.toLowerCase()) return;
  state.account = nextAccount;
  state.proof = undefined;
  state.profile = undefined;
  state.receipts = [];
  state.rejections = [];
  state.review = { loading: false, loaded: false, error: "", queue: [] };
  state.status = nextAccount ? `Connected ${shortAddress(nextAccount)}. Reading Ritual proof...` : "Wallet disconnected.";
  render();
  if (nextAccount) {
    void syncWalletProof();
    void readLeaderboard(false);
  }
});

function routeFromHash(): { route: Route; campaignId: string } {
  const hash = location.hash.replace(/^#\/?/, "").toLowerCase();
  if (hash.startsWith("campaign/")) {
    const id = hash.split("/")[1] || "builder-launch";
    return { route: "campaign", campaignId: /^[a-z0-9-]{3,90}$/.test(id) ? id : "builder-launch" };
  }
  if (hash === "identity" || hash === "leaderboard" || hash === "review" || hash === "architecture" || hash === "blog" || hash === "calendar") return { route: hash, campaignId: "builder-launch" };
  return { route: "explore", campaignId: "builder-launch" };
}

function render() {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) return;
  app.innerHTML = `
    <header class="quest-nav">
      <a class="quest-brand" href="#explore" aria-label="Ritual Quest home">
        <img src="${LOGO}" alt="Ritual logo" />
        <span><strong>Ritual Quest</strong><small>Onchain campaigns</small></span>
      </a>
      <nav aria-label="Primary">
        ${nav("explore", "Explore", "#explore")}
        ${nav("campaign", "Campaign", `#campaign/${state.campaignId}`)}
        ${nav("identity", "Identity", "#identity")}
        ${nav("leaderboard", "Leaderboard", "#leaderboard")}
        ${canAccessReview() ? nav("review", "Review", "#review") : ""}
        ${nav("calendar", "Calendar", "#calendar")}
        ${nav("blog", "Blog", "#blog")}
        ${nav("architecture", "Protocol", "#architecture")}
      </nav>
      <button class="network-pill" type="button">Ritual 1979</button>
      <div class="rainbow-connect-slot" data-rainbow-connect></div>
    </header>
    <main>
      ${state.route === "explore" ? renderExplore() : ""}
      ${state.route === "campaign" ? renderCampaignDetail(selectedCampaign()) : ""}
      ${state.route === "identity" ? renderIdentity() : ""}
      ${state.route === "leaderboard" ? renderLeaderboardPage() : ""}
      ${state.route === "review" ? renderReviewPage() : ""}
      ${state.route === "calendar" ? renderCalendar() : ""}
      ${state.route === "blog" ? renderBlog() : ""}
      ${state.route === "architecture" ? renderArchitecture() : ""}
    </main>
    ${state.status ? `<div class="quest-toast ${state.busy ? "is-busy" : "is-idle"}"><span></span>${escapeHtml(state.status)}</div>` : ""}
  `;
  bindEvents();
  mountMotion();
  mountRainbowKit();
  if ((state.route === "explore" || state.route === "campaign" || state.route === "review") && !state.campaignDirectory.loaded && !state.campaignDirectory.loading) void loadCampaigns();
  if (state.route === "blog" && !state.blog.loaded && !state.blog.loading) void loadRitualBlog();
  if (state.route === "calendar" && !state.calendar.loaded && !state.calendar.loading) void loadCalendar();
  if (state.route === "review" && canAccessReview() && !state.review.loaded && !state.review.loading) void loadReviewQueue();
}

function nav(route: Route, label: string, href: string) {
  return `<a class="${state.route === route ? "active" : ""}" href="${href}">${label}</a>`;
}

function renderExplore() {
  const directoryCampaigns = allCampaigns();
  const list = filteredCampaigns();
  const totalOpenTasks = directoryCampaigns.reduce((count, campaign) => count + campaignStats(campaign).openTasks, 0);
  const completedTasks = directoryCampaigns.reduce((count, campaign) => count + campaignStats(campaign).completed, 0);
  const walletLabel = state.account ? shortAddress(state.account) : "Connect wallet to begin";
  return `
    <section class="quest-directory">
      <aside class="directory-rail" aria-label="Campaign views">
        <div class="directory-rail-title">
          <span>Ritual Quest</span>
          <strong>Campaigns</strong>
        </div>
        <div class="directory-view-list">
          ${tabButton("all", "All campaigns")}
          ${tabButton("smart", "Ready now")}
          ${tabButton("following", "Following")}
          ${tabButton("watchlist", "Started")}
        </div>
        <div class="directory-identity">
          <span>Current wallet</span>
          <strong>${escapeHtml(walletLabel)}</strong>
          <p>${state.proof ? `${formatScore(state.proof.transactionCount)} Ritual transactions found.` : "Connect your wallet to unlock tasks and check your Ritual activity."}</p>
          <button class="quiet-cta" type="button" data-action="${state.account ? "sync-proof" : "open-wallet"}">${state.account ? "Refresh checks" : "Connect wallet"}</button>
        </div>
      </aside>
      <div class="directory-content">
        <header class="directory-header">
          <div>
            <p class="kicker">Ritual campaigns</p>
            <h1>Choose a campaign. Complete the checks.</h1>
            <p>Each campaign shows what we check, how many points are available, and what to do next.</p>
          </div>
          <div class="directory-header-side">
            <div class="directory-metrics" aria-label="Campaign summary">
              <div><strong>${directoryCampaigns.length}</strong><span>Campaigns</span></div>
              <div><strong>${totalOpenTasks}</strong><span>Ready now</span></div>
              <div><strong>${completedTasks}</strong><span>Checks done</span></div>
            </div>
            ${state.campaignDirectory.feed?.canCreate ? `<button class="primary-cta campaign-create-button" type="button" data-action="toggle-campaign-composer">${state.campaignDirectory.composerOpen ? "Close creator" : "Create campaign"}</button>` : ""}
          </div>
        </header>
        ${state.campaignDirectory.composerOpen && state.campaignDirectory.feed?.canCreate ? renderCampaignComposer() : ""}
        <div class="directory-controls">
          <label class="directory-search">
            ${inlineIcon(Search, "directory-search-icon", 16)}
            <input value="${escapeAttr(state.query)}" placeholder="Search campaigns or tasks" data-action="search" />
          </label>
          <label class="directory-sort"><span>Sort</span><select data-action="campaign-sort"><option value="trending" ${state.sort === "trending" ? "selected" : ""}>Recommended</option><option value="points" ${state.sort === "points" ? "selected" : ""}>Most points</option><option value="progress" ${state.sort === "progress" ? "selected" : ""}>Your progress</option></select></label>
        </div>
        <div class="directory-filters" aria-label="Campaign categories">
          ${FILTER_CHIPS.map(renderFilterChip).join("")}
        </div>
        <section class="campaign-feed" aria-label="Campaigns">
          ${list.length ? list.map(renderCampaignCard).join("") : `<div class="empty-panel directory-empty"><strong>No campaigns found.</strong><span>Choose another category or clear the search.</span></div>`}
        </section>
      </div>
    </section>
  `;
}

function tabButton(tab: typeof state.activeTab, label: string) {
  const directoryCampaigns = allCampaigns();
  const count =
    tab === "all"
      ? directoryCampaigns.length
      : tab === "following"
        ? state.following.length
        : tab === "smart"
          ? directoryCampaigns.filter((campaign) => campaignStats(campaign).openTasks > 0).length
          : state.account
            ? directoryCampaigns.filter((campaign) => {
                const progress = campaignStats(campaign).progress;
                return progress > 0 && progress < 100;
              }).length
            : 0;
  return `<button class="${state.activeTab === tab ? "active" : ""}" type="button" data-tab="${tab}"><span>${escapeHtml(label)}</span><b>${count}</b></button>`;
}

function renderFilterChip(chip: string) {
  const directoryCampaigns = allCampaigns();
  const count = chip === "All" ? directoryCampaigns.length : directoryCampaigns.filter((campaign) => campaign.category === chip).length;
  return `<button class="directory-filter theme-${themeName(chip)} ${state.filter === chip ? "selected" : ""}" type="button" data-filter="${escapeAttr(chip)}"><span>${escapeHtml(chip)}</span><b>${count}</b></button>`;
}

function renderImageUrlGuide(statusAttribute: string, fallbackLabel: string) {
  return `
    <details class="image-url-guide">
      <summary>
        ${inlineIcon(ImageIcon, "image-url-guide-icon", 16)}
        <span><strong>How to add a cover</strong><small>Use a direct, public image link.</small></span>
      </summary>
      <ol>
        <li>Upload the image to a public host, CDN, or GitHub.</li>
        <li>Open the image itself in a new tab, then copy its address.</li>
        <li>Paste the HTTPS link above. The preview confirms whether it works.</li>
      </ol>
      <p>The link must open without a login. A direct <code>.jpg</code>, <code>.png</code>, or <code>.webp</code> link works best.</p>
    </details>
    <p class="image-url-status" ${statusAttribute} data-state="fallback"><i></i><span>No custom cover. ${escapeHtml(fallbackLabel)} will be used.</span></p>
  `;
}

function socialPostTargets(task?: CustomSocialTask | null) {
  const modern = Array.isArray(task?.posts) ? task.posts : [];
  const legacy = task?.postUrl ? [{ url: task.postUrl, engagements: task.engagements || [] }] : [];
  const targets = (modern.length ? modern : legacy)
    .filter((target) => target && typeof target === "object")
    .slice(0, 5)
    .map((target) => ({
      url: String(target.url || ""),
      engagements: Array.isArray(target.engagements) ? target.engagements.filter((item) => ["like", "repost", "reply"].includes(item)) : []
    }));
  return targets.length ? targets : [{ url: "", engagements: [] }];
}

function renderSocialPostTarget(target: { url: string; engagements: string[] }, index: number, total: number) {
  return `
    <div class="campaign-post-target" data-post-target>
      <div class="campaign-post-target-head">
        <span>Post ${String(index + 1).padStart(2, "0")}</span>
        <button type="button" data-remove-post aria-label="Remove post ${index + 1}" title="Remove post" ${total === 1 ? "disabled" : ""}>${inlineIcon(Trash2, "campaign-post-remove-icon", 15)}</button>
      </div>
      <label>Post URL<input name="customPostUrl" type="url" inputmode="url" placeholder="https://x.com/ritualnet/status/..." value="${escapeAttr(target.url)}" /><small>Paste the full public post URL, not an X profile URL.</small></label>
      <div class="campaign-engagement-options" aria-label="Actions required on post ${index + 1}">
        <span>Required actions</span>
        ${["like", "repost", "reply"].map((engagement) => `<label><input type="checkbox" name="customPostEngagement" value="${engagement}" ${target.engagements.includes(engagement) ? "checked" : ""} /> ${engagement[0].toUpperCase()}${engagement.slice(1)}</label>`).join("")}
      </div>
    </div>
  `;
}

function renderCampaignComposer() {
  const storageReady = Boolean(state.campaignDirectory.feed?.configured);
  const editingCampaign = state.campaignDirectory.feed?.campaigns.find((campaign) => campaign.id === state.campaignDirectory.editingId && campaign.canManage);
  const editing = Boolean(editingCampaign);
  const selectedTaskIds = new Set(editingCampaign?.taskIds || ["chain-activity", "build-log"]);
  const customTask = editingCampaign?.customTask || null;
  const postTargets = socialPostTargets(customTask);
  const selectedCategory = editingCampaign?.category || "Builder";
  const categoryOptions = FILTER_CHIPS.filter((category) => category !== "All")
    .map((category) => `<option value="${escapeAttr(category)}" ${category === selectedCategory ? "selected" : ""}>${escapeHtml(category)}</option>`)
    .join("");
  const taskOptions = CREATOR_TASK_IDS.map((taskId) => taskBook[taskId])
    .filter((task): task is CampaignTask => Boolean(task))
    .map((task) => `
      <label class="campaign-task-choice">
        <input type="checkbox" name="taskIds" value="${escapeAttr(task.id)}" data-preview-task data-points="${task.points}" ${selectedTaskIds.has(task.id) ? "checked" : ""} />
        <span><strong>${escapeHtml(task.label)}</strong><small>${escapeHtml(task.detail)}</small></span>
        <b>${task.points} pts</b>
      </label>
    `)
    .join("");
  return `
    <section class="campaign-studio" aria-labelledby="campaign-composer-title">
      <header class="campaign-studio-head">
        <div>
          <p class="kicker">Campaign studio</p>
          <h2 id="campaign-composer-title">${editing ? "Edit campaign" : "Create a campaign"}</h2>
          <p>${editing ? "Update the campaign details and checks. The campaign ID and creator stay unchanged." : "Set the campaign details, choose proof checks, then add the X actions participants should complete."}</p>
        </div>
        <ol class="campaign-studio-steps" aria-label="Campaign creation steps">
          <li><span>01</span><strong>Details</strong></li>
          <li><span>02</span><strong>Checks</strong></li>
          <li><span>03</span><strong>Review</strong></li>
        </ol>
      </header>
      <form class="campaign-composer-form" data-form="campaign-create">
        <div class="campaign-studio-layout">
          <div class="campaign-studio-main">
            <section class="campaign-form-section">
              <header><span>01</span><div><h3>Campaign details</h3><p>What participants see in Explore.</p></div></header>
              <div class="campaign-composer-fields">
                <label>Campaign title<input name="title" required minlength="3" maxlength="70" placeholder="Ritual Builder Week" value="${escapeAttr(editingCampaign?.title || "")}" /></label>
                <label>Category<select name="category" required>${categoryOptions}</select></label>
                <label class="campaign-description-field">Short description<textarea name="description" required minlength="12" maxlength="280" rows="3" placeholder="Explain the goal in one clear sentence.">${escapeHtml(editingCampaign?.description || "")}</textarea></label>
                <div class="campaign-image-field image-url-field">
                  <label>Campaign cover <span>optional</span><input name="imageUrl" type="url" inputmode="url" placeholder="https://.../cover.jpg" value="${escapeAttr(editingCampaign?.imageUrl || "")}" /><small>Paste a public HTTPS image URL, or leave it empty to use the category artwork.</small></label>
                  ${renderImageUrlGuide("data-campaign-cover-status", "Category artwork")}
                </div>
              </div>
            </section>

            <section class="campaign-form-section">
              <header><span>02</span><div><h3>Proof checks</h3><p>Choose up to four checks. Wallet connection is always included.</p></div></header>
              <fieldset class="campaign-task-picker">
                <legend>Available checks</legend>
                <div class="campaign-task-choice is-fixed">
                  <span class="campaign-fixed-check">01</span>
                  <span><strong>Connect wallet</strong><small>Required for every participant.</small></span>
                  <b>${taskBook["wallet-link"].points} pts</b>
                </div>
                ${taskOptions}
              </fieldset>
            </section>

            <section class="campaign-form-section campaign-x-builder">
              <header><span>03</span><div><h3>X task builder</h3><p>Add one social step. Use any combination of the actions below.</p></div></header>
              <div class="campaign-x-intro">
                <label>Task name<input name="customTitle" maxlength="60" placeholder="Join the Ritual launch conversation" value="${escapeAttr(customTask?.title || "")}" /></label>
                <label>Participant instructions<textarea name="customInstructions" maxlength="220" rows="2" placeholder="Follow the accounts, engage with the post, then share what you are building.">${escapeHtml(customTask?.instructions || "")}</textarea></label>
              </div>
              <div class="campaign-x-task-list">
                <article class="campaign-x-task" data-x-task="follow">
                  <div class="campaign-x-task-icon">${inlineIcon(Users, "campaign-x-icon", 19)}</div>
                  <div class="campaign-x-task-copy"><span>X action</span><h4>Follow accounts</h4><p>Participants open each profile you add.</p></div>
                  <label>Accounts to follow <span>up to 5</span><input name="customAccounts" placeholder="ritualnet, ritualfnd" value="${escapeAttr((customTask?.accounts || []).join(", "))}" /><small>Enter X usernames separated by commas. The @ is optional.</small></label>
                  <div class="campaign-account-chips" data-account-chips><span>No accounts added</span></div>
                </article>

                <article class="campaign-x-task" data-x-task="engage">
                  <div class="campaign-x-task-icon">${inlineIcon(MessageCircle, "campaign-x-icon", 19)}</div>
                  <div class="campaign-x-task-copy"><span>X action</span><h4>Engage with posts</h4><p>Add up to five public X posts and choose the action required on each one.</p></div>
                  <div class="campaign-post-target-list" data-post-target-list>
                    ${postTargets.map((target, index) => renderSocialPostTarget(target, index, postTargets.length)).join("")}
                  </div>
                  <button class="campaign-add-post" type="button" data-add-post ${postTargets.length >= 5 ? "disabled" : ""}>${inlineIcon(Plus, "campaign-add-post-icon", 15)}<span>Add post</span><b data-post-limit>${postTargets.length}/5</b></button>
                </article>

                <article class="campaign-x-task" data-x-task="publish">
                  <div class="campaign-x-task-icon">${inlineIcon(Send, "campaign-x-icon", 19)}</div>
                  <div class="campaign-x-task-copy"><span>X action</span><h4>Publish a new post</h4><p>Give participants a topic; they write and publish their own post.</p></div>
                  <label>What should they post about?<textarea name="customPostPrompt" maxlength="240" rows="2" placeholder="Share one thing you are building on Ritual this week.">${escapeHtml(customTask?.postPrompt || "")}</textarea><small>This text opens in the X composer as a starting prompt.</small></label>
                </article>
              </div>
              <div class="campaign-verification-note">
                <span>${inlineIcon(AtSign, "campaign-verification-icon", 16)}</span>
                <div><strong>Self-attested social step</strong><p>After opening the X targets, the participant waits 60 seconds and confirms completion. This step awards 0 onchain points and creates no receipt.</p></div>
              </div>
            </section>
          </div>

          <aside class="campaign-live-preview" aria-label="Campaign preview">
            <div class="campaign-preview-head"><span>Live preview</span><b data-preview-count>3 steps</b></div>
            <div class="campaign-preview-cover">
              <img data-preview-image src="${escapeAttr(editingCampaign ? campaignArt(editingCampaign) : CATEGORY_ART.Builder)}" alt="Campaign cover preview" />
              <span data-preview-category>${escapeHtml(selectedCategory)}</span>
              <i>${inlineIcon(ImageIcon, "campaign-preview-image-icon", 15)}</i>
            </div>
            <div class="campaign-preview-copy">
              <h3 data-preview-title>${escapeHtml(editingCampaign?.title || "Ritual Builder Week")}</h3>
              <p data-preview-description>${escapeHtml(editingCampaign?.description || "Your campaign description will appear here.")}</p>
              <div class="campaign-preview-reward"><span>Available reward</span><strong data-preview-points>570 pts</strong></div>
              <div class="campaign-preview-tasks">
                <span>Participants will</span>
                <ol data-preview-tasks></ol>
              </div>
            </div>
          </aside>
        </div>
        <div class="campaign-form-error" role="alert" hidden data-campaign-form-error>
          <strong>Campaign not published.</strong>
          <span data-campaign-form-error-copy>Check the campaign details and try again.</span>
        </div>
        ${storageReady ? "" : `<p class="campaign-storage-note">Creator access is active. Configure shared campaign storage before publishing.</p>`}
        <footer class="campaign-composer-actions">
          <span>${editing ? "Changes are saved to the same campaign." : "Review the preview before publishing."}</span>
          <div><button class="quiet-cta" type="button" data-action="cancel-campaign-edit">Cancel</button><button class="primary-cta" type="submit" ${storageReady ? "" : "disabled"}>${storageReady ? editing ? "Save changes" : "Publish campaign" : "Storage setup required"}</button></div>
        </footer>
      </form>
    </section>
  `;
}

function bindCampaignStudio() {
  const form = document.querySelector<HTMLFormElement>("[data-form='campaign-create']");
  if (!form) return;

  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  const titleInput = input("title") as HTMLInputElement | null;
  const descriptionInput = input("description") as HTMLTextAreaElement | null;
  const categoryInput = input("category") as HTMLSelectElement | null;
  const imageInput = input("imageUrl") as HTMLInputElement | null;
  const customTitleInput = input("customTitle") as HTMLInputElement | null;
  const customInstructionsInput = input("customInstructions") as HTMLTextAreaElement | null;
  const accountsInput = input("customAccounts") as HTMLInputElement | null;
  const postPromptInput = input("customPostPrompt") as HTMLTextAreaElement | null;
  const postTargetList = form.querySelector<HTMLElement>("[data-post-target-list]");
  const addPostButton = form.querySelector<HTMLButtonElement>("[data-add-post]");
  const previewImage = form.querySelector<HTMLImageElement>("[data-preview-image]");
  const previewTasks = form.querySelector<HTMLOListElement>("[data-preview-tasks]");
  const accountChips = form.querySelector<HTMLElement>("[data-account-chips]");
  const coverStatus = form.querySelector<HTMLElement>("[data-campaign-cover-status]");

  const setCoverStatus = (message: string, stateName: "fallback" | "checking" | "ready" | "error") => {
    if (!coverStatus) return;
    coverStatus.dataset.state = stateName;
    const copy = coverStatus.querySelector("span");
    if (copy) copy.textContent = message;
  };

  const refreshPostTargetControls = () => {
    const rows = [...form.querySelectorAll<HTMLElement>("[data-post-target]")];
    rows.forEach((row, index) => {
      const label = row.querySelector<HTMLElement>(".campaign-post-target-head > span");
      const removeButton = row.querySelector<HTMLButtonElement>("[data-remove-post]");
      if (label) label.textContent = `Post ${String(index + 1).padStart(2, "0")}`;
      if (removeButton) {
        removeButton.disabled = rows.length === 1;
        removeButton.setAttribute("aria-label", `Remove post ${index + 1}`);
      }
    });
    if (addPostButton) addPostButton.disabled = rows.length >= 5;
    const limit = addPostButton?.querySelector<HTMLElement>("[data-post-limit]");
    if (limit) limit.textContent = `${rows.length}/5`;
  };

  const sync = () => {
    const category = categoryInput?.value || "Builder";
    const fallbackArt = (CATEGORY_ART as Record<string, string>)[category] || HERO_ART;
    const cover = String(imageInput?.value || "").trim();
    const validCover = !cover || /^https:\/\/[^\s]+$/i.test(cover);
    imageInput?.setCustomValidity(validCover ? "" : "Use a public image link that starts with https://.");
    if (previewImage) {
      previewImage.onload = null;
      previewImage.onerror = null;
      if (!cover) {
        previewImage.src = fallbackArt;
        setCoverStatus("No custom cover. Category artwork will be used.", "fallback");
      } else if (!validCover) {
        previewImage.src = fallbackArt;
        setCoverStatus("The link must start with https://.", "error");
      } else {
        setCoverStatus("Checking the image link...", "checking");
        previewImage.onload = () => setCoverStatus("Cover loaded. This image is ready to publish.", "ready");
        previewImage.onerror = () => {
          previewImage.onerror = null;
          previewImage.src = fallbackArt;
          setCoverStatus("This image could not be opened. Check that the link is public and direct.", "error");
        };
        previewImage.src = cover;
      }
    }

    const accounts = [...new Set(String(accountsInput?.value || "").split(",")
      .map((account) => account.trim().replace(/^@/, "").toLowerCase())
      .filter((account) => /^[a-z0-9_]{1,15}$/.test(account)))].slice(0, 5);
    const postTargets = [...form.querySelectorAll<HTMLElement>("[data-post-target]")].map((row) => {
      const postUrlInput = row.querySelector<HTMLInputElement>("input[name='customPostUrl']");
      const url = String(postUrlInput?.value || "").trim();
      const engagements = [...row.querySelectorAll<HTMLInputElement>("input[name='customPostEngagement']:checked")].map((item) => item.value);
      const validUrl = !url || /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+\/?$/i.test(url);
      postUrlInput?.setCustomValidity(!validUrl ? "Paste a full public X post URL." : engagements.length > 0 && !url ? "Add the X post these actions apply to." : "");
      return { url, engagements };
    });
    const configuredPosts = postTargets.filter((target) => target.url || target.engagements.length > 0);
    const validPosts = configuredPosts.filter((target) => target.url);
    const postPrompt = String(postPromptInput?.value || "").trim();
    const customTitle = String(customTitleInput?.value || "").trim();
    const customInstructions = String(customInstructionsInput?.value || "").trim();
    const hasXAction = accounts.length > 0 || configuredPosts.length > 0 || Boolean(postPrompt);
    const hasCustomStep = hasXAction || Boolean(customTitle) || Boolean(customInstructions);

    customTitleInput?.setCustomValidity(hasCustomStep && customTitle.length < 3 ? "Add a clear task name." : hasCustomStep && !hasXAction ? "Add at least one X action below." : "");
    customInstructionsInput?.setCustomValidity(hasCustomStep && customInstructions.length < 8 ? "Explain what participants should do." : "");

    if (accountChips) {
      accountChips.replaceChildren();
      if (!accounts.length) {
        const empty = document.createElement("span");
        empty.textContent = "No accounts added";
        accountChips.append(empty);
      } else {
        accounts.forEach((account) => {
          const chip = document.createElement("span");
          chip.textContent = `@${account}`;
          accountChips.append(chip);
        });
      }
    }

    form.querySelector<HTMLElement>("[data-x-task='follow']")?.classList.toggle("is-active", accounts.length > 0);
    form.querySelector<HTMLElement>("[data-x-task='engage']")?.classList.toggle("is-active", configuredPosts.length > 0);
    form.querySelector<HTMLElement>("[data-x-task='publish']")?.classList.toggle("is-active", Boolean(postPrompt));

    const selectedChecks = [...form.querySelectorAll<HTMLInputElement>("input[data-preview-task]:checked")];
    const points = taskBook["wallet-link"].points + selectedChecks.reduce((total, item) => total + Number(item.dataset.points || 0), 0);
    const participantActions = ["Connect a wallet"];
    selectedChecks.forEach((item) => {
      const task = taskBook[item.value];
      if (task) participantActions.push(task.label);
    });
    if (accounts.length) participantActions.push(`Follow ${accounts.length} X account${accounts.length === 1 ? "" : "s"}`);
    if (validPosts.length) participantActions.push(`Engage with ${validPosts.length} X post${validPosts.length === 1 ? "" : "s"}`);
    if (postPrompt) participantActions.push("Publish an original X post");

    if (previewTasks) {
      previewTasks.replaceChildren();
      participantActions.forEach((action) => {
        const item = document.createElement("li");
        item.textContent = action;
        previewTasks.append(item);
      });
    }

    const taskCount = 1 + selectedChecks.length + (hasCustomStep ? 1 : 0);
    const setText = (selector: string, value: string) => {
      const element = form.querySelector<HTMLElement>(selector);
      if (element) element.textContent = value;
    };
    setText("[data-preview-title]", String(titleInput?.value || "").trim() || "Ritual Builder Week");
    setText("[data-preview-description]", String(descriptionInput?.value || "").trim() || "Your campaign description will appear here.");
    setText("[data-preview-category]", category);
    setText("[data-preview-points]", `${points} pts`);
    setText("[data-preview-count]", `${taskCount} step${taskCount === 1 ? "" : "s"}`);
  };

  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  addPostButton?.addEventListener("click", () => {
    const count = form.querySelectorAll("[data-post-target]").length;
    if (!postTargetList || count >= 5) return;
    postTargetList.insertAdjacentHTML("beforeend", renderSocialPostTarget({ url: "", engagements: [] }, count, count + 1));
    refreshPostTargetControls();
    sync();
    postTargetList.querySelectorAll<HTMLInputElement>("input[name='customPostUrl']")[count]?.focus();
  });
  postTargetList?.addEventListener("click", (event) => {
    const removeButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-remove-post]");
    if (!removeButton) return;
    const rows = [...form.querySelectorAll<HTMLElement>("[data-post-target]")];
    if (rows.length <= 1) return;
    removeButton.closest<HTMLElement>("[data-post-target]")?.remove();
    refreshPostTargetControls();
    sync();
  });
  refreshPostTargetControls();
  sync();
}

function campaignArt(campaign: Campaign) {
  return campaign.imageUrl || CATEGORY_ART[campaign.category] || HERO_ART;
}

function themeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function campaignNextTask(campaign: Campaign) {
  const next = campaign.tasks.map((task) => ({ task, status: taskStatus(task) })).find((item) => item.status.status !== "complete");
  return next || { task: campaign.tasks[campaign.tasks.length - 1], status: { status: "complete" as TaskStatus, label: "Complete", reason: "All checks are verified." } };
}

function campaignOwnerActions(campaign: Campaign, className = "") {
  if (!campaign.community || !campaign.canManage) return "";
  return `
    <div class="owned-item-actions ${className}" aria-label="Campaign controls">
      <button type="button" data-action="edit-campaign" data-campaign="${escapeAttr(campaign.id)}" aria-label="Edit campaign" title="Edit campaign">${inlineIcon(Pencil, "owned-item-icon", 15)}</button>
      <button class="is-danger" type="button" data-action="delete-campaign" data-campaign="${escapeAttr(campaign.id)}" aria-label="Delete campaign" title="Delete campaign">${inlineIcon(Trash2, "owned-item-icon", 15)}</button>
    </div>
  `;
}

function renderCampaignCard(campaign: Campaign) {
  const stats = campaignStats(campaign);
  const next = campaignNextTask(campaign);
  return `
    <div class="campaign-row-shell">
      <a class="quest-campaign-row theme-${campaign.accent}" href="#campaign/${campaign.id}">
        <div class="campaign-row-media">
          <img src="${escapeAttr(campaignArt(campaign))}" alt="${escapeAttr(campaign.category)} campaign art" />
          <span>${escapeHtml(campaign.category)}</span>
        </div>
        <div class="campaign-row-copy">
          <div class="campaign-row-kicker"><span>${escapeHtml(campaign.badge)}</span><b>${stats.totalPoints} pts</b></div>
          <h2>${escapeHtml(campaign.title)}</h2>
          <p>${escapeHtml(campaign.description)}</p>
          <div class="campaign-row-proof">
            <span>What we check</span>
            <strong>${escapeHtml(campaign.tags.join(" / "))}</strong>
          </div>
        </div>
        <div class="campaign-row-status">
          <div class="campaign-progress-ring" style="--progress:${stats.progress}"><span>${stats.progress}%</span></div>
          <strong>${stats.completed}/${campaign.tasks.length} checks</strong>
          <small>Next: ${escapeHtml(next.task.label)}</small>
          <span class="campaign-row-open">View ${inlineIcon(ArrowRight, "campaign-row-open-icon", 15)}</span>
        </div>
      </a>
      ${campaignOwnerActions(campaign, "campaign-row-owner-actions")}
    </div>
  `;
}

function renderCampaignDetail(campaign: Campaign) {
  const stats = campaignStats(campaign);
  const next = campaignNextTask(campaign);
  return `
    <section class="campaign-workspace theme-${campaign.accent}">
      <a class="campaign-back" href="#explore">${inlineIcon(ArrowRight, "campaign-back-icon", 15)} All campaigns</a>
      <header class="campaign-brief">
        <div class="campaign-brief-copy">
          <div class="campaign-brief-eyebrow"><span>${escapeHtml(campaign.category)} campaign</span><b>${escapeHtml(campaign.badge)}</b></div>
          <h1>${escapeHtml(campaign.title)}</h1>
          <p>${escapeHtml(campaign.description)}</p>
          <div class="campaign-actions">
            <button class="primary-cta" type="button" data-action="${state.account ? "sync-proof" : "open-wallet"}">${state.account ? "Check my wallet" : "Connect wallet"}</button>
            <button class="quiet-cta" type="button" data-action="toggle-follow" data-campaign="${campaign.id}">${state.following.includes(campaign.id) ? "Following" : "Follow campaign"}</button>
            ${campaignOwnerActions(campaign, "campaign-detail-owner-actions")}
          </div>
        </div>
        <figure class="campaign-brief-media"><img src="${escapeAttr(campaignArt(campaign))}" alt="${escapeAttr(campaign.category)} campaign art" /><figcaption>${escapeHtml(campaign.host)}</figcaption></figure>
      </header>
      <section class="campaign-facts" aria-label="Campaign facts">
        <div><span>Total points</span><strong>${stats.totalPoints}</strong></div>
        <div><span>Steps</span><strong>${campaign.tasks.length}</strong></div>
        <div><span>Completed</span><strong>${stats.completed}/${campaign.tasks.length}</strong></div>
        <div><span>What we check</span><strong>${escapeHtml(campaign.tags.join(", "))}</strong></div>
      </section>
      <section class="campaign-checklist" id="checks">
        <header>
          <div><p class="kicker">Campaign steps</p><h2>Complete these steps in order.</h2></div>
          <aside><span>Next step</span><strong>${escapeHtml(next.task.label)}</strong><small>${escapeHtml(next.status.reason)}</small></aside>
        </header>
        <div class="proof-track-list">
          ${campaign.tasks.map((task, index) => renderQuestTask(campaign, task, index)).join("")}
        </div>
    </section>
  `;
}

function renderQuestTask(campaign: Campaign, task: CampaignTask, index: number) {
  const status = taskStatus(task);
  const showStatusReason = state.account !== "" || index === 0;
  return `
    <article class="proof-track ${status.status}">
      <div class="proof-track-index">${taskStatusIcon(status.status, index)}</div>
      <div class="proof-track-copy">
        <div class="proof-track-head"><h3>${escapeHtml(task.label)}</h3><span class="task-status status-${status.status}">${escapeHtml(status.label)}</span></div>
        <p>${escapeHtml(task.detail)}</p>
        <div class="proof-track-requirement"><strong>${escapeHtml(task.requirement)}</strong>${showStatusReason ? `<span>${escapeHtml(status.reason)}</span>` : ""}</div>
      </div>
      <div class="proof-track-points"><strong>${task.points}</strong><span>points</span></div>
      <div class="proof-track-action">
        ${renderTaskAction(campaign, task, status.status)}
      </div>
    </article>
  `;
}

function taskStatusIcon(status: TaskStatus, index: number) {
  if (status === "complete") return inlineIcon(Check, "proof-track-icon is-complete", 17);
  if (status === "locked") return inlineIcon(LockKeyhole, "proof-track-icon", 16);
  if (status === "pending") return inlineIcon(CircleDashed, "proof-track-icon is-pending", 16);
  return `<span class="proof-track-number">${String(index + 1).padStart(2, "0")}</span>`;
}

function renderTaskAction(campaign: Campaign, task: CampaignTask, status: TaskStatus) {
  if (status === "complete") return `<button class="done-button" type="button">Done</button>`;
  if (!state.account) return "";
  if (task.kind === "self-attested") {
    const record = readSelfTaskRecord(task.id);
    const links = (task.actionLinks || []).map((link) => `<a class="proof-task-launch" href="${escapeAttr(link.url)}" target="_blank" rel="noreferrer" data-action="start-self-task" data-task-id="${escapeAttr(task.id)}">${escapeHtml(link.label)} ${externalLinkIcon()}</a>`).join("");
    if (!record.startedAt) return `<div class="proof-action-stack self-task-actions"><div class="self-task-links">${links}</div><span class="task-action-note">Open a target to start the 60-second timer.</span></div>`;
    const remaining = Math.max(0, Number(task.timerSeconds || 60) * 1000 - (Date.now() - record.startedAt));
    if (remaining > 0) {
      window.setTimeout(() => render(), remaining + 50);
      return `<div class="proof-action-stack self-task-actions"><div class="self-task-links">${links}</div><button class="quiet-cta" type="button" disabled>Confirm in ${Math.ceil(remaining / 1000)}s</button></div>`;
    }
    return `<div class="proof-action-stack self-task-actions"><div class="self-task-links">${links}</div><button class="quiet-cta" type="button" data-action="confirm-self-task" data-task-id="${escapeAttr(task.id)}">Confirm completion</button></div>`;
  }
  if (task.kind === "automatic") return `<button class="quiet-cta" type="button" data-action="sync-proof">Check now</button>`;
  if (task.kind === "oauth-discord") {
    return `<button class="quiet-cta" type="button" data-action="start-oauth" data-provider="discord" ${!state.oauthConfig?.discord.enabled ? "disabled" : ""}>Verify Discord</button>`;
  }
  return `
    <div class="proof-action-stack">
      ${task.actionUrl && task.actionLabel ? `<a class="proof-task-launch" href="${escapeAttr(task.actionUrl)}" target="_blank" rel="noreferrer">${escapeHtml(task.actionLabel)} ${externalLinkIcon()}</a>` : ""}
      <form class="proof-form" data-form="proof-review" data-task-id="${task.id}" data-template-id="${escapeAttr(task.templateId || task.id)}" data-task-label="${escapeAttr(task.label)}" data-campaign="${campaign.id}">
        <input name="evidenceUri" required placeholder="${escapeAttr(task.evidencePlaceholder || "https://...")}" />
        <button type="submit" ${status === "pending" ? "disabled" : ""}>${status === "pending" ? "Pending" : "Submit proof"}</button>
      </form>
    </div>
  `;
}

function identityScoreSnapshot() {
  const tasks = campaigns.flatMap((campaign) => campaign.tasks);
  const completedTasks = tasks.filter((task) => taskStatus(task).status === "complete");
  const completed = completedTasks.length;
  const total = tasks.length;
  const points = completedTasks.reduce((sum, task) => sum + task.points, 0);
  const score = total ? Math.round((completed / total) * 100) : 0;
  const grade = score >= 90 ? "Proof complete" : score >= 70 ? "Agent native" : score >= 45 ? "Builder verified" : score > 0 ? "Signal started" : "Not scored";
  return { score, points, completed, total, grade };
}

function identityShareHref(score: number, points: number) {
  if (!state.account) return "";
  const explorerUrl = `${EXPLORER_BASE}/address/${state.account}`;
  const text = `My Ritual Quest identity scored ${score}/100 with ${points.toLocaleString("en-US")} verified points on Ritual Chain 1979.\n\n${explorerUrl}`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function renderIdentityScore() {
  const snapshot = identityScoreSnapshot();
  const proof = state.proof;
  const transactions = Math.max(Number(proof?.transactionCount || 0), Number(proof?.explorerTransactionCount || 0));
  const agents = proof?.nativeAgents.length || 0;
  const shareHref = identityShareHref(snapshot.score, snapshot.points);
  return `
    <section class="identity-score-panel" aria-label="Ritual proof score">
      <div class="identity-score-ring" style="--identity-score:${snapshot.score}" role="img" aria-label="Ritual proof score ${snapshot.score} out of 100">
        <span>${snapshot.score}</span>
        <small>/ 100</small>
      </div>
      <div class="identity-score-summary">
        <span class="identity-score-label">Ritual proof score</span>
        <h2>${escapeHtml(snapshot.grade)}</h2>
        <p>${state.account ? `${snapshot.completed} of ${snapshot.total} campaign tasks verified for ${shortAddress(state.account)}.` : "Connect a wallet to calculate your live score."}</p>
        <div class="identity-score-actions">
          ${shareHref
            ? `<a class="primary-cta identity-share" href="${escapeAttr(shareHref)}" target="_blank" rel="noreferrer">${inlineIcon(Send, "identity-share-icon", 16)} Share on X</a>`
            : `<button class="primary-cta" type="button" data-action="open-wallet">Connect wallet</button>`}
          ${state.account ? `<a class="identity-explorer-link" href="${escapeAttr(`${EXPLORER_BASE}/address/${state.account}`)}" target="_blank" rel="noreferrer">View proof ${externalLinkIcon()}</a>` : ""}
        </div>
      </div>
      <dl class="identity-score-stats">
        <div><dt>Quest points</dt><dd>${snapshot.points.toLocaleString("en-US")}</dd></div>
        <div><dt>Transactions</dt><dd>${transactions.toLocaleString("en-US")}</dd></div>
        <div><dt>Agents</dt><dd>${agents.toLocaleString("en-US")}</dd></div>
        <div><dt>Receipts</dt><dd>${state.receipts.length.toLocaleString("en-US")}</dd></div>
      </dl>
    </section>
  `;
}

function renderIdentity() {
  // Never reuse a Discord proof from another wallet or an earlier role-sync schema.
  const discord = socialProofMatchesWallet("discord") ? state.social.discord : undefined;
  const roles = verifiedDiscordRoleIds(discord);
  const roleIssue = discordRoleIssue(discord, roles);
  return `
    <section class="identity-page">
      <div class="identity-column">
        <div class="page-copy">
          <p class="kicker">Identity passport</p>
          <h1>A builder identity that persists.</h1>
          <p>An address, an authorized member record, and receipts that remain readable onchain.</p>
        </div>
        ${renderIdentityScore()}
        <form class="profile-form" data-form="profile">
          <h2>Onchain profile</h2>
          <label>Builder handle<input name="handle" value="${escapeAttr(state.profile?.handle || discord?.user.username || "")}" placeholder="ritual-builder" /></label>
          <label>Discord id<input name="discord" value="${escapeAttr(discord?.user.id || "")}" placeholder="verify Discord first" /></label>
          <label>X handle<input name="x" placeholder="@handle optional" /></label>
          <button type="submit" ${!state.account || !PROOFGRAPH_ADDRESS ? "disabled" : ""}>Commit profile</button>
          <small>${PROOFGRAPH_ADDRESS ? `Registry ${shortAddress(PROOFGRAPH_ADDRESS)}` : "Set VITE_PROOFGRAPH_ADDRESS to write onchain."}</small>
        </form>
      </div>
      <div class="passport-card">
        <div class="passport-banner"></div>
        <div class="passport-avatar">${discord?.user.avatar ? `<img src="${escapeAttr(discord.user.avatar)}" alt="" />` : `<img src="${LOGO}" alt="" />`}</div>
        <span class="member-badge">${socialProofMatchesWallet("discord") ? "verified" : "not linked"}</span>
        <h2>${escapeHtml(discord?.user.displayName || discord?.user.username || "Ritual builder")}</h2>
        <p>${state.account ? shortAddress(state.account) : "Start with wallet connect."}</p>
        <div class="role-cloud">${roles.length ? roles.slice(0, 18).map(renderRole).join("") : `<span class="role-pill"><i></i>No roles loaded</span>`}</div>
        ${roleIssue ? `<p class="role-hint">${escapeHtml(roleIssue)}</p>` : ""}
        ${state.account ? `<button class="quiet-cta passport-refresh" type="button" data-action="start-oauth" data-provider="discord">Refresh Discord roles</button>` : ""}
      </div>
    </section>
  `;
}

function discordRoleIssue(discord: SocialProof | undefined, roles: string[]) {
  if (!discord) return "Connect Discord to load roles.";
  if (roles.length) return "";
  const error = typeof discord.checks.memberFetchError === "string" ? discord.checks.memberFetchError : "";
  if (error) return `Role sync failed: ${error}. Reconnect Discord with role access.`;
  if (discord.checks.guildMember === false) return "Discord linked, but this user is not in the Ritual server.";
  return "Discord linked. Refresh once to read the current server role list.";
}

function verifiedDiscordRoleIds(discord: SocialProof | undefined) {
  if (!discord || Number(discord.checks.roleSnapshotVersion) !== 2) return [];
  const source = discord.checks.memberRoleIds;
  if (!Array.isArray(source)) return [];
  return [...new Set(source.filter((roleId): roleId is string => typeof roleId === "string" && roleById.has(roleId)))].slice(0, 18);
}

function hasAttestorRole() {
  const allowed = state.oauthConfig?.attestor.roleIds || [];
  if (!allowed.length) return false;
  const discord = socialProofMatchesWallet("discord") ? state.social.discord : undefined;
  const memberRoles = discord?.checks.memberRoleIds;
  if (!Array.isArray(memberRoles)) return false;
  return allowed.some((roleId) => memberRoles.includes(roleId));
}

function canAccessReview() {
  return Boolean(state.account && hasAttestorRole());
}

function reviewAccessMessage() {
  if (!state.account) return "Connect your wallet first.";
  if (!socialProofMatchesWallet("discord")) return "Connect Discord on this wallet to check reviewer access.";
  if (!state.oauthConfig?.attestor.roleConfigured) return "No reviewer role IDs are configured yet.";
  if (!hasAttestorRole()) return "This Discord account does not have a reviewer role.";
  return "Your Discord role has review access.";
}

function taskForProofType(proofType: string) {
  const campaignTasks = allCampaigns().flatMap((campaign) => campaign.tasks);
  return [...Object.values(taskBook), ...campaignTasks]
    .find((task) => task.kind === "review" && proofTypeFor(task.id).toLowerCase() === proofType.toLowerCase());
}

function renderReviewPage() {
  if (!canAccessReview()) {
    return `
      <section class="review-page review-locked">
        <div class="page-copy">
          <p class="kicker">Reviewer console</p>
          <h1>Review access is restricted.</h1>
          <p>${escapeHtml(reviewAccessMessage())}</p>
          <a class="quiet-cta" href="#identity">Open identity</a>
        </div>
      </section>
    `;
  }

  const { loading, error, queue } = state.review;
  const content = loading
    ? `<div class="empty-panel">Reading pending requests from ProofGraphRegistry...</div>`
    : error
      ? `<div class="empty-panel">${escapeHtml(error)}</div>`
      : queue.length
        ? queue.map(renderReviewRequest).join("")
        : `<div class="empty-panel">No open proof requests found onchain.</div>`;

  return `
    <section class="review-page">
      <div class="review-heading">
        <div class="page-copy">
          <p class="kicker">Role-gated review</p>
          <h1>Review requests.</h1>
          <p>Accept valid evidence or reject it with a clear reason. Rejected builders can submit a corrected proof.</p>
        </div>
        <button class="quiet-cta" type="button" data-action="refresh-review">Refresh queue</button>
      </div>
      <section class="review-queue" aria-label="Open proof requests">
        ${content}
      </section>
    </section>
  `;
}

function renderReviewRequest(request: ReviewRequest) {
  const task = taskForProofType(request.proofType);
  const detail = task
    ? `${task.label} / ${task.points} points`
    : `Unknown review type / ${shortAddress(request.proofType)}`;
  const action = task
    ? `<div class="review-actions">
        <button class="primary-cta review-approve" type="button" data-action="approve-review" data-builder="${escapeAttr(request.builder)}" data-proof-type="${escapeAttr(request.proofType)}" data-proof-hash="${escapeAttr(request.proofHash)}" data-evidence-uri="${escapeAttr(request.evidenceUri)}" data-task-id="${escapeAttr(task.id)}">Accept</button>
        <details class="review-reject">
          <summary>Reject</summary>
          <form data-form="reject-review" data-builder="${escapeAttr(request.builder)}" data-proof-type="${escapeAttr(request.proofType)}" data-proof-hash="${escapeAttr(request.proofHash)}" data-evidence-uri="${escapeAttr(request.evidenceUri)}" data-task-id="${escapeAttr(task.id)}">
            <label>Reason<input name="reason" required maxlength="280" placeholder="Tell the builder what to fix" /></label>
            <button type="submit">Confirm rejection</button>
          </form>
        </details>
      </div>`
    : `<span class="task-action-note">Unknown proof type</span>`;

  return `
    <article class="review-request">
      <div class="review-request-copy">
        <p>${escapeHtml(detail)}</p>
        <h2>${escapeHtml(shortAddress(request.builder))}</h2>
        <span>Request block ${formatScore(request.blockNumber)} / ${escapeHtml(shortAddress(request.proofHash))}</span>
      </div>
      <a class="review-evidence" href="${escapeAttr(request.evidenceUri)}" target="_blank" rel="noreferrer">Open evidence ${externalLinkIcon()}</a>
      ${action}
    </article>
  `;
}

function renderLeaderboardPage() {
  const coreTasks = campaigns.flatMap((campaign) => campaign.tasks);
  const completedTasks = coreTasks.filter((task) => taskStatus(task).status === "complete");
  const earnedPoints = completedTasks.reduce((total, task) => total + task.points, 0);
  return `
    <section class="board-page">
      <div class="page-copy">
        <p class="kicker">Leaderboard</p>
        <h1>Every completed task counts.</h1>
        <p>Every verified task across the core campaigns adds its points as soon as the proof is complete.</p>
      </div>
      <button class="primary-cta" type="button" data-action="read-leaderboard" ${!PROOFGRAPH_ADDRESS ? "disabled" : ""}>Refresh board</button>
      ${state.account ? `
        <div class="board-eligibility ${completedTasks.length ? "eligible" : "locked"}">
          <span>${completedTasks.length}/${coreTasks.length} done</span>
          <strong>${earnedPoints.toLocaleString("en-US")} points earned</strong>
          <small>Completed tasks add points immediately. Open tasks add zero.</small>
          <a href="#explore">${completedTasks.length === coreTasks.length ? "Review campaigns" : "Continue campaigns"} ${externalLinkIcon()}</a>
        </div>
      ` : ""}
      <div class="board-table">
        ${state.leaderboard.length ? state.leaderboard.map(renderBoardRow).join("") : `
          <div class="empty-panel board-empty">
            <strong>No completed tasks yet.</strong>
            <span>Complete one core campaign task, then refresh the board.</span>
            <button class="quiet-cta" type="button" data-action="read-leaderboard" ${!PROOFGRAPH_ADDRESS ? "disabled" : ""}>Read registry</button>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderBlog() {
  const { loading, error, feed } = state.blog;
  return `
    <section class="blog-page">
      <div class="page-copy">
        <p class="kicker">From Ritual Foundation</p>
        <h1>Research, systems, and the chain.</h1>
        <p>Official Ritual Foundation writing, linked at the source.</p>
      </div>
      <div class="blog-toolbar">
        <a class="quiet-cta" href="https://www.ritualfoundation.org/blog" target="_blank" rel="noreferrer">Open Ritual Foundation</a>
        <button class="quiet-cta" type="button" data-action="refresh-blog" ${loading ? "disabled" : ""}>${loading ? "Syncing..." : "Refresh articles"}</button>
      </div>
      <div class="blog-grid blog-live-grid">
        ${loading ? renderBlogLoading() : ""}
        ${!loading && error ? renderBlogError(error) : ""}
        ${!loading && !error && feed?.articles.length ? feed.articles.map(renderRitualBlogCard).join("") : ""}
        ${!loading && !error && feed && !feed.articles.length ? `<div class="empty-panel"><strong>No articles returned.</strong><span>Open the official Ritual Foundation blog to view current posts.</span></div>` : ""}
      </div>
    </section>
  `;
}

function renderBlogLoading() {
  return `
    <article class="blog-card blog-loading"><i></i><i></i><i></i></article>
    <article class="blog-card blog-loading"><i></i><i></i><i></i></article>
    <article class="blog-card blog-loading"><i></i><i></i><i></i></article>
  `;
}

function renderBlogError(error: string) {
  return `
    <div class="empty-panel blog-error">
      <strong>Blog feed is unavailable right now.</strong>
      <span>${escapeHtml(error)}</span>
      <a class="quiet-cta" href="https://www.ritualfoundation.org/blog" target="_blank" rel="noreferrer">Open official blog</a>
    </div>
  `;
}

function renderRitualBlogCard(article: RitualBlogArticle) {
  const date = formatBlogDate(article.publishedAt);
  const image = article.image
    ? `<a class="blog-cover" href="${escapeAttr(article.url)}" target="_blank" rel="noreferrer"><img src="${escapeAttr(article.image)}" alt="" loading="lazy" /></a>`
    : "";
  return `
    <article class="blog-card blog-live-card">
      ${image}
      <div class="blog-card-body">
        <span>${escapeHtml(date)}</span>
        <h2><a href="${escapeAttr(article.url)}" target="_blank" rel="noreferrer">${escapeHtml(article.title)}</a></h2>
        <p>${escapeHtml(article.excerpt)}</p>
        <a class="blog-read" href="${escapeAttr(article.url)}" target="_blank" rel="noreferrer">Read at Ritual Foundation ${externalLinkIcon()}</a>
      </div>
    </article>
  `;
}

function formatBlogDate(value: string) {
  if (!value) return "Ritual Foundation";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [day, month, year] = value.split("/").map(Number);
    return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Ritual Foundation";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function calendarWeekStart(offset = 0) {
  const date = new Date();
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1 + offset * 7);
  date.setHours(0, 0, 0, 0);
  return date;
}

function calendarDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCalendarRange(start: Date) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const formatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatCalendarTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time pending";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCalendarDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function calendarEventOwnerActions(event: CalendarEvent) {
  if (!event.canManage) return "";
  return `
    <div class="owned-item-actions calendar-owner-actions" aria-label="Event controls">
      <button type="button" data-action="edit-event" data-event="${escapeAttr(event.id)}" aria-label="Edit event" title="Edit event">${inlineIcon(Pencil, "owned-item-icon", 15)}</button>
      <button class="is-danger" type="button" data-action="delete-event" data-event="${escapeAttr(event.id)}" aria-label="Delete event" title="Delete event">${inlineIcon(Trash2, "owned-item-icon", 15)}</button>
    </div>
  `;
}

function calendarEventCard(event: CalendarEvent, compact = false) {
  if (compact) {
    const title = escapeHtml(event.title);
    return event.url
      ? `<a class="calendar-week-event" href="${escapeAttr(event.url)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeAttr(event.title)} event details"><span>${title}</span></a>`
      : `<span class="calendar-week-event is-unlinked" aria-label="${escapeAttr(event.title)} has no event link"><span>${title}</span></span>`;
  }
  const eventDate = new Date(event.startsAt);
  const validDate = !Number.isNaN(eventDate.getTime());
  const cover = event.imageUrl || CATEGORY_ART.Community;
  const action = event.url
    ? `<a class="calendar-event-link" href="${escapeAttr(event.url)}" target="_blank" rel="noreferrer" aria-label="Open event link">${externalLinkIcon()}</a>`
    : "";
  return `
    <article class="calendar-event">
      <figure class="calendar-event-media">
        <img data-event-cover src="${escapeAttr(cover)}" alt="" loading="lazy" />
        <time class="calendar-event-date" datetime="${escapeAttr(event.startsAt)}"><span>${validDate ? escapeHtml(new Intl.DateTimeFormat("en", { month: "short" }).format(eventDate)) : "TBD"}</span><strong>${validDate ? eventDate.getDate() : "-"}</strong></time>
      </figure>
      <div class="calendar-event-copy">
        <div class="calendar-event-topline"><span>${escapeHtml(formatCalendarTime(event.startsAt))}</span>${event.location ? `<i>${escapeHtml(event.location)}</i>` : ""}</div>
        <strong>${escapeHtml(event.title)}</strong>
        ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
        ${event.createdBy ? `<small>Published by ${escapeHtml(event.createdBy)}</small>` : ""}
      </div>
      ${action || event.canManage ? `<div class="calendar-event-actions">${calendarEventOwnerActions(event)}${action}</div>` : ""}
    </article>
  `;
}

function calendarEventsForFilter(events: CalendarEvent[]) {
  const query = state.calendar.query.trim().toLowerCase();
  const now = Date.now();
  return events.filter((event) => {
    const isCompleted = Date.parse(event.endsAt) < now;
    if (state.calendar.filter === "upcoming" && isCompleted) return false;
    if (state.calendar.filter === "completed" && !isCompleted) return false;
    if (!query) return true;
    return [event.title, event.description, event.location, event.createdBy].join(" ").toLowerCase().includes(query);
  });
}

function calendarMonthLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Schedule";
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

function renderCalendarSchedule(events: CalendarEvent[], allEvents: CalendarEvent[]) {
  if (!events.length) {
    const hasEvents = allEvents.length > 0;
    return `
      <section class="calendar-zero-state">
        <span class="calendar-zero-glyph">01</span>
        <div>
          <p class="kicker">${hasEvents ? "No matching events" : "Calendar open"}</p>
          <h2>${hasEvents ? "Try another filter or search." : "No events have been published yet."}</h2>
          <p>${hasEvents ? "The event directory only shows entries matching your current view." : "When an authorized organizer publishes a session, workshop, or community event, it will appear here for everyone."}</p>
        </div>
      </section>
    `;
  }
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = calendarMonthLabel(event.startsAt);
    groups.set(key, [...(groups.get(key) || []), event]);
  }
  return `
    <div class="calendar-directory">
      ${Array.from(groups.entries()).map(([month, entries]) => `
        <section class="calendar-month-group">
          <header><p>${escapeHtml(month)}</p><span>${entries.length} ${entries.length === 1 ? "event" : "events"}</span></header>
          <div class="calendar-event-list">${entries.map((event) => calendarEventCard(event)).join("")}</div>
        </section>
      `).join("")}
    </div>
  `;
}

function renderCalendarWeek(events: CalendarEvent[], start: Date, today: string) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const date = new Date(event.startsAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = calendarDateKey(date);
    byDay.set(key, [...(byDay.get(key) || []), event]);
  }
  return `
    <div class="calendar-board" role="grid" aria-label="Weekly event calendar">
      ${days.map((day) => {
        const key = calendarDateKey(day);
        const items = byDay.get(key) || [];
        const isToday = key === today;
        return `
          <section class="calendar-day ${isToday ? "is-today" : ""}" role="gridcell">
            <header><span>${escapeHtml(new Intl.DateTimeFormat("en", { weekday: "short" }).format(day))}</span><strong>${day.getDate()}</strong></header>
            <div class="calendar-day-events">
              ${items.length ? items.map((event) => calendarEventCard(event, true)).join("") : `<span class="calendar-empty">No events</span>`}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderCalendar() {
  const { loading, error, feed, weekOffset } = state.calendar;
  const start = calendarWeekStart(weekOffset);
  const today = calendarDateKey(new Date());
  const events = (feed?.events || []).slice().sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const listedEvents = calendarEventsForFilter(events);
  const upcomingCount = events.filter((event) => Date.parse(event.endsAt) >= Date.now()).length;
  const completedCount = Math.max(events.length - upcomingCount, 0);

  return `
    <section class="calendar-page">
      <header class="calendar-head">
        <div class="page-copy">
          <p class="kicker">Community schedule</p>
          <h1>Events, not noise.</h1>
          <p>Sessions, workshops, and builder meetups, published by the people trusted to run them.</p>
        </div>
        <div class="calendar-metrics" aria-label="Event totals">
          <div><strong>${events.length}</strong><span>Total events</span></div>
          <div><strong>${upcomingCount}</strong><span>Upcoming</span></div>
          <div><strong>${completedCount}</strong><span>Completed</span></div>
        </div>
        ${feed?.canCreate
          ? `<button class="primary-cta calendar-create-button" type="button" data-action="open-event-composer">Create event</button>`
          : feed?.editorRoleConfigured || feed?.editorWalletConfigured
            ? `<button class="primary-cta calendar-create-button" type="button" data-action="start-oauth" data-provider="discord">Verify organizer access</button>`
            : ""}
      </header>
      ${loading ? `<div class="calendar-loading" aria-label="Loading calendar"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>` : ""}
      ${!loading && error ? `<div class="empty-panel"><strong>Calendar is unavailable right now.</strong><span>${escapeHtml(error)}</span><button class="quiet-cta" type="button" data-action="refresh-calendar">Retry</button></div>` : ""}
      ${!loading && !error ? `
        <div class="calendar-toolbar">
          <div class="calendar-view-tabs" role="tablist" aria-label="Calendar view">
            <button class="${state.calendar.view === "schedule" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.calendar.view === "schedule"}" data-calendar-view="schedule">Schedule</button>
            <button class="${state.calendar.view === "week" ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.calendar.view === "week"}" data-calendar-view="week">Week</button>
          </div>
          ${state.calendar.view === "schedule" ? `
            <div class="calendar-filters" aria-label="Filter events">
              ${(["all", "upcoming", "completed"] as CalendarFilter[]).map((filter) => `<button class="${state.calendar.filter === filter ? "is-active" : ""}" type="button" data-calendar-filter="${filter}">${filter === "all" ? "All" : filter === "upcoming" ? "Upcoming" : "Completed"}<b>${filter === "all" ? events.length : filter === "upcoming" ? upcomingCount : completedCount}</b></button>`).join("")}
            </div>
            <label class="calendar-search"><span>Find</span><input data-action="calendar-search" type="search" value="${escapeAttr(state.calendar.query)}" placeholder="Search events" autocomplete="off" /></label>
          ` : `
            <div class="calendar-controls" aria-label="Calendar navigation">
              <button class="icon-control" type="button" data-action="calendar-previous" aria-label="Previous week">&#8592;</button>
              <strong>${escapeHtml(formatCalendarRange(start))}</strong>
              <button class="icon-control" type="button" data-action="calendar-next" aria-label="Next week">&#8594;</button>
              <button class="quiet-cta calendar-today" type="button" data-action="calendar-today">This week</button>
            </div>
          `}
        </div>
        ${state.calendar.view === "schedule" ? renderCalendarSchedule(listedEvents, events) : renderCalendarWeek(listedEvents, start, today)}
        ${feed?.canCreate || state.calendar.editingId ? renderCalendarComposer() : ""}
      ` : ""}
    </section>
  `;
}

function renderCalendarComposer() {
  const editingEvent = state.calendar.feed?.events.find((event) => event.id === state.calendar.editingId && event.canManage);
  const editing = Boolean(editingEvent);
  const draft = editingEvent || state.calendar.draft;
  return `
    <section class="event-composer" id="event-composer">
      <div>
        <p class="kicker">Event editor</p>
        <h2>${editing ? "Update your calendar event." : "Publish to the shared calendar."}</h2>
        <p>${editing ? "Only your Discord account can save changes or remove this event." : "Only approved Discord roles can publish. Every saved event is visible to the full community."}</p>
      </div>
      <form data-form="calendar-event">
        ${state.calendar.formError ? `<div class="event-form-error" role="alert"><strong>Event was not published.</strong><span>${escapeHtml(state.calendar.formError)}</span></div>` : ""}
        <div class="event-composer-fields">
          <label>Event title<input name="title" maxlength="100" placeholder="Ritual builder session" value="${escapeAttr(draft?.title || "")}" required /></label>
          <label>Location<input name="location" maxlength="100" placeholder="Discord Stage or city" value="${escapeAttr(draft?.location || "")}" /></label>
          <label>Starts<input name="startsAt" type="datetime-local" value="${escapeAttr(toLocalDateTimeValue(draft?.startsAt || ""))}" required /></label>
          <label>Ends<input name="endsAt" type="datetime-local" value="${escapeAttr(toLocalDateTimeValue(draft?.endsAt || ""))}" required /></label>
          <label>Event link<input name="url" type="url" placeholder="https://..." value="${escapeAttr(draft?.url || "")}" required /></label>
          <div class="event-image-field image-url-field">
            <label>Cover image URL <small>Public HTTPS image</small><input name="imageUrl" type="url" inputmode="url" placeholder="https://.../event-cover.jpg" value="${escapeAttr(draft?.imageUrl || "")}" /></label>
            ${renderImageUrlGuide("data-event-cover-status", "Community artwork")}
          </div>
          <label class="event-description">Event details<textarea name="description" maxlength="1000" rows="4" placeholder="Tell members what the session covers and what they should prepare.">${escapeHtml(draft?.description || "")}</textarea></label>
          <div class="event-composer-actions">
            ${editing ? `<button class="quiet-cta" type="button" data-action="cancel-event-edit">${inlineIcon(X, "event-action-icon", 15)} Cancel</button>` : ""}
            <button class="primary-cta" type="submit">${editing ? "Save changes" : "Publish event"}</button>
          </div>
        </div>
        <aside class="event-draft-preview" aria-label="Event preview">
          <span>Event preview</span>
          <figure>
            <img data-event-image-preview src="${escapeAttr(draft?.imageUrl || CATEGORY_ART.Community)}" alt="" />
            <time data-event-date-preview>Date and time</time>
          </figure>
          <strong data-event-title-preview>${escapeHtml(draft?.title || "Untitled event")}</strong>
          <small>Cover, title, and schedule will appear in Calendar.</small>
        </aside>
      </form>
    </section>
  `;
}

function bindCalendarComposer() {
  const form = document.querySelector<HTMLFormElement>("[data-form='calendar-event']");
  if (!form) return;
  const title = form.elements.namedItem("title") as HTMLInputElement | null;
  const startsAt = form.elements.namedItem("startsAt") as HTMLInputElement | null;
  const imageUrl = form.elements.namedItem("imageUrl") as HTMLInputElement | null;
  const previewImage = form.querySelector<HTMLImageElement>("[data-event-image-preview]");
  const previewTitle = form.querySelector<HTMLElement>("[data-event-title-preview]");
  const previewDate = form.querySelector<HTMLElement>("[data-event-date-preview]");
  const coverStatus = form.querySelector<HTMLElement>("[data-event-cover-status]");

  const setCoverStatus = (message: string, stateName: "fallback" | "checking" | "ready" | "error") => {
    if (!coverStatus) return;
    coverStatus.dataset.state = stateName;
    const copy = coverStatus.querySelector("span");
    if (copy) copy.textContent = message;
  };

  const sync = () => {
    const imageValue = imageUrl?.value.trim() || "";
    const imageValid = !imageValue || /^https:\/\/[^\s]+$/i.test(imageValue);
    imageUrl?.setCustomValidity(imageValid ? "" : "Use a public image link that starts with https://.");
    if (previewImage) {
      previewImage.onload = null;
      previewImage.onerror = null;
      if (!imageValue) {
        previewImage.src = CATEGORY_ART.Community;
        setCoverStatus("No custom cover. Community artwork will be used.", "fallback");
      } else if (!imageValid) {
        previewImage.src = CATEGORY_ART.Community;
        setCoverStatus("The link must start with https://.", "error");
      } else {
        setCoverStatus("Checking the image link...", "checking");
        previewImage.onload = () => setCoverStatus("Cover loaded. This image is ready to publish.", "ready");
        previewImage.onerror = () => {
          previewImage.onerror = null;
          previewImage.src = CATEGORY_ART.Community;
          setCoverStatus("This image could not be opened. Check that the link is public and direct.", "error");
        };
        previewImage.src = imageValue;
      }
    }
    if (previewTitle) previewTitle.textContent = title?.value.trim() || "Untitled event";
    if (previewDate) {
      const date = startsAt?.value ? new Date(startsAt.value) : undefined;
      previewDate.textContent = date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
        : "Date and time";
    }
  };

  [title, startsAt, imageUrl].forEach((field) => {
    field?.addEventListener("input", sync);
    field?.addEventListener("change", sync);
  });
  sync();
}

function renderArchitecture() {
  return `
    <section class="architecture-page">
      <div class="page-copy">
        <p class="kicker">Execution map</p>
        <h1>The proof path before execution.</h1>
        <p>Address reads, authorized identity, public evidence, and registry receipts stay separate until the chain records the result.</p>
      </div>
      <div class="protocol-grid">
        ${archNode("01", "Address", "The connected address becomes the execution identity.")}
        ${archNode("02", "Chain reads", "RPC and Explorer return transactions, contracts, and agents.")}
        ${archNode("03", "Member record", "Discord OAuth reads an authorized identity record.")}
        ${archNode("04", "Public proof", "Links wait for an attestor before they become score.")}
        ${archNode("05", "Receipt", "ProofGraphRegistry stores the result and its points.")}
      </div>
      <aside class="protocol-sources" aria-label="Official Ritual resources">
        <p>Continue in the source</p>
        ${protocolSource("Documentation", "Execution, precompiles, privacy, and keys.", "https://docs.ritualfoundation.org/")}
        ${protocolSource("dApp Skills", "Build and deployment workflows for Ritual.", "https://skills.ritualfoundation.org/")}
        ${protocolSource("Visualized", "Execution, consensus, and protocol guarantees.", "https://visualized.ritualfoundation.org/")}
        ${protocolSource("Whitepaper", "The protocol thesis and system design.", "https://whitepaper.ritualfoundation.org/")}
      </aside>
    </section>
  `;
}

function protocolSource(title: string, detail: string, href: string) {
  return `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span><em class="source-action">Open source ${externalLinkIcon()}</em></a>`;
}

function inlineIcon(Icon: typeof ArrowRight, className: string, size: number) {
  const icon = createElement(Icon, {
    class: className,
    width: String(size),
    height: String(size),
    "stroke-width": "1.9",
    "aria-hidden": "true",
    focusable: "false"
  });
  return icon.outerHTML;
}

function externalLinkIcon() {
  return `<span class="external-link-frame" aria-hidden="true">${inlineIcon(ExternalLink, "external-link-icon", 14)}</span>`;
}

function filteredCampaigns() {
  const query = state.query.trim().toLowerCase();
  let list = allCampaigns().filter((campaign) => {
    const text = `${campaign.title} ${campaign.short} ${campaign.category} ${campaign.tags.join(" ")}`.toLowerCase();
    const matchesQuery = !query || text.includes(query);
    const matchesFilter = state.filter === "All" || campaign.category === state.filter;
    const matchesTab =
      state.activeTab === "all" ||
      (state.activeTab === "following" && state.following.includes(campaign.id)) ||
      (state.activeTab === "watchlist" && state.account !== "" && campaignStats(campaign).progress > 0 && campaignStats(campaign).progress < 100) ||
      (state.activeTab === "smart" && campaignStats(campaign).openTasks > 0);
    return matchesQuery && matchesFilter && matchesTab;
  });
  if (state.sort === "points") list = list.sort((a, b) => campaignStats(b).totalPoints - campaignStats(a).totalPoints);
  if (state.sort === "progress") list = list.sort((a, b) => campaignStats(b).progress - campaignStats(a).progress);
  return list;
}

function allCampaigns() {
  return [...campaigns, ...(state.campaignDirectory.feed?.campaigns || [])];
}

function campaignFromApi(item: CampaignApiItem): Campaign | undefined {
  if (!item || typeof item !== "object") return undefined;
  const category = FILTER_CHIPS.includes(item.category) && item.category !== "All" ? item.category : "";
  const taskIds = Array.isArray(item.taskIds) ? [...new Set(item.taskIds.map(String))] : [];
  const templates = taskIds
    .filter((taskId) => taskId === "wallet-link" || CREATOR_TASK_IDS.includes(taskId))
    .map((taskId) => taskBook[taskId])
    .filter((task): task is CampaignTask => Boolean(task));
  const customTask = customTaskFromApi(item.id, item.customTask);
  const imageUrl = /^https:\/\//i.test(String(item.imageUrl || "")) ? String(item.imageUrl) : "";
  if (!/^community-[a-z0-9-]{3,80}$/.test(String(item.id || "")) || !item.title || !item.description || !category || (templates.length < 2 && !customTask)) return undefined;
  const tasks: CampaignTask[] = templates.map((template) => ({
    ...template,
    id: template.kind === "review" ? `${item.id}:${template.id}` : template.id,
    templateId: template.id
  }));
  if (customTask) tasks.push(customTask);
  const accent = category.toLowerCase() as Campaign["accent"];
  const totalPoints = tasks.reduce((sum, task) => sum + task.points, 0);
  return {
    id: item.id,
    title: item.title,
    short: item.description,
    description: item.description,
    host: item.createdBy ? `Created by ${item.createdBy}` : "Ritual Community",
    category,
    reward: `${totalPoints} pts`,
    badge: item.badge || `${category} campaign`,
    accent,
    tags: tasks.filter((task) => task.id !== "wallet-link").slice(0, 3).map((task) => task.label),
    tasks,
    imageUrl,
    createdBy: item.createdBy,
    community: true,
    taskIds,
    customTask: item.customTask || null,
    canManage: Boolean(item.canManage)
  };
}

function customTaskFromApi(campaignId: string, value?: CustomSocialTask | null): CampaignTask | undefined {
  if (!value || typeof value !== "object") return undefined;
  const title = String(value.title || "").trim();
  const instructions = String(value.instructions || "").trim();
  const accounts = Array.isArray(value.accounts) ? value.accounts.map(String).filter((account) => /^[a-z0-9_]{1,15}$/i.test(account)).slice(0, 5) : [];
  const rawPosts = Array.isArray(value.posts) && value.posts.length
    ? value.posts
    : value.postUrl
      ? [{ url: value.postUrl, engagements: value.engagements || [] }]
      : [];
  const posts = rawPosts.slice(0, 5).map((target) => ({
    url: /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+\/?$/i.test(String(target?.url || "")) ? String(target.url) : "",
    engagements: Array.isArray(target?.engagements) ? target.engagements.map(String).filter((item) => ["like", "repost", "reply"].includes(item)) : []
  })).filter((target) => target.url);
  const postPrompt = String(value.postPrompt || "").trim();
  if (title.length < 3 || instructions.length < 8 || (!accounts.length && !posts.length && !postPrompt)) return undefined;
  const actionLinks = accounts.map((account) => ({ label: `Open @${account}`, url: `https://x.com/${account}` }));
  posts.forEach((target, index) => {
    const actions = target.engagements.length ? target.engagements.map((item) => item[0].toUpperCase() + item.slice(1)).join(" + ") : "Open";
    actionLinks.push({ label: `${actions} post ${index + 1}`, url: target.url });
  });
  if (postPrompt) actionLinks.push({ label: "Write post on X", url: `https://x.com/intent/post?text=${encodeURIComponent(postPrompt)}` });
  return {
    id: `${campaignId}:self-social`,
    templateId: "custom-social",
    label: title,
    points: 0,
    kind: "self-attested",
    requirement: "Self-attested / 60-second visit",
    detail: instructions,
    actionLinks,
    timerSeconds: 60
  };
}

function selectedCampaign() {
  return allCampaigns().find((campaign) => campaign.id === state.campaignId) || campaigns[0];
}

function campaignStats(campaign: Campaign) {
  const statuses = campaign.tasks.map((task) => taskStatus(task));
  const completed = statuses.filter((item) => item.status === "complete").length;
  const progress = Math.round((completed / campaign.tasks.length) * 100);
  const totalPoints = campaign.tasks.reduce((sum, task) => sum + task.points, 0);
  const liveParticipants = state.leaderboard.length || (state.profile?.active ? 1 : 0);
  return {
    completed,
    progress,
    totalPoints,
    openTasks: statuses.filter((item) => item.status === "open" || item.status === "pending").length,
    participantLabel: liveParticipants ? `${liveParticipants} live` : "locked"
  };
}

type SelfTaskRecord = {
  startedAt: number;
  completedAt: number;
};

function selfTaskStorageKey(taskId: string) {
  return `ritual-proofgraph:self-task:${state.account.toLowerCase()}:${taskId}`;
}

function readSelfTaskRecord(taskId: string): SelfTaskRecord {
  if (!state.account || !taskId) return { startedAt: 0, completedAt: 0 };
  try {
    const parsed = JSON.parse(localStorage.getItem(selfTaskStorageKey(taskId)) || "{}");
    return {
      startedAt: Number(parsed.startedAt || 0),
      completedAt: Number(parsed.completedAt || 0)
    };
  } catch {
    return { startedAt: 0, completedAt: 0 };
  }
}

function writeSelfTaskRecord(taskId: string, record: SelfTaskRecord) {
  if (!state.account || !taskId) return;
  localStorage.setItem(selfTaskStorageKey(taskId), JSON.stringify(record));
}

function beginSelfTask(taskId: string) {
  if (!state.account || !taskId) return;
  const current = readSelfTaskRecord(taskId);
  if (current.startedAt) return;
  writeSelfTaskRecord(taskId, { startedAt: Date.now(), completedAt: 0 });
  state.status = "Self-attested timer started. Return in 60 seconds.";
  window.setTimeout(() => render(), 0);
  window.setTimeout(() => render(), 60_050);
}

function confirmSelfTask(taskId: string) {
  if (!state.account || !taskId) return;
  const current = readSelfTaskRecord(taskId);
  if (!current.startedAt) return;
  if (Date.now() - current.startedAt < 60_000) {
    state.status = "Wait until the 60-second timer finishes.";
    render();
    return;
  }
  writeSelfTaskRecord(taskId, { ...current, completedAt: Date.now() });
  state.status = "Self-attested step completed. No onchain receipt was issued.";
  render();
}

function taskStatus(task: CampaignTask): { status: TaskStatus; label: string; reason: string } {
  if (!state.account) return { status: "locked", label: "Locked", reason: "Connect your wallet to start." };
  if (task.kind === "self-attested") {
    const record = readSelfTaskRecord(task.id);
    if (record.completedAt) return { status: "complete", label: "Self-attested", reason: "Confirmed by this wallet. No onchain receipt was issued." };
    if (record.startedAt) return { status: "open", label: "In progress", reason: "Complete the target actions, then confirm after 60 seconds." };
    return { status: "open", label: "Open", reason: "Open a target to start the self-attested timer." };
  }
  const proof = state.proof;
  const templateId = task.templateId || task.id;
  const proofType = proofTypeFor(task.id);
  const hasReceipt = state.receipts.some((receipt) => receipt.proofType.toLowerCase() === proofType.toLowerCase());
  const pending = state.pending.some((item) =>
    item.builder.toLowerCase() === state.account.toLowerCase() &&
    item.taskId === task.id &&
    !state.rejections.some((rejection) => reviewKey(rejection.builder, rejection.proofHash) === reviewKey(item.builder, item.proofHash))
  );
  const latestRejection = state.rejections
    .filter((item) => item.builder.toLowerCase() === state.account.toLowerCase() && item.proofType.toLowerCase() === proofType.toLowerCase())
    .sort((left, right) => right.blockNumber - left.blockNumber)[0];
  if (templateId === "wallet-link") return { status: "complete", label: "Done", reason: "Wallet connected." };
  if (!proof && task.kind === "automatic") return { status: "open", label: "Ready", reason: "Ready to check." };
  if (templateId === "chain-activity") return proof?.transactionCount ? { status: "complete", label: "Done", reason: `${proof.transactionCount} transaction${proof.transactionCount === 1 ? "" : "s"} found.` } : { status: "open", label: "Open", reason: "No Ritual transaction found." };
  if (templateId === "contract-deploy") return proof?.contractDeployCount ? { status: "complete", label: "Done", reason: `${proof.contractDeployCount} contract${proof.contractDeployCount === 1 ? "" : "s"} found.` } : { status: "open", label: "Open", reason: "No contract deployment found." };
  if (templateId === "native-agent") {
    const agents = proof?.nativeAgents || [];
    const paused = agents.filter((agent) => !agent.isAlive && agent.source !== "deployment-history").length;
    const historical = agents.filter((agent) => agent.source === "deployment-history").length;
    const sovereignDeployments = agents.filter((agent) => agent.source === "sovereign-factory-deployment").length;
    return agents.length
      ? { status: "complete", label: "Done", reason: sovereignDeployments ? `${sovereignDeployments} agent deployment${sovereignDeployments === 1 ? "" : "s"} found. The agent may be paused.` : `${agents.length} deployed agent${agents.length === 1 ? "" : "s"} found${paused ? `, ${paused} paused.` : historical ? ". Previous deployment still counts." : "."}` }
      : { status: "open", label: "Open", reason: "No Ritual agent deployment found." };
  }
  if (templateId === "discord-oath") return socialProofMatchesWallet("discord") ? { status: "complete", label: "Done", reason: "Discord connected." } : { status: "open", label: "Open", reason: "Connect Discord to complete this step." };
  if (hasReceipt) return { status: "complete", label: "Done", reason: "Proof approved onchain." };
  if (pending) return { status: "pending", label: "In review", reason: "Waiting for a reviewer." };
  if (latestRejection) return { status: "open", label: "Rejected", reason: `${latestRejection.reason} Update the evidence and submit again.` };
  return { status: "open", label: "Open", reason: "Submit a public URL." };
}

function sortLabel() {
  if (state.sort === "points") return "Top points";
  if (state.sort === "progress") return "Progress";
  return "Trending";
}

function renderRole(roleId: string) {
  const meta = roleById.get(roleId) || { name: "Ritual role", color: "#cfd6dc" };
  return `<span class="role-pill" title="${escapeAttr(roleId)}"><i style="--role:${meta.color}"></i>${escapeHtml(meta.name)}</span>`;
}

function renderBoardRow(profile: Profile, index: number) {
  return `
    <article class="board-row">
      <span>#${index + 1}</span>
      <strong>${escapeHtml(profile.handle || shortAddress(profile.wallet))}</strong>
      <small>${shortAddress(profile.wallet)}</small>
      <b>${formatScore(profile.score)}</b>
    </article>
  `;
}

function archNode(index: string, title: string, body: string) {
  return `<article><span>${index}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></article>`;
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-action='open-wallet']").forEach((button) => button.addEventListener("click", openRainbowConnect));
  document.querySelectorAll<HTMLElement>("[data-action='sync-proof']").forEach((button) => button.addEventListener("click", () => void syncWalletProof()));
  document.querySelectorAll<HTMLElement>("[data-action='read-leaderboard']").forEach((button) => button.addEventListener("click", () => void readLeaderboard()));
  document.querySelectorAll<HTMLElement>("[data-action='start-oauth']").forEach((button) => button.addEventListener("click", () => void startOAuth(button.dataset.provider === "discord" ? "discord" : "x")));
  document.querySelectorAll<HTMLElement>("[data-action='toggle-follow']").forEach((button) => button.addEventListener("click", () => toggleFollow(button.dataset.campaign || state.campaignId)));
  document.querySelectorAll<HTMLElement>("[data-action='start-self-task']").forEach((link) => link.addEventListener("click", () => beginSelfTask(link.dataset.taskId || "")));
  document.querySelectorAll<HTMLElement>("[data-action='confirm-self-task']").forEach((button) => button.addEventListener("click", () => confirmSelfTask(button.dataset.taskId || "")));
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.activeTab = button.dataset.tab as typeof state.activeTab; render(); }));
  document.querySelector<HTMLElement>("[data-action='toggle-filters']")?.addEventListener("click", () => { state.filtersOpen = !state.filtersOpen; render(); });
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filter || "All"; render(); }));
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view === "grid" ? "grid" : "list"; render(); }));
  document.querySelector<HTMLInputElement>("[data-action='search']")?.addEventListener("input", (event) => {
    state.query = (event.currentTarget as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLElement>("[data-action='sort']")?.addEventListener("click", () => {
    state.sort = state.sort === "trending" ? "points" : state.sort === "points" ? "progress" : "trending";
    render();
  });
  document.querySelector<HTMLSelectElement>("[data-action='campaign-sort']")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    state.sort = value === "points" || value === "progress" ? value : "trending";
    render();
  });
  document.querySelector<HTMLElement>("[data-action='only-claimable']")?.addEventListener("click", () => {
    state.activeTab = "watchlist";
    render();
  });
  document.querySelector<HTMLElement>("[data-action='refresh-blog']")?.addEventListener("click", () => void loadRitualBlog(true));
  document.querySelectorAll<HTMLElement>("[data-action='toggle-campaign-composer']").forEach((button) => button.addEventListener("click", () => {
    state.campaignDirectory.composerOpen = !state.campaignDirectory.composerOpen;
    state.campaignDirectory.editingId = "";
    state.status = "";
    render();
  }));
  document.querySelectorAll<HTMLElement>("[data-action='edit-campaign']").forEach((button) => button.addEventListener("click", () => openCampaignEditor(button.dataset.campaign || "")));
  document.querySelectorAll<HTMLElement>("[data-action='delete-campaign']").forEach((button) => button.addEventListener("click", () => void deleteCampaign(button.dataset.campaign || "")));
  document.querySelector<HTMLElement>("[data-action='cancel-campaign-edit']")?.addEventListener("click", () => {
    state.campaignDirectory.editingId = "";
    state.campaignDirectory.composerOpen = false;
    state.status = "";
    render();
  });
  document.querySelector<HTMLElement>("[data-action='refresh-calendar']")?.addEventListener("click", () => void loadCalendar(true));
  document.querySelector<HTMLElement>("[data-action='open-event-composer']")?.addEventListener("click", () => {
    state.calendar.editingId = "";
    state.calendar.draft = undefined;
    state.calendar.formError = "";
    render();
    document.querySelector<HTMLElement>("#event-composer")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  });
  document.querySelectorAll<HTMLElement>("[data-action='edit-event']").forEach((button) => button.addEventListener("click", () => openEventEditor(button.dataset.event || "")));
  document.querySelectorAll<HTMLElement>("[data-action='delete-event']").forEach((button) => button.addEventListener("click", () => void deleteCalendarEvent(button.dataset.event || "")));
  document.querySelector<HTMLElement>("[data-action='cancel-event-edit']")?.addEventListener("click", () => {
    state.calendar.editingId = "";
    state.calendar.draft = undefined;
    state.calendar.formError = "";
    render();
  });
  document.querySelector<HTMLElement>("[data-action='calendar-previous']")?.addEventListener("click", () => { state.calendar.weekOffset -= 1; render(); });
  document.querySelector<HTMLElement>("[data-action='calendar-next']")?.addEventListener("click", () => { state.calendar.weekOffset += 1; render(); });
  document.querySelector<HTMLElement>("[data-action='calendar-today']")?.addEventListener("click", () => { state.calendar.weekOffset = 0; render(); });
  document.querySelectorAll<HTMLElement>("[data-calendar-view]").forEach((button) => button.addEventListener("click", () => {
    state.calendar.view = button.dataset.calendarView === "week" ? "week" : "schedule";
    render();
  }));
  document.querySelectorAll<HTMLElement>("[data-calendar-filter]").forEach((button) => button.addEventListener("click", () => {
    const filter = button.dataset.calendarFilter;
    state.calendar.filter = filter === "upcoming" || filter === "completed" ? filter : "all";
    render();
  }));
  document.querySelector<HTMLInputElement>("[data-action='calendar-search']")?.addEventListener("input", (event) => {
    state.calendar.query = (event.currentTarget as HTMLInputElement).value;
    render();
  });
  document.querySelector<HTMLElement>("[data-action='refresh-review']")?.addEventListener("click", () => void loadReviewQueue(true));
  document.querySelectorAll<HTMLElement>("[data-action='approve-review']").forEach((button) => button.addEventListener("click", () => void approveReview(button)));
  document.querySelectorAll<HTMLFormElement>("[data-form='reject-review']").forEach((form) => form.addEventListener("submit", rejectReview));
  document.querySelector<HTMLFormElement>("[data-form='profile']")?.addEventListener("submit", submitProfile);
  document.querySelectorAll<HTMLFormElement>("[data-form='proof-review']").forEach((form) => form.addEventListener("submit", submitProofReview));
  document.querySelector<HTMLFormElement>("[data-form='campaign-create']")?.addEventListener("submit", submitCampaign);
  bindCampaignStudio();
  document.querySelector<HTMLFormElement>("[data-form='calendar-event']")?.addEventListener("submit", submitCalendarEvent);
  bindCalendarComposer();
  document.querySelectorAll<HTMLImageElement>("[data-event-cover]").forEach((image) => image.addEventListener("error", () => { image.src = CATEGORY_ART.Community; }));
}

function mountMotion() {
  const routeChanged = currentMotionRoute !== `${state.route}:${state.campaignId}`;
  currentMotionRoute = `${state.route}:${state.campaignId}`;
  if (prefersReducedMotion) return;
  const page = document.querySelector<HTMLElement>("main");
  const motionTargets = Array.from(document.querySelectorAll<HTMLElement>(".campaign-card, .quest-campaign-row, .quest-task, .proof-track, .passport-card, .profile-form, .protocol-grid article, .board-row, .review-request, .blog-card, .calendar-event, .calendar-day, .calendar-zero-state, .event-composer"));
  if (routeChanged && page) gsap.fromTo(page, { autoAlpha: 0, y: 18, filter: "blur(8px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.46, ease: "power3.out" });
  if (motionTargets.length) gsap.fromTo(motionTargets, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.035, ease: "power2.out" });
}

function mountQuestScene() {
  if (sceneMounted) return;
  sceneMounted = true;
  const canvas = document.querySelector<HTMLCanvasElement>("#ritual-scene");
  if (!canvas) return;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const signal = new THREE.Group();
  signal.position.set(0, -0.1, -2.2);
  scene.add(signal);

  // The real Ritual mark is the scene's anchor. The layers create a quiet
  // "signal in formation" feeling without competing with the product UI.
  const logoTexture = new THREE.TextureLoader().load(LOGO);
  logoTexture.colorSpace = THREE.SRGBColorSpace;
  const logoGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: logoTexture,
    color: 0x4cffbe,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  logoGlow.scale.set(6.4, 6.4, 1);
  signal.add(logoGlow);

  const logoCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: logoTexture,
    color: 0xe8fff4,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  }));
  logoCore.scale.set(4.55, 4.55, 1);
  signal.add(logoCore);

  const orbits = new THREE.Group();
  signal.add(orbits);
  orbits.add(
    makeSignalOrbit(3.05, 0x2bffae, 0.2, Math.PI * 0.31, Math.PI * 0.08),
    makeSignalOrbit(3.88, 0x8a68ff, 0.12, Math.PI * 0.71, Math.PI * 0.18),
    makeSignalOrbit(4.82, 0x8dffd6, 0.08, Math.PI * 0.48, Math.PI * 0.62)
  );

  const particleCount = 840;
  const positions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    const radius = 2.2 + Math.random() * 7.2;
    const angle = Math.random() * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = Math.sin(angle) * radius * 0.56 + (Math.random() - 0.5) * 2.4;
    positions[index * 3 + 2] = (Math.random() - 0.5) * 5.5 - 2;
  }
  const particlesGeo = new THREE.BufferGeometry();
  particlesGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dust = new THREE.Points(particlesGeo, new THREE.PointsMaterial({
    color: 0x93ffd5,
    size: 0.018,
    transparent: true,
    opacity: 0.5,
    depthWrite: false
  }));
  scene.add(dust);
  addRitualMarkParticles(signal);

  const pointer = new THREE.Vector2();
  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX / window.innerWidth - 0.5;
    pointer.y = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);
  const clock = new THREE.Clock();
  const animate = () => {
    const time = clock.getElapsedTime();
    signal.rotation.y += (pointer.x * 0.16 - signal.rotation.y) * 0.018;
    signal.rotation.x += (-pointer.y * 0.08 - signal.rotation.x) * 0.018;
    logoGlow.material.rotation = time * 0.035;
    logoGlow.material.opacity = 0.1 + Math.sin(time * 0.75) * 0.025;
    logoGlow.scale.setScalar(6.2 + Math.sin(time * 0.75) * 0.16);
    logoCore.material.rotation = -time * 0.018;
    orbits.rotation.z = time * 0.045;
    orbits.rotation.y = time * 0.025;
    dust.rotation.z = time * 0.006;
    renderer.render(scene, camera);
    if (!prefersReducedMotion) requestAnimationFrame(animate);
  };
  animate();
}

function makeSignalOrbit(radius: number, color: number, opacity: number, rotationX: number, rotationZ: number) {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 144; index += 1) {
    const angle = (index / 144) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.42, 0));
  }
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  line.rotation.x = rotationX;
  line.rotation.z = rotationZ;
  return line;
}

function addRitualMarkParticles(parent: THREE.Group) {
  const image = new Image();
  image.onload = () => {
    const sampleSize = 104;
    const source = document.createElement("canvas");
    source.width = sampleSize;
    source.height = sampleSize;
    const context = source.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    const positions: number[] = [];
    for (let y = 0; y < sampleSize; y += 3) {
      for (let x = 0; x < sampleSize; x += 3) {
        const alpha = pixels[(y * sampleSize + x) * 4 + 3];
        if (alpha < 110) continue;
        positions.push(
          (x / sampleSize - 0.5) * 4.45 + (Math.random() - 0.5) * 0.025,
          (0.5 - y / sampleSize) * 4.45 + (Math.random() - 0.5) * 0.025,
          (Math.random() - 0.5) * 0.16
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const particles = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0x9cffd4,
      size: 0.027,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    particles.position.z = 0.1;
    parent.add(particles);
  };
  image.src = LOGO;
}

function openRainbowConnect() {
  const wallet = getRainbowWallet();
  if (wallet?.openConnect) {
    wallet.openConnect();
    return;
  }
  state.status = "RainbowKit is loading. Try Connect again in a second.";
  render();
}

function requireRainbowWallet() {
  const wallet = getRainbowWallet();
  if (!state.account || !wallet?.connected) {
    openRainbowConnect();
    throw new Error("Connect wallet with RainbowKit first.");
  }
  return wallet;
}

async function syncWalletProof() {
  if (!state.account) {
    openRainbowConnect();
    return;
  }
  try {
    setBusy("Scanning Ritual RPC, explorer, and agent registry...");
    state.proof = await fetchWalletProof(state.account);
    await readCurrentProfile(false);
    state.status = `Quest checks synced for ${shortAddress(state.account)}.`;
  } catch (error) {
    state.status = errorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function loadCampaigns(force = false) {
  if (state.campaignDirectory.loading) return;
  if (state.campaignDirectory.loaded && !force) return;
  state.campaignDirectory = { ...state.campaignDirectory, loading: true, error: "" };
  render();
  try {
    const response = await fetch("/api/campaigns", { cache: "no-store", credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Campaign feed failed: ${response.status}`);
    const source: CampaignApiItem[] = Array.isArray(payload.campaigns) ? payload.campaigns : [];
    const customCampaigns = source
      .map((item) => campaignFromApi(item as CampaignApiItem))
      .filter((campaign): campaign is Campaign => Boolean(campaign));
    state.campaignDirectory = {
      ...state.campaignDirectory,
      loading: false,
      loaded: true,
      error: "",
      feed: {
        configured: Boolean(payload.configured),
        editorRoleConfigured: Boolean(payload.editorRoleConfigured),
        editorWalletConfigured: Boolean(payload.editorWalletConfigured),
        sessionConfigured: Boolean(payload.sessionConfigured),
        canCreate: Boolean(payload.canCreate),
        notice: typeof payload.notice === "string" ? payload.notice : "",
        campaigns: customCampaigns
      }
    };
  } catch (error) {
    state.campaignDirectory = { ...state.campaignDirectory, loading: false, loaded: true, error: errorMessage(error) };
  }
  render();
}

async function submitCampaign(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const editingId = state.campaignDirectory.editingId;
  const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit']");
  const errorBox = form.querySelector<HTMLElement>("[data-campaign-form-error]");
  const errorCopy = form.querySelector<HTMLElement>("[data-campaign-form-error-copy]");
  const idleButtonLabel = editingId ? "Save changes" : "Publish campaign";
  if (errorBox) errorBox.hidden = true;
  if (errorCopy) errorCopy.textContent = "";
  try {
    const values = new FormData(form);
    const selectedTaskIds = values.getAll("taskIds").map(String);
    const posts = [...form.querySelectorAll<HTMLElement>("[data-post-target]")]
      .map((row) => ({
        url: String(row.querySelector<HTMLInputElement>("input[name='customPostUrl']")?.value || "").trim(),
        engagements: [...row.querySelectorAll<HTMLInputElement>("input[name='customPostEngagement']:checked")].map((item) => item.value)
      }))
      .filter((target) => target.url || target.engagements.length > 0);
    const customTask = {
      title: String(values.get("customTitle") || ""),
      instructions: String(values.get("customInstructions") || ""),
      accounts: String(values.get("customAccounts") || "").split(",").map((account) => account.trim()).filter(Boolean),
      posts,
      postPrompt: String(values.get("customPostPrompt") || "")
    };
    const hasCustomTask = Object.values(customTask).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value.trim()));
    if (selectedTaskIds.length + (hasCustomTask ? 1 : 0) > 4) throw new Error("Choose no more than four campaign checks in total.");
    state.busy = true;
    state.status = editingId ? "Saving campaign changes..." : "Publishing campaign...";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = editingId ? "Saving..." : "Publishing...";
    }
    const response = await fetch(`/api/campaigns${editingId ? `?id=${encodeURIComponent(editingId)}` : ""}`, {
      method: editingId ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: String(values.get("title") || ""),
        description: String(values.get("description") || ""),
        category: String(values.get("category") || ""),
        imageUrl: String(values.get("imageUrl") || ""),
        taskIds: selectedTaskIds,
        customTask: hasCustomTask ? customTask : null
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Campaign ${editingId ? "update" : "publish"} failed: ${response.status}`);
    const created = campaignFromApi(payload.campaign as CampaignApiItem);
    if (!created) throw new Error("Campaign was stored but returned invalid data.");
    state.busy = false;
    state.status = editingId ? "Campaign changes saved." : "Campaign published.";
    state.campaignDirectory.composerOpen = false;
    state.campaignDirectory.editingId = "";
    state.campaignDirectory.loaded = false;
    await loadCampaigns(true);
    location.hash = `#campaign/${created.id}`;
  } catch (error) {
    state.busy = false;
    state.status = errorMessage(error);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = idleButtonLabel;
    }
    if (errorCopy) errorCopy.textContent = state.status;
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
    }
  }
}

function openCampaignEditor(campaignId: string) {
  const campaign = state.campaignDirectory.feed?.campaigns.find((item) => item.id === campaignId && item.canManage);
  if (!campaign) return;
  state.campaignDirectory.editingId = campaignId;
  state.campaignDirectory.composerOpen = true;
  state.status = "";
  if (state.route !== "explore") {
    location.hash = "#explore";
    window.setTimeout(() => document.querySelector<HTMLElement>(".campaign-studio")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" }), 50);
    return;
  }
  render();
  document.querySelector<HTMLElement>(".campaign-studio")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
}

async function deleteCampaign(campaignId: string) {
  const campaign = state.campaignDirectory.feed?.campaigns.find((item) => item.id === campaignId && item.canManage);
  if (!campaign || !window.confirm(`Delete "${campaign.title}"? This cannot be undone.`)) return;
  try {
    setBusy("Deleting campaign...");
    const response = await fetch(`/api/campaigns?id=${encodeURIComponent(campaignId)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Campaign delete failed: ${response.status}`);
    state.busy = false;
    state.status = "Campaign deleted.";
    state.campaignDirectory.editingId = "";
    state.campaignDirectory.composerOpen = false;
    await loadCampaigns(true);
    if (state.route === "campaign" && state.campaignId === campaignId) location.hash = "#explore";
  } catch (error) {
    state.busy = false;
    state.status = errorMessage(error);
    render();
  }
}

async function loadRitualBlog(force = false) {
  if (state.blog.loading) return;
  if (state.blog.loaded && !force) return;
  state.blog = { ...state.blog, loading: true, error: "" };
  render();
  try {
    const response = await fetch(`/api/ritual-blog${force ? "?refresh=1" : ""}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Blog feed failed: ${response.status}`);
    const articles = Array.isArray(payload.articles) ? payload.articles : [];
    state.blog = {
      loading: false,
      loaded: true,
      error: "",
      feed: {
        source: typeof payload.source === "string" ? payload.source : "https://www.ritualfoundation.org/blog",
        cachedAt: Number(payload.cachedAt || Date.now()),
        articles
      }
    };
  } catch (error) {
    state.blog = { ...state.blog, loading: false, loaded: true, error: errorMessage(error) };
  }
  render();
}

async function loadCalendar(force = false) {
  if (state.calendar.loading) return;
  if (state.calendar.loaded && !force) return;
  state.calendar = { ...state.calendar, loading: true, error: "" };
  render();
  try {
    const response = await fetch("/api/calendar", { cache: "no-store", credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Calendar feed failed: ${response.status}`);
    const events = Array.isArray(payload.events) ? payload.events : [];
    state.calendar = {
      ...state.calendar,
      loading: false,
      loaded: true,
      error: "",
      feed: {
        configured: Boolean(payload.configured),
        editorRoleConfigured: Boolean(payload.editorRoleConfigured),
        editorWalletConfigured: Boolean(payload.editorWalletConfigured),
        sessionConfigured: Boolean(payload.sessionConfigured),
        canCreate: Boolean(payload.canCreate),
        source: typeof payload.source === "string" ? payload.source : "",
        notice: typeof payload.notice === "string" ? payload.notice : "",
        events
      }
    };
  } catch (error) {
    state.calendar = { ...state.calendar, loading: false, loaded: true, error: errorMessage(error) };
  }
  render();
}

async function submitCalendarEvent(event: SubmitEvent) {
  event.preventDefault();
  try {
    const form = event.currentTarget as HTMLFormElement;
    const editingId = state.calendar.editingId;
    const values = new FormData(form);
    const startsAt = String(values.get("startsAt") || "");
    const endsAt = String(values.get("endsAt") || "");
    const draft: CalendarDraft = {
      title: String(values.get("title") || ""),
      startsAt: startsAt && !Number.isNaN(Date.parse(startsAt)) ? new Date(startsAt).toISOString() : "",
      endsAt: endsAt && !Number.isNaN(Date.parse(endsAt)) ? new Date(endsAt).toISOString() : "",
      location: String(values.get("location") || ""),
      url: String(values.get("url") || ""),
      imageUrl: String(values.get("imageUrl") || ""),
      description: String(values.get("description") || "")
    };
    state.calendar.draft = draft;
    state.calendar.formError = "";
    if (!draft.startsAt || !draft.endsAt || Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) throw new Error("Choose an end time after the start time.");
    setBusy(editingId ? "Saving event changes..." : "Publishing calendar event...");
    const response = await fetch(`/api/calendar${editingId ? `?id=${encodeURIComponent(editingId)}` : ""}`, {
      method: editingId ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...draft
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Event ${editingId ? "update" : "publish"} failed: ${response.status}`);
    state.status = editingId ? "Event changes saved." : "Event published to the shared calendar.";
    state.busy = false;
    state.calendar.editingId = "";
    state.calendar.draft = undefined;
    state.calendar.formError = "";
    state.calendar.loaded = false;
    await loadCalendar(true);
  } catch (error) {
    const message = errorMessage(error);
    state.busy = false;
    state.status = `Event was not published: ${message}`;
    state.calendar.formError = message;
    render();
    document.querySelector<HTMLElement>(".event-form-error")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
  }
}

function openEventEditor(eventId: string) {
  const event = state.calendar.feed?.events.find((item) => item.id === eventId && item.canManage);
  if (!event) return;
  state.calendar.editingId = eventId;
  state.calendar.draft = undefined;
  state.calendar.formError = "";
  render();
  document.querySelector<HTMLElement>("#event-composer")?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
}

async function deleteCalendarEvent(eventId: string) {
  const event = state.calendar.feed?.events.find((item) => item.id === eventId && item.canManage);
  if (!event || !window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
  try {
    setBusy("Deleting calendar event...");
    const response = await fetch(`/api/calendar?id=${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Event delete failed: ${response.status}`);
    state.busy = false;
    state.status = "Event deleted.";
    state.calendar.editingId = "";
    await loadCalendar(true);
  } catch (error) {
    state.busy = false;
    state.status = errorMessage(error);
    render();
  }
}

async function startOAuth(provider: "discord" | "x") {
  try {
    const wallet = requireRainbowWallet();
    setBusy(`Preparing ${provider} verification...`);
    const nonce = ethers.hexlify(ethers.randomBytes(16));
    const signature = await wallet.signMessage?.(oauthLinkMessage(provider, state.account, nonce));
    if (!signature) throw new Error("RainbowKit signer is not ready.");
    const response = await fetch(`/api/oauth?action=start&provider=${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: state.account, nonce, signature, returnTo: `${location.origin}${location.pathname}${location.hash || "#identity"}` })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (!payload.url && !(payload.bridgeUrl && payload.bridgeToken))) {
      throw new Error(payload.error || "OAuth backend is not running. Use npm run dev:full.");
    }
    if (payload.bridgeUrl && payload.bridgeToken) {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = payload.bridgeUrl;
      const token = document.createElement("input");
      token.type = "hidden";
      token.name = "token";
      token.value = payload.bridgeToken;
      form.append(token);
      document.body.append(form);
      form.submit();
      return;
    }
    location.href = payload.url;
  } catch (error) {
    state.busy = false;
    state.status = errorMessage(error);
    render();
  }
}

function oauthLinkMessage(provider: "discord" | "x", wallet: string, nonce: string) {
  return `Ritual ProofGraph social link\nProvider: ${provider}\nWallet: ${wallet}\nNonce: ${nonce}`;
}

async function fetchWalletProof(address: string): Promise<WalletProof> {
  try {
    const response = await fetch(`/api/wallet-proof?address=${address}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Live proof verifier failed: ${response.status}`);
    return payload;
  } catch {
    return fetchWalletProofFromRpc(address);
  }
}

async function fetchWalletProofFromRpc(address: string): Promise<WalletProof> {
  const provider = new JsonRpcProvider(RITUAL_RPC_URL, RITUAL_CHAIN_ID, {
    staticNetwork: true,
    batchMaxCount: 100
  });
  const [balanceWei, transactionCount, nativeAgents] = await Promise.all([
    provider.getBalance(address),
    provider.getTransactionCount(address),
    registeredAgentsFromRpc(provider, address)
  ]);
  const score = 50 + Math.min(250, transactionCount * 5) + (nativeAgents.length ? 250 : 0);

  return {
    address,
    explorerUrl: `${EXPLORER_BASE}/address/${address}`,
    balanceWei: balanceWei.toString(),
    balance: formatEther(balanceWei).replace(/\.?0+$/, "") || "0",
    transactionCount,
    explorerTransactionCount: transactionCount,
    contractDeployCount: 0,
    recentActivity: false,
    nativeAgents,
    score,
    transactions: [],
    source: {
      transactions: `${EXPLORER_BASE}/address/${address}`,
      agents: `${EXPLORER_BASE}/agents`,
      rpc: RITUAL_RPC_URL
    }
  };
}

async function registeredAgentsFromRpc(provider: JsonRpcProvider, address: string): Promise<WalletProof["nativeAgents"]> {
  const normalized = address.toLowerCase();
  const heartbeat = new Contract(AGENT_HEARTBEAT_ADDRESS, [
    "function agentCount() view returns (uint256)",
    "function agentList(uint256) view returns (address)",
    "function getAgentInfo(address) view returns (tuple(address owner,address agentAddress,address lastExecutor,uint64 lastHeartbeat,uint64 heartbeatTimeout,uint64 cooldownEnd,string latestManifestCID,uint8 state,bytes encryptedDAConfig))"
  ], provider);
  const count = Math.min(Number(await heartbeat.agentCount()), MAX_AGENT_REGISTRY_SCAN);
  if (!count) return [];

  const agentAddresses = await Promise.all(Array.from({ length: count }, (_, index) => heartbeat.agentList(index).catch(() => "")));
  const records = await Promise.all(agentAddresses.map(async (agentAddress) => {
    if (!isAddress(agentAddress)) return null;
    try {
      const info = await heartbeat.getAgentInfo(agentAddress);
      const owner = String(info.owner || info[0] || "").toLowerCase();
      const registeredAddress = String(info.agentAddress || info[1] || agentAddress).toLowerCase();
      if (owner !== normalized && registeredAddress !== normalized) return null;
      const stateIndex = Number(info.state ?? info[7] ?? 0);
      const stateName = ["MONITORED", "FAILED", "REVIVING"][stateIndex] || "MONITORED";
      return {
        address: registeredAddress,
        owner,
        source: "heartbeat-registry" as const,
        state: stateName,
        isAlive: stateName === "MONITORED",
        lastHeartbeatBlock: Number(info.lastHeartbeat ?? info[3] ?? 0),
        latestManifestCID: String(info.latestManifestCID ?? info[6] ?? "")
      };
    } catch {
      return null;
    }
  }));
  return records.filter((record): record is NonNullable<typeof record> => Boolean(record));
}

async function submitProfile(event: SubmitEvent) {
  event.preventDefault();
  try {
    if (!state.account) {
      openRainbowConnect();
      return;
    }
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const handle = String(form.get("handle") || state.social.discord?.user.username || "").trim();
    const discord = String(form.get("discord") || state.social.discord?.user.id || "").trim();
    const x = String(form.get("x") || "").trim();
    if (!handle) throw new Error("Handle is required.");
    setBusy("Writing profile to ProofGraphRegistry...");
    await writeRegistry("registerProfile", [hashClaim("discord", discord), hashClaim("x", x), handle]);
    await readCurrentProfile(false);
    state.status = "Profile registered onchain.";
  } catch (error) {
    state.status = errorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function submitProofReview(event: SubmitEvent) {
  event.preventDefault();
  try {
    if (!state.account) {
      openRainbowConnect();
      return;
    }
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const taskId = formElement.dataset.taskId || "";
    const templateId = formElement.dataset.templateId || taskId;
    const taskLabel = formElement.dataset.taskLabel || taskId;
    const evidenceUri = String(form.get("evidenceUri") || "").trim();
    if (!/^https?:\/\/|^ipfs:\/\//i.test(evidenceUri)) throw new Error("Evidence must be an http(s) or ipfs URI.");
    if (["x-proof", "blog-insight"].includes(templateId) && !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(evidenceUri)) throw new Error("Paste a public X post URL.");
    if (templateId === "x-follow" && !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/?#]+\/?(?:[?#].*)?$/i.test(evidenceUri)) throw new Error("Paste your public X profile URL.");
    const proofType = proofTypeFor(taskId);
    const proofHash = proofHashFor(taskId, state.account, evidenceUri);
    if (state.rejections.some((item) => reviewKey(item.builder, item.proofHash) === reviewKey(state.account, proofHash))) {
      throw new Error("This exact evidence was rejected. Update the URL before submitting again.");
    }
    setBusy("Sending proof request onchain...");
    await writeRegistry("requestProofReview", [proofType, proofHash, evidenceUri]);
    state.pending = upsertPending({ builder: state.account, taskId, taskLabel, proofType, proofHash, evidenceUri, createdAt: Date.now() });
    savePendingReviews(state.pending);
    state.status = "Proof review request emitted onchain.";
  } catch (error) {
    state.status = errorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function readCurrentProfile(showBusy = true) {
  if (!state.account || !PROOFGRAPH_ADDRESS) return;
  try {
    if (showBusy) setBusy("Reading registry profile...");
    const contract = await registry();
    state.profile = normalizeProfile(await contract.getProfile(state.account));
    state.receipts = normalizeReceipts(await contract.getReceipts(state.account));
    try {
      await readCurrentRejections();
    } catch {
      state.rejections = [];
    }
    if (showBusy) state.status = "Registry profile loaded.";
  } catch (error) {
    if (showBusy) state.status = errorMessage(error);
  } finally {
    if (showBusy) state.busy = false;
    render();
  }
}

async function readLeaderboard(showBusy = true) {
  if (!PROOFGRAPH_ADDRESS) return;
  try {
    if (showBusy) setBusy("Reading registry leaderboard...");
    const contract = await registry();
    state.leaderboard = await readLeaderboardProfiles(contract);
    if (showBusy) state.status = `Loaded ${state.leaderboard.length} ranked builder${state.leaderboard.length === 1 ? "" : "s"}.`;
  } catch (error) {
    if (showBusy) state.status = errorMessage(error);
  } finally {
    if (showBusy) state.busy = false;
    render();
  }
}

async function loadReviewQueue(showBusy = true) {
  if (!canAccessReview()) return;
  try {
    state.review.loading = true;
    state.review.error = "";
    if (showBusy) setBusy("Reading pending proof requests from Ritual Chain...");
    const contract = await registry();
    const { requests, receipts } = await queryReviewEvents(contract);
    const decisionEvents = REVIEW_DECISIONS_ADDRESS
      ? await queryDecisionEvents(await reviewDecisions())
      : { accepted: [] as unknown[], rejected: [] as unknown[] };
    const recorded = new Set(
      receipts.map((log) => reviewKey(eventArg(log, "builder"), eventArg(log, "proofHash")))
    );
    const decided = new Set(
      [...decisionEvents.accepted, ...decisionEvents.rejected]
        .map((log) => reviewKey(eventArg(log, "builder"), eventArg(log, "proofHash")))
    );
    state.review.queue = requests
      .map((log) => ({
        builder: eventArg(log, "builder"),
        proofType: eventArg(log, "proofType"),
        proofHash: eventArg(log, "proofHash"),
        evidenceUri: eventArg(log, "evidenceUri"),
        blockNumber: eventBlockNumber(log)
      }))
      .filter((request) => isAddress(request.builder) && /^0x[0-9a-f]{64}$/i.test(request.proofHash) && /^https?:\/\//i.test(request.evidenceUri))
      .filter((request) => !recorded.has(reviewKey(request.builder, request.proofHash)))
      .filter((request) => !decided.has(reviewKey(request.builder, request.proofHash)))
      .sort((left, right) => right.blockNumber - left.blockNumber);
    state.review.loaded = true;
    if (showBusy) state.status = `${state.review.queue.length} open proof request${state.review.queue.length === 1 ? "" : "s"} found.`;
  } catch (error) {
    state.review.error = errorMessage(error);
  } finally {
    state.review.loading = false;
    if (showBusy) {
      state.busy = false;
      render();
    }
  }
}

async function approveReview(button: HTMLElement) {
  try {
    if (!canAccessReview()) throw new Error("Reviewer access is required.");
    const builder = String(button.dataset.builder || "");
    const proofType = String(button.dataset.proofType || "");
    const proofHash = String(button.dataset.proofHash || "");
    const evidenceUri = String(button.dataset.evidenceUri || "");
    const taskId = String(button.dataset.taskId || "");
    if (!isAddress(builder) || !/^0x[0-9a-f]{64}$/i.test(proofType) || !/^0x[0-9a-f]{64}$/i.test(proofHash)) throw new Error("Invalid proof request.");
    if (!/^https?:\/\//i.test(evidenceUri) || !taskId) throw new Error("Invalid receipt data.");
    setBusy("Accepting proof through the role-gated review relay...");
    await postReviewDecision({ action: "accept", builder, proofType, proofHash, evidenceUri, taskId });
    state.pending = state.pending.filter((item) => item.proofHash.toLowerCase() !== proofHash.toLowerCase());
    savePendingReviews(state.pending);
    await loadReviewQueue(false);
    void readLeaderboard(false);
    state.status = "Proof accepted. The verified receipt is now onchain.";
  } catch (error) {
    state.status = errorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function rejectReview(event: SubmitEvent) {
  event.preventDefault();
  try {
    if (!canAccessReview()) throw new Error("Reviewer access is required.");
    const formElement = event.currentTarget as HTMLFormElement;
    const form = new FormData(formElement);
    const builder = String(formElement.dataset.builder || "");
    const proofType = String(formElement.dataset.proofType || "");
    const proofHash = String(formElement.dataset.proofHash || "");
    const evidenceUri = String(formElement.dataset.evidenceUri || "");
    const taskId = String(formElement.dataset.taskId || "");
    const reason = String(form.get("reason") || "").trim();
    if (!isAddress(builder) || !/^0x[0-9a-f]{64}$/i.test(proofType) || !/^0x[0-9a-f]{64}$/i.test(proofHash)) throw new Error("Invalid proof request.");
    if (reason.length < 4 || reason.length > 280) throw new Error("Rejection reason must be between 4 and 280 characters.");
    if (!/^https?:\/\//i.test(evidenceUri) || !taskId) throw new Error("Invalid proof request.");
    setBusy("Rejecting proof through the role-gated review relay...");
    await postReviewDecision({ action: "reject", builder, proofType, proofHash, evidenceUri, taskId, reason });
    state.pending = state.pending.filter((item) => reviewKey(item.builder, item.proofHash) !== reviewKey(builder, proofHash));
    savePendingReviews(state.pending);
    await loadReviewQueue(false);
    state.status = "Proof rejected. The builder can now submit corrected evidence.";
  } catch (error) {
    state.status = errorMessage(error);
  } finally {
    state.busy = false;
    render();
  }
}

function reviewKey(builder?: string, proofHash?: string) {
  return `${String(builder || "").toLowerCase()}:${String(proofHash || "").toLowerCase()}`;
}

function eventArg(log: unknown, key: string) {
  const args = (log as { args?: unknown }).args;
  if (!args || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return value === undefined || value === null ? "" : String(value);
}

function eventBlockNumber(log: unknown) {
  const value = (log as { blockNumber?: unknown }).blockNumber;
  const parsed = Number(value || 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function queryReviewEvents(contract: Contract) {
  const provider = new JsonRpcProvider(RITUAL_RPC_URL, RITUAL_CHAIN_ID);
  const latestBlock = await provider.getBlockNumber();
  const requests: unknown[] = [];
  const receipts: unknown[] = [];
  const windowSize = 100000;

  for (let fromBlock = PROOFGRAPH_REVIEW_START_BLOCK; fromBlock <= latestBlock; fromBlock += windowSize) {
    const toBlock = Math.min(fromBlock + windowSize - 1, latestBlock);
    const [requestBatch, receiptBatch] = await Promise.all([
      contract.queryFilter(contract.filters.ProofReviewRequested(), fromBlock, toBlock),
      contract.queryFilter(contract.filters.ProofRecorded(), fromBlock, toBlock)
    ]);
    requests.push(...requestBatch);
    receipts.push(...receiptBatch);
  }

  return { requests, receipts };
}

async function queryDecisionEvents(contract: Contract, builder?: string) {
  const provider = new JsonRpcProvider(RITUAL_RPC_URL, RITUAL_CHAIN_ID);
  const latestBlock = await provider.getBlockNumber();
  const accepted: unknown[] = [];
  const rejected: unknown[] = [];
  const windowSize = 100000;

  for (let fromBlock = REVIEW_DECISIONS_START_BLOCK; fromBlock <= latestBlock; fromBlock += windowSize) {
    const toBlock = Math.min(fromBlock + windowSize - 1, latestBlock);
    const [acceptedBatch, rejectedBatch] = await Promise.all([
      contract.queryFilter(contract.filters.ProofAccepted(builder || null), fromBlock, toBlock),
      contract.queryFilter(contract.filters.ProofRejected(builder || null), fromBlock, toBlock)
    ]);
    accepted.push(...acceptedBatch);
    rejected.push(...rejectedBatch);
  }

  return { accepted, rejected };
}

async function readCurrentRejections() {
  if (!state.account || !REVIEW_DECISIONS_ADDRESS || !isAddress(REVIEW_DECISIONS_ADDRESS)) {
    state.rejections = [];
    return;
  }
  const { rejected } = await queryDecisionEvents(await reviewDecisions(), state.account);
  state.rejections = rejected
    .map((log) => ({
      builder: eventArg(log, "builder"),
      proofType: eventArg(log, "proofType"),
      proofHash: eventArg(log, "proofHash"),
      reason: eventArg(log, "reason"),
      attestor: eventArg(log, "attestor"),
      blockNumber: eventBlockNumber(log)
    }))
    .filter((item) => isAddress(item.builder) && /^0x[0-9a-f]{64}$/i.test(item.proofHash))
    .sort((left, right) => right.blockNumber - left.blockNumber);
  const rejectedKeys = new Set(state.rejections.map((item) => reviewKey(item.builder, item.proofHash)));
  state.pending = state.pending.filter((item) => !rejectedKeys.has(reviewKey(item.builder, item.proofHash)));
  savePendingReviews(state.pending);
}

async function readLeaderboardProfiles(contract: Contract) {
  let profiles: Profile[] = [];
  try {
    const page = await contract.getLeaderboardPage(0, 50);
    profiles = page.map(normalizeProfile).filter((profile: Profile) => profile.active);
  } catch {
    const count = Number(await contract.getBuilderCount());
    for (let index = 0; index < Math.min(count, 50); index += 1) {
      const builder = await contract.getBuilderAt(index);
      const profile = normalizeProfile(await contract.getProfile(builder));
      if (profile.active) profiles.push(profile);
    }
  }

  const checked = await Promise.all(profiles.map(async (profile) => {
    try {
      const [proof, rawReceipts] = await Promise.all([
        fetchWalletProof(profile.wallet),
        contract.getReceipts(profile.wallet)
      ]);
      const receipts = normalizeReceipts(rawReceipts);
      const points = campaigns.reduce(
        (campaignTotal, campaign) => campaignTotal + campaign.tasks.reduce(
          (taskTotal, task) => taskTotal + (publicCampaignTaskComplete(task, profile, proof, receipts) ? task.points : 0),
          0
        ),
        0
      );
      return points > 0 ? { ...profile, score: BigInt(points) } : undefined;
    } catch {
      return undefined;
    }
  }));

  return checked
    .filter((profile): profile is Profile => Boolean(profile))
    .sort((left, right) => Number(right.score - left.score));
}

function publicCampaignTaskComplete(task: CampaignTask, profile: Profile, proof: WalletProof, receipts: Receipt[]) {
  const templateId = task.templateId || task.id;
  if (templateId === "wallet-link") return profile.active && isAddress(profile.wallet);
  if (templateId === "chain-activity") return Boolean(proof.transactionCount || proof.explorerTransactionCount);
  if (templateId === "contract-deploy") return proof.contractDeployCount > 0;
  if (templateId === "native-agent") return proof.nativeAgents.length > 0;
  if (templateId === "discord-oath") return profile.discordHash !== ethers.ZeroHash;
  if (task.kind === "review") {
    const proofType = proofTypeFor(task.id).toLowerCase();
    return receipts.some((receipt) => receipt.proofType.toLowerCase() === proofType);
  }
  return false;
}

async function registry() {
  if (!PROOFGRAPH_ADDRESS || !isAddress(PROOFGRAPH_ADDRESS)) throw new Error("VITE_PROOFGRAPH_ADDRESS is not configured.");
  return new Contract(PROOFGRAPH_ADDRESS, registryAbi, new JsonRpcProvider(RITUAL_RPC_URL, RITUAL_CHAIN_ID));
}

async function reviewDecisions() {
  if (!REVIEW_DECISIONS_ADDRESS || !isAddress(REVIEW_DECISIONS_ADDRESS)) throw new Error("VITE_REVIEW_DECISIONS_ADDRESS is not configured.");
  return new Contract(REVIEW_DECISIONS_ADDRESS, reviewDecisionsAbi, new JsonRpcProvider(RITUAL_RPC_URL, RITUAL_CHAIN_ID));
}

async function writeRegistry(functionName: string, args: readonly unknown[]) {
  if (!PROOFGRAPH_ADDRESS || !isAddress(PROOFGRAPH_ADDRESS)) throw new Error("VITE_PROOFGRAPH_ADDRESS is not configured.");
  const wallet = requireRainbowWallet();
  if (!wallet.writeContract) throw new Error("RainbowKit wallet client is not ready.");
  const hash = await wallet.writeContract({
    address: PROOFGRAPH_ADDRESS as `0x${string}`,
    abi: registryWriteAbi,
    functionName,
    args
  });
  await wallet.waitForTransactionReceipt?.(hash);
  return hash;
}

async function postReviewDecision(payload: Record<string, unknown>) {
  const response = await fetch("/api/reviews", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, reviewerWallet: state.account })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Review service returned ${response.status}.`);
  return result;
}

async function loadOAuthConfig() {
  try {
    const response = await fetch("/api/oauth?action=config", { cache: "no-store" });
    if (!response.ok) throw new Error("OAuth backend unavailable");
    state.oauthConfig = await response.json();
  } catch {
    state.oauthConfig = {
      discord: { enabled: false, guildIdConfigured: false, requiredRoleConfigured: false },
      attestor: { roleIds: [], roleConfigured: false, roleCount: 0 },
      x: { enabled: false, targetUserConfigured: false, targetTweetConfigured: false },
      warning: "Run npm run dev:full to enable OAuth."
    };
  } finally {
    render();
  }
}

function toggleFollow(id: string) {
  state.following = state.following.includes(id) ? state.following.filter((item) => item !== id) : [...state.following, id];
  localStorage.setItem("proofgraph.following", JSON.stringify(state.following));
  state.status = state.following.includes(id) ? "Campaign added to Following." : "Campaign removed from Following.";
  render();
}

function setBusy(message: string) {
  state.busy = true;
  state.status = message;
  render();
}

function socialProofMatchesWallet(provider: "discord" | "x") {
  const proof = state.social[provider];
  return Boolean(proof && state.account && proof.wallet.toLowerCase() === state.account.toLowerCase());
}

function proofTypeFor(taskId: string) {
  return keccak256(toUtf8Bytes(`proofgraph:${taskId}`));
}

function proofHashFor(taskId: string, builder: string, evidenceUri: string) {
  return keccak256(toUtf8Bytes(`${taskId}:${builder.toLowerCase()}:${evidenceUri}`));
}

function hashClaim(kind: string, value: string) {
  return value ? keccak256(toUtf8Bytes(`${kind}:${value}`)) : ethers.ZeroHash;
}

function normalizeProfile(raw: any): Profile {
  return {
    wallet: raw.wallet,
    discordHash: raw.discordHash,
    xHash: raw.xHash,
    handle: raw.handle,
    score: BigInt(raw.score || 0),
    createdAt: BigInt(raw.createdAt || 0),
    updatedAt: BigInt(raw.updatedAt || 0),
    active: Boolean(raw.active)
  };
}

function normalizeReceipts(raw: any[]): Receipt[] {
  return raw.map((receipt) => ({
    proofType: receipt.proofType,
    proofHash: receipt.proofHash,
    points: BigInt(receipt.points || 0),
    evidenceUri: receipt.evidenceUri,
    attestor: receipt.attestor,
    createdAt: BigInt(receipt.createdAt || 0)
  }));
}

function loadPendingReviews(): PendingReview[] {
  try {
    return JSON.parse(localStorage.getItem("proofgraph.pending") || "[]");
  } catch {
    return [];
  }
}

function loadSocialProofs(): Partial<Record<"discord" | "x", SocialProof>> {
  const social: Partial<Record<"discord" | "x", SocialProof>> = {};
  for (const provider of ["discord", "x"] as const) {
    try {
      const raw = localStorage.getItem(`proofgraph.oauth.${provider}`);
      if (!raw) continue;
      const proof = JSON.parse(raw) as SocialProof;
      // Old versions could persist a role list without proving which Discord
      // member request produced it. Force one clean OAuth refresh instead.
      if (provider === "discord" && Number(proof.checks?.roleSnapshotVersion) !== 2) {
        localStorage.removeItem(`proofgraph.oauth.${provider}`);
        continue;
      }
      social[provider] = proof;
    } catch {
      localStorage.removeItem(`proofgraph.oauth.${provider}`);
    }
  }
  return social;
}

function loadFollowing(): string[] {
  try {
    return JSON.parse(localStorage.getItem("proofgraph.following") || "[]");
  } catch {
    return [];
  }
}

function savePendingReviews(items: PendingReview[]) {
  localStorage.setItem("proofgraph.pending", JSON.stringify(items.slice(-80)));
}

function upsertPending(item: PendingReview) {
  const filtered = state.pending.filter((pending) =>
    pending.proofHash.toLowerCase() !== item.proofHash.toLowerCase() &&
    !(pending.builder.toLowerCase() === item.builder.toLowerCase() && pending.taskId === item.taskId)
  );
  return [...filtered, item];
}

function shortAddress(value?: string) {
  if (!value) return "";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatScore(value?: number | bigint) {
  return Number(value || 0).toLocaleString("en-US");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function errorMessage(error: unknown) {
  const message = String((error as { shortMessage?: string; message?: string })?.shortMessage || (error as { message?: string })?.message || error);
  if (message.toLowerCase().includes("user rejected")) return "Wallet request was rejected.";
  if (message.toLowerCase().includes("fetch failed") || message.toLowerCase().includes("failed to fetch")) return "Ritual data is temporarily unreachable. Please retry in a moment.";
  return message.replace(/^Error:\s*/, "");
}
