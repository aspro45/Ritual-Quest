# Ritual ProofGraph

A builder reputation layer for Ritual.

ProofGraph connects three signals that usually stay separated: wallet activity, Discord identity, and public X participation. The app verifies Ritual onchain activity, links Discord through OAuth, keeps X as a public evidence URL, and can anchor verified receipts through an onchain registry.

## What it checks

- Ritual wallet balance and transaction count
- contract deployment activity
- native Ritual agent detection through the explorer cache, heartbeat registry, and direct sovereign-harness ownership checks for paused agents
- Discord membership and role proof through OAuth, once credentials are configured
- X post, repost, or reply proof through a public URL review flow
- public score, badge tier, onchain leaderboard, and shareable builder card

## Contract model

The contract layer is intentionally strict. Users register a public profile and request proof review in `ProofGraphRegistry`. Trusted reviewers accept or reject through `ProofReviewDecisions`; accepted proofs are forwarded to the original registry and rejected proofs receive a public reason without changing score.

Leaderboard data lives in the registry. Every scored proof updates the builder profile onchain, and the app reads a sorted page directly from `getLeaderboardPage` before falling back to older registry reads.

```solidity
registerProfile(bytes32 discordHash, bytes32 xHash, string calldata handle)
requestProofReview(bytes32 proofType, bytes32 proofHash, string calldata evidenceUri)
recordProof(address builder, bytes32 proofType, bytes32 proofHash, uint16 points, string calldata evidenceUri)
setAttestor(address attestor, bool trusted)
getProfile(address builder)
getReceipts(address builder)
getLeaderboardPage(uint256 offset, uint256 limit)
```

```solidity
approveProof(address builder, bytes32 proofType, bytes32 proofHash, uint16 points, string calldata evidenceUri)
rejectProof(address builder, bytes32 proofType, bytes32 proofHash, string calldata reason)
```

## Local run

```bash
npm install
npm run build
npm run dev:full
```

`dev:full` starts both pieces that the OAuth flow needs:

- Vite app: `http://127.0.0.1:5192`
- local API server: `http://127.0.0.1:5194`, proxied through `/api`

## Discord OAuth

Copy `.env.example` to `.env`, then fill Discord credentials:

```env
OAUTH_STATE_SECRET=put-a-long-random-string-here

DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://127.0.0.1:5192/api/oauth?action=callback&provider=discord
DISCORD_GUILD_ID=
DISCORD_REQUIRED_ROLE_ID=
DISCORD_REQUIRED_ROLE_IDS=
DISCORD_ATTESTOR_ROLE_ID=
DISCORD_ATTESTOR_ROLE_IDS=
REVIEW_RELAYER_PRIVATE_KEY=
```

The frontend never receives the client secret. A wallet signs a short linking message first, the backend verifies that signature, then OAuth confirms the Discord account. The callback stores the verified result locally and the contract can store only hashes/receipts.

X proof is intentionally kept as a normal public URL in Missions. That avoids requiring paid X API credits while still giving attestors a clear proof link to review.

Use `DISCORD_REQUIRED_ROLE_ID` for one role, or `DISCORD_REQUIRED_ROLE_IDS` for a comma-separated allowlist. A member passes if they hold at least one configured role.

## Role-gated review

The `Review` tab is shown when the wallet-linked Discord account holds one role from `DISCORD_ATTESTOR_ROLE_IDS`. Reviewer wallets do not need to be added to an onchain attestor allowlist.

Accept and reject actions go through `/api/reviews`. The API verifies the signed Discord session, confirms that it is bound to the connected wallet, checks the submitted proof request on Ritual Chain, derives the permitted points from the task ID, and then uses one server-side relay wallet to settle the decision onchain. Use a dedicated low-balance testnet wallet for `REVIEW_RELAYER_PRIVATE_KEY`; that relay wallet must be enabled once in `ProofReviewDecisions.attestors`. Never expose this key with a `VITE_` prefix.

The queue is read from `ProofReviewRequested` events on Ritual Chain and filtered by final accept/reject events. Accepting a request writes its normal receipt into `ProofGraphRegistry`. Rejecting it records a reason, removes it from the open queue, and reopens the task so the builder can submit corrected evidence. The exact rejected URL cannot be sent again because it resolves to the same proof hash.

Set `VITE_PROOFGRAPH_REVIEW_START_BLOCK` and `VITE_REVIEW_DECISIONS_START_BLOCK` to their deployment blocks. The coordinator address belongs in `VITE_REVIEW_DECISIONS_ADDRESS`.

## Shared calendar

The `Calendar` route is a shared website schedule. It does not require a Discord bot and it does not publish events to Discord. Everyone can read the week view; only Discord members holding a role in `DISCORD_EVENT_MANAGER_ROLE_IDS` can create entries after OAuth has verified their current roles.

Create this table in a Supabase project, then add the server-only variables below to `.env` and Vercel. Do not expose the service-role key with a `VITE_` prefix.

```sql
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null default '' check (char_length(location) <= 100),
  url text not null default '',
  image_url text not null default '',
  created_by_discord_id text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists calendar_events_starts_at_idx on public.calendar_events (starts_at);

-- Run this once when upgrading an existing calendar table.
alter table public.calendar_events
  add column if not exists image_url text not null default '';
```

```env
OAUTH_STATE_SECRET=use-a-long-random-string
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
DISCORD_EVENT_MANAGER_ROLE_IDS=role-id-one,role-id-two
DISCORD_EVENT_MANAGER_WALLETS=0xverified-manager-wallet
```

The browser only receives normalized public event data. Event creation runs through the server, which validates the signed Discord session against the role or wallet allowlist before it writes to the shared calendar. Wallet access is accepted only from the wallet stored in the signed Discord OAuth session, never from an unverified browser address. Organizers can add a public HTTPS cover image; the server rejects non-HTTPS image URLs before storage.

During local development, when Supabase is not configured, the API uses the ignored `.local-data/calendar-events.json` file so authorized organizers can create and reload real local events. Vercel never uses this fallback; production calendar writes still require Supabase.

## Role-gated campaign publishing

The Explore page can also accept campaigns created by selected Ritual Discord roles. Everyone can read published campaigns, but the creator panel appears only when the signed Discord session contains a role listed in `DISCORD_CAMPAIGN_MANAGER_ROLE_IDS`.

Create the shared campaign table in the same Supabase project:

```sql
create table if not exists public.quest_campaigns (
  id text primary key,
  title text not null,
  description text not null,
  category text not null check (category in ('Builder', 'Agents', 'Community', 'Onchain', 'Discord')),
  image_url text not null default '',
  task_ids jsonb not null,
  custom_task jsonb,
  created_by_discord_id text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  published boolean not null default true
);

create index if not exists quest_campaigns_published_created_idx
  on public.quest_campaigns (published, created_at desc);

alter table public.quest_campaigns enable row level security;

-- Run this once when upgrading an existing installation.
alter table public.quest_campaigns
  add column if not exists custom_task jsonb;
```

Then add the allowed Discord role IDs to the server environment:

```env
DISCORD_CAMPAIGN_MANAGER_ROLE_IDS=role-id-one,role-id-two
DISCORD_CAMPAIGN_MANAGER_WALLETS=0xYourManagerWallet
```

Manager access can come from an allowed Discord role or an allowed wallet. Wallet access is not accepted from a browser address alone: Discord OAuth first verifies the wallet signature, then stores that wallet inside the signed HttpOnly session. The server owns the category and task allowlists, adds the wallet check automatically, and stores only normalized campaign data. Creators can combine the existing receipt-backed templates with one custom social quest containing their own title, instructions, up to five X accounts, a target X post, and selected Like/Repost/Reply actions. The custom step uses a per-wallet 60-second local timer and is explicitly self-attested: it awards no points and writes no onchain receipt. Public X/project proofs still use the reviewer flow and receive points only after approval. Review-based tasks are scoped to the campaign ID, so approving one campaign cannot complete the same task in another campaign. `SUPABASE_SERVICE_ROLE_KEY` stays server-only and must never use a `VITE_` prefix.

## Contract

```bash
npm run compile
npm test
```

To deploy:

```bash
cp .env.example .env
npm run deploy
npm run deploy:review-decisions
```

Then put the deployed address into:

```env
VITE_PROOFGRAPH_ADDRESS=0x...
VITE_REVIEW_DECISIONS_ADDRESS=0x...
VITE_REVIEW_DECISIONS_START_BLOCK=0
```

## Privacy rule

ProofGraph is opt-in. It does not scrape all Discord members. Each builder connects their own wallet/social accounts, and public display is based on proof receipts they choose to publish.
