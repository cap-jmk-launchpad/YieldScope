# YieldScope

Personal earn ledger for **Binance Simple Earn**, **OKX savings**, and **Monad staking**, with an onchain `EarningsCheckpoint` on Monad testnet.

> I earn on Binance and OKX and stake on Monad, and I still can’t answer “what did I make this month?” without three apps and a spreadsheet. YieldScope syncs those earn streams into one dashboard and posts a hash checkpoint on Monad so the number is portable and verifiable — built test-first so every source actually works.

Host target: `yieldscope.d3bu7.com` · Brand: see `PRODUCT.md`, `brand.md`, `design.md`, `docs/pitch.md`

## Phase 1 sources only

| Source | Adapter | Tests |
|--------|---------|-------|
| Binance Simple Earn | `web/src/lib/adapters/binance.ts` | `tests/unit/binance.test.ts` |
| OKX earn / savings | `web/src/lib/adapters/okx.ts` | `tests/unit/okx.test.ts` |
| Monad staking (`0x1000`) | `web/src/lib/adapters/monad-stake.ts` | `tests/unit/monad-stake.test.ts` |
| EarningsCheckpoint | `contracts/src/EarningsCheckpoint.sol` | `forge test` |

Phase 2 (ETH / Lido / Base / Zerion, etc.) is **not** claimed — see plan deferral.

## Quick start

```bash
# Install
pnpm install
pnpm --dir web install

# Unit tests (fixtures — no secrets)
pnpm test
pnpm test:contracts   # requires forge on PATH

# Fixture smoke
pnpm test:smoke

# Dev UI (fixture demo without live keys)
cp .env.example web/.env.local
# set USE_FIXTURE_DEMO=1 in web/.env.local
pnpm --dir web dev
```

Open http://localhost:3000 → Register/Sign in → Connect → Dashboard → Attest.

Required for app access: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `web/.env.local`.
Optional: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` for WalletConnect in the RainbowKit modal.

Supabase redirect URLs (Auth → URL Configuration):
- `http://localhost:3000/auth/callback` (dev)
- `http://localhost:3000/auth/reset-password` (dev — post-recovery landing)
- `https://yieldscope.d3bu7.com/auth/callback` (prod)
- `https://yieldscope.d3bu7.com/auth/reset-password` (prod)

## Auth model

- **Account:** Supabase email/password at `/login`, `/register`, and `/forgot-password` → `/auth/reset-password`. Registration requires email confirmation (Supabase Dashboard → Auth → confirm email) — that link is the only bot gate (no captcha). Password reset emails verify on the API host then redirect to `/auth/reset-password` (`?code=` or `#access_token=`).
- **CEX:** Connect UI is **read-only API keys** for Binance and OKX (sessionStorage). Server sync also accepts env vars for smoke (`BINANCE_*`, `OKX_*`).
- **Wallet:** RainbowKit + wagmi on Monad testnet (chain `10143`) for stake reads and attestation.
- **Fail closed:** `/app/*` requires a session; `/api/sync` and `/api/checkpoint/*` return 401 when unauthenticated. Broken adapters never invent earn rows.

## Live smoke (before demo recording)

```bash
# Fill secrets in a local .env (never commit)
SYNC_LIVE=1 \
BINANCE_API_KEY=... BINANCE_API_SECRET=... \
OKX_API_KEY=... OKX_API_SECRET=... OKX_PASSPHRASE=... \
MONAD_DEMO_ADDRESS=0x... \
MONAD_RPC_URL=https://testnet-rpc.monad.xyz \
pnpm test:smoke
```

Live smoke is **gated** by `SYNC_LIVE=1` and is skipped in CI without secrets.

## Deploy EarningsCheckpoint (Monad testnet, chain 10143)

```bash
cd contracts
export DEPLOYER_PK=0x...          # funded testnet key
export MONAD_RPC_URL=https://testnet-rpc.monad.xyz
forge test
forge script script/Deploy.s.sol:Deploy --rpc-url $MONAD_RPC_URL --broadcast
```

Set `NEXT_PUBLIC_CHECKPOINT_ADDRESS` to the printed address. Optional verify via Monad agents verification API (see monskills scaffold notes).

If no deployer key is available in this environment, the contract is still fully tested with Foundry; deploy before the demo attest step.

## Kubernetes (blackpearl / engine)

Manifests: `deploy/k8s/yieldscope.yaml`  
Kubeconfig hint: `$env:USERPROFILE\.kube\config-homelab`

```powershell
$env:KUBECONFIG = "$env:USERPROFILE\.kube\config-homelab"
kubectl apply -f deploy/k8s/yieldscope.yaml
# Point DNS yieldscope.d3bu7.com at the ingress / load balancer
```

Build/import image (NEXT_PUBLIC_* is baked at **build** time — must be YieldScope, not majico):

```bash
# Preferred: build on blackpearl + import into k3s + restart
export KUBECONFIG="$HOME/.kube/config-homelab"
bash deploy/scripts/k8s-yieldscope-web-build.sh

# Or manual (repo root as context — Dockerfile expects monorepo layout):
docker build -t ghcr.io/cap-jmk-real/yieldscope-web:latest \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.yieldscope.d3bu7.com \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  -f web/Dockerfile .
```

Supabase SQL: `supabase/migrations/202607160001_earn_ledger.sql` (run against engine Postgres when ready). Prototype ships with an in-memory ledger store for local demos.

## Demo video script (record yourself)

1. Landing — brand **YieldScope**, one CTA.
2. Connect — paste read-only Binance/OKX API keys; connect Monad wallet via RainbowKit.
3. Sync — dashboard: source statuses + real earn rows (or fixture demo with `USE_FIXTURE_DEMO=1`).
4. Attest — refresh root, submit `attest`, open Monadscan tx.
5. Close on pitch: CeFi earn + Monad stake + portable checkpoint, test-first.

## Spark submission checklist

- [ ] Unit tests green (`pnpm test` + `forge test`)
- [ ] Live smoke or documented fixture demo path
- [ ] Dashboard fail-closed (no fake rows)
- [ ] Checkpoint deployed + attested on Monad testnet
- [ ] Hosted URL `yieldscope.d3bu7.com` (or interim localhost / preview)
- [ ] Demo video recorded
- [ ] GitHub repo public
- [ ] Spark form submitted (**you** submit — this README does not claim form submit)

## Repo layout

```
web/                 Next.js App Router + adapters + UI
contracts/           Foundry EarningsCheckpoint
tests/fixtures/      Golden API / ABI fixtures
tests/unit/          Vitest adapter tests
supabase/migrations/ Ledger schema
deploy/k8s/          Ingress for yieldscope.d3bu7.com
docs/pitch.md        Competitors + 30s pitch
```
