---
title: RCA Agent — Design Spec
date: 2026-05-22
owner: Nitin Sohal
status: IN PROGRESS — Section 1 approved, Sections 2–6 pending user sign-off
---

# RCA Agent — Design Spec

> Single-source-of-truth design doc for `rca-claude-code`.
> The README is the elevator-pitch + onboarding entry point; this file is the precise design.

## Status legend

- ✅ APPROVED — user has signed off
- 🟡 DRAFT — written but not yet reviewed
- ⬜ TBD — still being brainstormed

---

## 0. Problem statement ✅

We want a system that, when given a time window of suspected outage (or alerted via Grafana webhook), produces a structured root-cause analysis grounded in our Grafana-monitored data: logs (Loki), metrics (Prometheus), cloud-native signals (CloudWatch), and alert state (Grafana Alerting).

The user (Nitin) is a single operator on a small infra (~9 components) who wants the system to:

- Use one **Grafana service account** as the single point of data access — no direct connections to Loki / Prom / AWS.
- Reason **one Claude subagent per component**, in parallel, against a markdown infra description he maintains.
- Auto-expand its analysis window if the first attempt isn't conclusive.
- Persist past RCAs **and his resolution notes** so future RCAs can learn from history.
- Run as Docker containers next to his existing Mongo, configurable entirely via env vars so anyone can adopt the project.

The primary surface is a **Next.js dashboard**. CLI and Grafana webhook are secondary.

---

## 1. Architecture overview ✅

### 1.1 Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js (App Router) |
| Backend | NestJS |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` — CLI-auth mode (no `ANTHROPIC_API_KEY`) |
| Storage | MongoDB (external, existing on host) |
| Delivery | Slack incoming-webhook |
| Container | Docker Compose, 2 services: `rca-api`, `rca-ui` |

### 1.2 Data-source access — strict rule

All log / metric / cloud queries are issued through Grafana's datasource proxy API:

```
POST /api/datasources/proxy/uid/<loki_uid>/loki/api/v1/query_range
POST /api/datasources/proxy/uid/<prom_uid>/api/v1/query_range
POST /api/datasources/proxy/uid/<cw_uid>/cloudwatch/metrics/query
```

The only credential the app holds is `GRAFANA_SERVICE_ACCOUNT_TOKEN`. Loki/Prom/AWS creds remain inside Grafana. Datasource UIDs are auto-discovered at startup via `GET /api/datasources`; can be overridden by env vars.

### 1.3 Authentication to Claude

The `rca-api` container has the `claude` CLI installed (`npm i -g @anthropic-ai/claude-code` in its Dockerfile). The host's `~/.claude/` is mounted **read-only** into the container at the path given by `CLAUDE_CONFIG_DIR`. The user runs `claude login` once on the host. The Agent SDK picks up the OAuth session automatically.

### 1.4 Repository layout

```
rca-claude-code/
├── apps/
│   ├── api/        # NestJS
│   ├── web/        # Next.js
│   └── agent/      # shared TS package — agent SDK code, subagent defs, hooks
├── infra/
│   ├── infra.md
│   └── prompts/    # generated subagent .md files
├── docs/
│   └── superpowers/specs/2026-05-22-rca-agent-design.md   # this file
├── docker-compose.yml
├── .env.example
└── README.md
```

### 1.5 Four entry points (priority order)

1. **Dashboard UI** (Next.js) — PRIMARY.
2. **CLI** (`nest-commander` module inside `apps/api`).
3. **HTTP API** (NestJS) — what the UI calls.
4. **Grafana webhook** (NestJS controller, no auth, lowest priority).

### 1.6 Environment configuration

```bash
GRAFANA_URL=
GRAFANA_SERVICE_ACCOUNT_TOKEN=
LOKI_DATASOURCE_UID=          # optional — auto-discovered
PROM_DATASOURCE_UID=          # optional — auto-discovered
CW_DATASOURCE_UID=            # optional — auto-discovered
MONGO_URI=
SLACK_WEBHOOK_URL=
WINDOW_INITIAL_HOURS=4
WINDOW_STEP_MINUTES=30
WINDOW_MAX_HOURS=24
RCA_CONFIDENCE_THRESHOLD=0.75
INFRA_MD_PATH=/app/infra/infra.md
CLAUDE_CONFIG_DIR=/root/.claude
```

### 1.7 Coarse data flow

```
   User in UI (Next.js)
          ↓ POST /api/rca { from, to }
   NestJS coordinator
          ↓ spawns 9 Claude subagents in parallel (Agent SDK)
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

---

## 2. Component & infra MD format ⬜ TBD

To be filled in during the next brainstorming round.

Open questions:
- Exact YAML schema per component (`name`, `type`, `loki_selector`, `prom_selector`, `cw_namespace`, `depends_on[]`, `runbook_url`?)
- Whether the prose section of `infra.md` is passed in full to every subagent (with prompt caching) or only the component-specific section.
- How `depends_on` informs cross-component evidence in the synthesizer.
- Tooling to validate / lint the infra MD on container startup.

---

## 3. Subagent + coordinator design ⬜ TBD

Open questions:
- The exact subagent `.md` shape (system prompt template, allowed tools, structured output schema).
- Coordinator responsibilities: parallel spawn, partial-failure handling, timeout per subagent, retry policy.
- Synthesizer input: subagent outputs + past similar RCAs + resolutions from Mongo. How do we pick "similar"?
- Synthesizer output schema (JSON): `{ root_cause, confidence, contributing_factors[], evidence[], suggested_next_steps[] }`.
- Token budget per RCA cycle; prompt-cache strategy for the infra MD across 9 subagent calls.

---

## 4. The expand-window loop ⬜ TBD

Open questions:
- Exact `Stop` hook predicate. Pseudocode draft:
  ```
  if rca.confidence >= THRESHOLD
     AND rca.evidence.length > 0
     AND alert_state == "OK"
     AND metric_back_to_baseline:
        stop(success)
  elif window_hours >= WINDOW_MAX_HOURS:
        stop(time_capped)
  else:
        window_hours += WINDOW_STEP_MINUTES / 60
        retry()
  ```
- How to poll Grafana Alerting state — endpoint, frequency.
- How to determine "metric back to baseline" — rolling average over last N minutes vs. pre-spike value, configurable percent.
- UI streaming: how iterations show up live in `/analyze`.
- Backoff between iterations to avoid hammering Grafana.

---

## 5. Error handling, observability, security ⬜ TBD

Open questions:
- Per-call retry + timeout policy for Grafana datasource proxy.
- Circuit-breaker if Grafana is failing for > X seconds.
- Structured logging (pino?) — where do logs go? Stdout for `docker logs`, or a file volume?
- Mongo outage — buffer to disk or fail loudly?
- Slack outage — retry queue?
- Secret handling: env vars in `.env`, never committed; advise Docker secrets for prod.
- Claude rate-limit handling.

---

## 6. Testing strategy ⬜ TBD

Open questions:
- Unit-test layer: Grafana client (recorded HTTP fixtures), Mongo repositories.
- Coordinator tests: 9 fake subagents that return canned outputs; verify aggregation + Stop hook decisions.
- E2E: a captured Grafana session replayed via WireMock or similar.
- Deterministic loop tests: how to make Claude-call boundaries pluggable so we can substitute a stub.

---

## Decisions log (for traceability)

| Decision | Rationale | Date |
|---|---|---|
| TypeScript + NestJS + Next.js | Single language across stack; Claude Agent SDK is officially TS | 2026-05-22 |
| Claude Agent SDK over raw API | Native subagent feature is exact fit for "one subagent per component" + `Stop` hook fits the expand-window loop | 2026-05-22 |
| CLI auth, no API key | User prefers Claude Code's OAuth session over key management | 2026-05-22 |
| All data via Grafana datasource proxy | Single credential, no duplicate secrets, respects existing security boundary | 2026-05-22 |
| Hybrid MD for components | Single source of truth — human prose + machine-parseable YAML | 2026-05-22 |
| 4h initial window, +30m step, 24h cap | User-specified loop tuning | 2026-05-22 |
| Slack delivery + Mongo persistence | User's existing tooling; resolution capture for learning loop | 2026-05-22 |
| Dashboard is primary, webhook is last | User explicitly de-prioritized webhook | 2026-05-22 |
| No webhook auth | Internal network only; pragmatic | 2026-05-22 |
| Approach 1: SDK-native subagents + Stop hook | Idiomatic, parallel, hook handles the loop cleanly | 2026-05-22 |
