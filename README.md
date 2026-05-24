# rca-claude-code

> Automated root-cause analysis for Grafana-monitored infrastructure, powered by Claude Agent SDK subagents (one per component).

**Owner:** Nitin Sohal (<nitin19sohal@gmail.com>)
**Repo:** https://github.com/NitinSohal/rca-claude-code
**Stage:** Design complete — all 6 sections of the design are approved. Awaiting final user review of the written spec, then we move to the implementation plan. **No application code has been written yet.**
**Last updated:** 2026-05-22

---

## TL;DR — What this project is

When something breaks in your infrastructure, you (or Grafana) tell this system a time window. It:

1. Spawns 9 Claude subagents (one per infra component) in parallel.
2. Each subagent pulls **only its component's slice** of logs / metrics / cloud signals from Grafana for that window.
3. A synthesizer agent combines their findings into a root-cause analysis (RCA).
4. If the RCA isn't confident enough or the spike isn't over yet, it expands the window by 30 minutes and tries again — up to a 24-hour cap.
5. The result is stored in MongoDB, posted to Slack, and shown live in a Next.js dashboard.
6. Once you fix the outage, you record what you did, so future RCAs can learn from past resolutions.

Primary surface is a **dashboard**. CLI and Grafana webhook are secondary entry points.

---

## How to continue this work (read this if you're a future agent or contributor)

The brainstorming skill flow is:

1. ✅ Explore project context
2. ✅ Scope check (single spec, no decomposition)
3. ✅ Clarifying questions (8 rounds — all decisions captured below)
4. ✅ Propose 2–3 approaches (Approach 1 — SDK-native subagents — chosen)
5. ✅ Present design in sections (all 6 done)
6. ✅ Write design doc — at [`docs/superpowers/specs/2026-05-22-rca-agent-design.md`](docs/superpowers/specs/2026-05-22-rca-agent-design.md)
7. 🔄 Spec self-review (about to run)
8. ⬜ User reviews written spec
9. ⬜ Invoke writing-plans skill to create implementation plan

**To pick up where we left off:**

- Read this README end to end.
- Read [`docs/superpowers/specs/2026-05-22-rca-agent-design.md`](docs/superpowers/specs/2026-05-22-rca-agent-design.md) — that's the authoritative design.
- The next step is the user's final review of the written spec; after approval, invoke `superpowers:writing-plans` to produce the implementation plan.

**Do not start writing code yet.** The hard gate is: full design approved → implementation plan written → only then implementation.

---

## Decisions locked in so far

| # | Decision | Value |
|---|---|---|
| 1 | Data sources behind Grafana | Loki (logs) · Prometheus (metrics) · CloudWatch · Grafana Alerting |
| 2 | Language for the backend agent runtime | TypeScript / Node |
| 3 | LLM | Claude, via Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
| 4 | Auth to Claude | Claude CLI OAuth session (`claude login` once on host, then mount `~/.claude` into the container). **No `ANTHROPIC_API_KEY`.** |
| 5 | Component-definition model | Hybrid: single `infra/infra.md` file with prose + per-component YAML frontmatter blocks |
| 6 | Component count today | 9 |
| 7 | Stopping condition — "meaningful RCA" | Both: confidence ≥ `RCA_CONFIDENCE_THRESHOLD` AND each finding linked to concrete evidence |
| 8 | Stopping condition — "spike finished" | All of: triggering metric back to baseline AND Grafana alert resolved AND 24h hard cap |
| 9 | Delivery destination | Slack incoming webhook |
| 10 | Persistence | MongoDB (existing on host) — collections: `rcas`, `resolutions`, `runs`, `alerts` |
| 11 | Resolution capture | CLI command + HTTP `PATCH /rcas/:id/resolution`; Slack-reply parsing is phase 3 |
| 12 | Deployment | Docker Compose on the same host as Mongo |
| 13 | Webhook auth | None (internal network) — webhook is the **lowest** priority entry point |
| 14 | Health check mode | LLM-powered: runs all 9 subagents over last 15 min, returns green/yellow/red summary |
| 15 | Subagent data-access pattern | Hybrid: orchestrator pre-fetches YAML-default queries, subagents have tools to drill deeper |
| 16 | Subagent execution model | **Approach 1** — Claude Agent SDK's native subagents (`agents/*.md`) + `Stop` hook for the expand-window loop |
| 17 | Frontend | Next.js (App Router) |
| 18 | Backend | NestJS |
| 19 | Dashboard auth | None (private network deployment, single user) |
| 20 | Data access from app → Loki/Prom/CW | **Through Grafana datasource proxy only.** Never direct. One `GRAFANA_SERVICE_ACCOUNT_TOKEN` is the only credential. Loki/Prom/AWS creds stay inside Grafana. |
| 21 | Datasource UIDs | Auto-discovered from `GET /api/datasources` at startup; env-overridable |
| 22 | Portability | Every host-specific value is an env var. `.env.example` is the manifest. Anyone clones, edits `.env`, runs `docker compose up`. |
| 23 | Subagent prompt context | Each subagent gets full prose of `infra.md` (prompt-cached), its own YAML block, and a stripped index of peers (name + description). Synthesizer gets the full file. |
| 24 | `depends_on` use | Drives synthesizer's `dependency_graph` reasoning + powers a `lookup_dependency` intra-cycle tool. |
| 25 | Subagent output | Strict JSON schema; Zod-validated. |
| 26 | Pre-fetch budgets | ≤500 log lines (1KB max each), ≤100 LTTB-downsampled points per metric, ~15K-token ceiling per subagent. |
| 27 | Quorum rule | ≥6 of 9 subagents must succeed; otherwise run marked `degraded` and synthesizer skipped. |
| 28 | Per-subagent timeout | 90s. One retry on 5xx / Grafana tool failure. Schema-validation failure is final. |
| 29 | Past-RCA similarity | Component-keyed Mongo lookup, recency-sorted top 3, resolution notes joined. Embeddings deferred to phase 3. |
| 30 | Expansion direction | Backward only: `from` walks back by `WINDOW_STEP_MINUTES`, `to` stays fixed. |
| 31 | Manual auto-expand | OFF by default; opt-in toggle on the UI form. |
| 32 | Baseline detector | 30-min pre-fire avg vs. last-5-min avg; relative tolerance 20%; absolute fallback when baseline ≈ 0. |
| 33 | UI streaming | Server-Sent Events from `GET /api/runs/:id/stream`. |
| 34 | Inter-iteration backoff | `BACKOFF_MS=5000` between iterations; semaphore caps in-flight Grafana calls at 10. |
| 35 | Circuit breaker | Per-target in-memory state in `OutboundCallGuard`; opens after 5 failures within 60s, half-opens after 30s. |
| 36 | Slack failure handling | **Never blocks RCA.** Creates a persistent event the user must acknowledge or fix. |
| 37 | Events panel | Mongo `events` collection + UI notification center. Every external-op failure produces a durable, visible event with severity, source, suggested fix, and acknowledge/ignore actions. |
| 38 | Auto-resolve | Outstanding `unacknowledged` events for a `(source, operation)` pair flip to `resolved` when the next call of the same kind succeeds. |
| 39 | Logging | `pino` structured JSON to stdout only. Logs ≠ events: logs for grep, events for UI. |
| 40 | Health endpoints | `/healthz` (status of grafana/mongo/claude_auth + unacknowledged event counts) and `/readyz` (gates Docker startup). |
| 41 | Test layers | Vitest unit + integration (`nock` + `mongodb-memory-server`) + E2E with stubbed Claude via `ClaudeClient` wrapper. No UI tests in v1. |
| 42 | CI | GitHub Actions: lint + typecheck + unit/integration + `docker compose build` on every PR; E2E on `main`. |

---

## Architecture overview (Section 1 of the design — APPROVED)

### Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js (App Router, React Server Components, streaming UI) |
| Backend | NestJS (REST API, webhook controller, agent orchestrator, Mongo driver) |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` with CLI-auth (no API key) |
| Storage | MongoDB (external — existing on host, connected via `MONGO_URI`) |
| Delivery | Slack incoming-webhook |
| Container | Docker Compose: `rca-api` (NestJS) + `rca-ui` (Next.js) |

### Repository layout (planned)

```
rca-claude-code/
├── apps/
│   ├── api/                # NestJS backend
│   ├── web/                # Next.js frontend
│   └── agent/              # shared TS package: SDK code, subagent defs, hooks
├── infra/
│   ├── infra.md            # hybrid MD: prose + per-component YAML blocks
│   └── prompts/            # generated subagent .md files (rebuilt from infra.md)
├── docs/
│   └── superpowers/specs/  # design specs (this brainstorm lives here)
├── docker-compose.yml
├── .env.example
└── README.md
```

### Four entry points (priority order)

1. **Dashboard UI** (Next.js) — PRIMARY. Pages: `/` (health overview), `/analyze` (trigger time-based RCA), `/rcas` (history), `/rcas/:id` (detail + add resolution).
2. **CLI** (NestJS `nest-commander` module) — backup/scriptable: `rca analyze`, `rca health`, `rca resolve`.
3. **HTTP API** (NestJS) — what the UI calls; also exposes `PATCH /rcas/:id/resolution`.
4. **Webhook** (NestJS controller) — `POST /webhook/alert` — Grafana → auto-RCA. Built last.

### Data flow

```
   User in UI (Next.js)
          ↓ POST /api/rca { from, to }
   NestJS coordinator
          ↓ spawns 9 Claude subagents (Agent SDK, CLI-auth)
          ↓ each subagent has tools:
                 grafana.queryLoki(uid, logql, range)
                 grafana.queryProm(uid, promql, range)
                 grafana.queryCloudWatch(uid, metric, range)
          ↓ all 9 calls route through ONE Grafana service account
   Aggregator → Synthesizer (Claude)
          ↓
   Stop hook → expand window OR finish
          ↓ on finish: persist to Mongo, post to Slack, stream to UI
```

### `.env.example` (planned)

```bash
# All knobs — nothing host-specific beyond these
GRAFANA_URL=https://grafana.yourcompany.internal
GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_xxx

# Optional — auto-discovered if omitted
LOKI_DATASOURCE_UID=
PROM_DATASOURCE_UID=
CW_DATASOURCE_UID=

MONGO_URI=mongodb://host.docker.internal:27017/rca_agent
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx

# Loop tuning
WINDOW_INITIAL_HOURS=4
WINDOW_STEP_MINUTES=30
WINDOW_MAX_HOURS=24
RCA_CONFIDENCE_THRESHOLD=0.75

# Paths inside container
INFRA_MD_PATH=/app/infra/infra.md
CLAUDE_CONFIG_DIR=/root/.claude
```

### `docker-compose.yml` shape (planned)

```yaml
services:
  rca-api:
    build: ./apps/api
    env_file: .env
    volumes:
      - ~/.claude:/root/.claude:ro     # Claude CLI OAuth session
      - ./infra:/app/infra:ro
    ports: ["3001:3001"]

  rca-ui:
    build: ./apps/web
    env_file: .env
    environment:
      NEXT_PUBLIC_API_URL: http://rca-api:3001
    ports: ["3000:3000"]
    depends_on: [rca-api]
```

### Prerequisite for a new user / agent picking this up

1. Have Docker + docker-compose installed.
2. Have MongoDB reachable (on host or another container).
3. Have a Grafana service account token (read-only is fine) with access to the datasources you want queried.
4. Run `claude login` once on the host so `~/.claude/` has a valid OAuth session.
5. Copy `.env.example` → `.env`, fill in the host-specific values.
6. `docker compose up`.

---

## Where each design decision lives

All six sections of the design are approved and detailed in the spec file. Quick map:

| Section | Topic | Spec anchor |
|---|---|---|
| 1 | Architecture overview, stack, env, repo layout | §1 |
| 2 | `infra.md` format + per-component YAML schema | §2 |
| 3 | Subagents, coordinator, synthesizer, quorum, token budget | §3 |
| 4 | Expand-window loop, Stop hook, baseline detection, SSE streaming | §4 |
| 5 | Error handling, circuit breakers, logging, the persistent events panel | §5 |
| 6 | Testing strategy (Vitest, stubbed Claude, fixture set) | §6 |

The full spec is at [`docs/superpowers/specs/2026-05-22-rca-agent-design.md`](docs/superpowers/specs/2026-05-22-rca-agent-design.md).

- Implementation plan: [docs/superpowers/specs/2026-05-22-rca-agent-implementation-plan.md](docs/superpowers/specs/2026-05-22-rca-agent-implementation-plan.md)

---

## How to run (once implementation exists — placeholder)

```bash
# Not implemented yet — this is the planned UX.
git clone git@github.com:NitinSohal/rca-claude-code.git
cd rca-claude-code
cp .env.example .env
$EDITOR .env             # fill in Grafana token, Mongo URI, Slack URL
claude login             # one-time, gives the container OAuth credentials
docker compose up -d
open http://localhost:3000
```

---

## License

TBD.
