# rca-claude-code

> Automated root-cause analysis for Grafana-monitored infrastructure, powered by Claude Agent SDK subagents (one per component).

**Owner:** Nitin Sohal (<nitin19sohal@gmail.com>)
**Repo:** https://github.com/NitinSohal/rca-claude-code
**Stage:** Brainstorming — Section 1 of 6 of the design has been approved. Sections 2–6 are pending. **No code has been written yet.**
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

This project is mid-brainstorm. The brainstorming skill flow is:

1. ✅ Explore project context
2. ✅ Scope check (single spec, no decomposition)
3. ✅ Clarifying questions (8 rounds — all decisions captured below)
4. ✅ Propose 2–3 approaches (Approach 1 — SDK-native subagents — chosen)
5. 🔄 Present design in sections (Section 1 done, Sections 2–6 pending)
6. ⬜ Write design doc — partially complete at [`docs/superpowers/specs/2026-05-22-rca-agent-design.md`](docs/superpowers/specs/2026-05-22-rca-agent-design.md)
7. ⬜ Spec self-review
8. ⬜ User reviews written spec
9. ⬜ Invoke writing-plans skill to create implementation plan

**To pick up where we left off:**

- Read this README end to end.
- Read [`docs/superpowers/specs/2026-05-22-rca-agent-design.md`](docs/superpowers/specs/2026-05-22-rca-agent-design.md).
- Invoke `/superpowers:brainstorming` (or its equivalent) and resume from Section 2.
- Each remaining section needs the user's sign-off before moving to the next.
- After Section 6, run spec self-review, get the user's final approval on the spec file, then invoke `superpowers:writing-plans`.

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

## Open questions — sections 2–6 of the design still to do

Each of these is a section of the design that still needs the user's input and sign-off. Do **not** skip ahead and implement.

### Section 2 — Component & infra MD format
- Exact schema of each component's YAML block (proposal: `name`, `type`, `loki_selector`, `prom_selector`, `cw_namespace`, `depends_on[]`)
- How the prose part of `infra.md` is referenced by subagents (full doc as cached context vs. just the component's section)
- How "depends_on" is used by subagents to follow upstream / downstream

### Section 3 — Subagent + coordinator design
- Subagent `.md` file structure (system prompt, allowed tools, output schema)
- Coordinator's responsibilities (parallel spawn, aggregation, retry handling)
- Synthesizer prompt design (input = N subagent outputs + past similar RCAs from Mongo; output = structured RCA with confidence + evidence links)
- Token budget per call; prompt-caching strategy for the infra MD

### Section 4 — The expand-window loop in detail
- `Stop` hook decision logic — exact predicates for "keep going" vs "stop"
- How to detect "spike resolved" via Grafana Alerting state polling
- How to detect "metric back to baseline" (rolling avg over last N minutes vs. pre-spike value)
- Failure modes: max iterations, API rate limits, partial results
- Streaming intermediate output to the UI so the user sees progress

### Section 5 — Error handling, observability, security
- Per-call retries, timeouts, circuit-breaking on Grafana
- Logging strategy (structured logs, where they go)
- Secrets handling in Docker (env vs Docker secrets)
- What happens if Mongo is down? Slack is down? Grafana is down?
- Rate-limit guard for Claude

### Section 6 — Testing strategy
- Unit tests for tool wrappers (mock Grafana responses)
- Integration tests for the coordinator (fixture: 9 fake subagents)
- E2E tests with a recorded Grafana session
- How to test the expand-window loop deterministically

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
