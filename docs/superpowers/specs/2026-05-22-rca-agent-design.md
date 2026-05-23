---
title: RCA Agent — Design Spec
date: 2026-05-22
owner: Nitin Sohal
status: APPROVED — all 6 sections signed off; awaiting final user review before writing-plans
---

# RCA Agent — Design Spec

> Single source of truth for `rca-claude-code`. The README is the elevator-pitch + onboarding entry point; this file is the precise design.

## Status legend

- APPROVED — user has signed off
- DRAFT — written but not yet reviewed
- TBD — still being brainstormed

---

## 0. Problem statement — APPROVED

We want a system that, when given a time window of suspected outage (or alerted via Grafana webhook), produces a structured root-cause analysis grounded in Grafana-monitored data: logs (Loki), metrics (Prometheus), cloud-native signals (CloudWatch), and alert state (Grafana Alerting).

The user (Nitin) is a single operator on a small infra (~9 components) who wants the system to:

- Use one **Grafana service account** as the single point of data access — no direct connections to Loki / Prom / AWS.
- Reason **one Claude subagent per component**, in parallel, against a markdown infra description he maintains.
- Auto-expand its analysis window if the first attempt isn't conclusive.
- Persist past RCAs **and his resolution notes** so future RCAs can learn from history.
- Run as Docker containers next to his existing Mongo, configurable entirely via env vars so anyone can adopt the project.

The primary surface is a **Next.js dashboard**. CLI and Grafana webhook are secondary.

---

## 1. Architecture overview — APPROVED

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

All log / metric / cloud queries go through Grafana's datasource proxy API:

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
BASELINE_TOLERANCE=0.20
BACKOFF_MS=5000
MAX_COMPONENTS=20
LOG_LEVEL=info
LOG_SUCCESSES=false
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
                 lookup_dependency(component_name)
          ↓ all 9 calls route through ONE Grafana service account
   Aggregator → Synthesizer (Claude)
          ↓
   Stop hook → expand window OR finish
          ↓ on finish: persist to Mongo, post to Slack, stream to UI
```

---

## 2. Component & infra MD format — APPROVED

### 2.1 File structure

One markdown file at `INFRA_MD_PATH`. Top section is prose (request flow + infra setup — read by every subagent as cached context). After the prose, one `## Component: <name>` section per component, each containing a fenced YAML block.

```markdown
# Infra overview

## Request flow
A typical user request hits the ALB → auth-service (validates JWT) →
payments-api (reads from postgres-primary, writes to redis-cache for
session state) → emits an event to RabbitMQ → consumed by ...

## Topology notes
- All services run on ECS Fargate in us-east-1
- Postgres primary has 2 read replicas
- Redis is a 3-node cluster

---

## Component: auth-service

```yaml
name: auth-service
type: service
description: Validates JWTs, issues session cookies, handles login/logout
loki:
  selector: '{service="auth-service", env="prod"}'
  error_filter: '|~ "(?i)error|fatal|panic|exception"'
prometheus:
  metrics:
    - name: request_rate
      query: 'sum(rate(http_requests_total{service="auth-service"}[5m]))'
    - name: error_rate
      query: 'sum(rate(http_requests_total{service="auth-service",status=~"5.."}[5m]))'
    - name: p95_latency
      query: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="auth-service"}[5m])) by (le))'
cloudwatch:
  namespace: AWS/ECS
  dimensions:
    ClusterName: prod
    ServiceName: auth-service
  metrics: [CPUUtilization, MemoryUtilization]
depends_on: [postgres-primary, redis-cache]
runbook_url: https://wiki.internal/runbooks/auth-service
```
```

### 2.2 YAML schema

| Field | Required | Type | Purpose |
|---|---|---|---|
| `name` | yes | string, kebab-case, unique | Component identifier; matches subagent filename |
| `type` | yes | enum: `service` `datastore` `queue` `cache` `external` | Selects subagent prompt template variant |
| `description` | yes | string (one line) | Used in synthesizer summaries |
| `loki.selector` | optional | LogQL stream selector | If absent, subagent skips log queries |
| `loki.error_filter` | optional | LogQL line filter | Appended to selector for "errors only" tool call |
| `prometheus.metrics[]` | optional | list of `{name, query}` | Each fetched in parallel; `name` is what the subagent sees |
| `cloudwatch.namespace` + `dimensions` + `metrics[]` | optional | strings | Used to build CW metric queries |
| `depends_on` | optional | list of component names | Drives cross-component evidence |
| `runbook_url` | optional | URL | Surfaced in RCA output, not used by LLM |

A component with **no** Loki, Prometheus, or CloudWatch keys causes startup to fail. A component referenced in `depends_on` that doesn't exist also causes startup to fail. Cycles in `depends_on` are allowed but logged as warnings.

No per-component Slack channel — single channel via `SLACK_WEBHOOK_URL`.

### 2.3 Prompt context per subagent

Each subagent receives:
- **Full prose section of `infra.md`** — prompt-cached so it's effectively free after the first call.
- **Its own YAML block** — pretty-printed.
- **Stripped index of other components** — `name: description` only, so it understands its peers without bloating context.

The synthesizer (not the subagents) gets the **full file** since it correlates across components.

### 2.4 How `depends_on` is used

1. **Synthesizer reasoning:** `depends_on` becomes a JSON `dependency_graph` injected into the synthesizer prompt. Findings from a component's dependencies are weighted more heavily when they line up.
2. **Drill-down tool:** subagents have a `lookup_dependency(component_name)` tool that returns the latest preliminary finding from a dependency's subagent within the same cycle. Subagents publish preliminary findings to an in-memory bus before the synthesizer runs.

### 2.5 Loading & validation pipeline

On `rca-api` container startup:
1. Read `INFRA_MD_PATH` (default `/app/infra/infra.md`).
2. Split prose vs. component sections by regex `^## Component: (.+)$`.
3. Validate each YAML block against a Zod schema matching 2.2.
4. Detect cycles in `depends_on` — allowed, logged warning.
5. Detect references to nonexistent components — fatal.
6. Generate `infra/prompts/<component>.md` files — one Agent SDK subagent definition per component, regenerated every startup so the MD is always the source of truth.
7. On any validation failure, fail container start with a structured error pointing at the offending component.

Standalone CLI `rca validate-infra <path>` runs the same pipeline without the container.

### 2.6 Safety guard

`MAX_COMPONENTS` env var (default 20) — startup fails if exceeded.

---

## 3. Subagent + coordinator design — APPROVED

### 3.1 Subagent definition

Each component's subagent file (`infra/prompts/<name>.md`) is generated at startup. Shape:

```markdown
---
name: <component>-investigator
description: Investigates the <component> component for the given time window
tools:
  - grafana_query_loki
  - grafana_query_prom
  - grafana_query_cloudwatch
  - lookup_dependency
model: claude-sonnet-4-6
---

You are an SRE investigator for ONE component: **<component>**.

# Your context
<full prose section of infra.md — prompt cached>

# Other components in the system (for reference only — use lookup_dependency if needed)
- payments-api: Handles checkout, talks to postgres-primary
- ...

# YOUR component
<component YAML block, pretty-printed>

# Your job
For the time window {{from}} → {{to}}:
1. Use the pre-fetched data below.
2. If pre-fetched data is inconclusive, use your tools to drill deeper.
3. Be evidence-led — every claim must cite a log line, metric value, or CW datapoint.
4. If your evidence points at a dependency, say so explicitly.

# Pre-fetched data
<inserted at runtime by coordinator — see 3.2>

# Output format — REQUIRED
Return ONLY valid JSON matching:
{
  "component": "<component>",
  "status": "healthy" | "degraded" | "failed" | "inconclusive",
  "confidence": 0.0-1.0,
  "findings": [
    {
      "summary": "one-sentence description",
      "evidence": [{ "type": "log|metric|cw", "ref": "...", "value": "..." }],
      "severity": "info|warn|error|critical"
    }
  ],
  "suspected_dependencies": ["postgres-primary", ...],
  "notes": "free-form text, ≤ 200 words"
}
```

### 3.2 Pre-fetched data per subagent

Coordinator runs all YAML-defined queries in parallel through the Grafana proxy. Each subagent receives:

```json
{
  "window": { "from": "...", "to": "..." },
  "loki": {
    "error_lines": [{ "ts": "...", "line": "..." }],
    "stats": { "total_lines": 12345, "error_lines": 87, "rate_per_min": [...] }
  },
  "prometheus": {
    "<metric_name>": [[ts, value], ...]
  },
  "cloudwatch": {
    "<metric_name>": [[ts, value], ...]
  }
}
```

Budgets:
- Logs: max 500 lines per component, lines truncated to 1KB; sampled if more.
- Metrics: downsampled to ≤ 100 points per series (LTTB).
- Total per subagent: ~15K tokens of pre-fetched data ceiling.

If a subagent needs more, it calls the tools — same per-call budgets apply.

### 3.3 Coordinator responsibilities

NestJS service. Responsibilities:

1. Accept `{ from, to, trigger: "manual" | "webhook" | "health" }`.
2. Create `runs` doc: `{ _id, started_at, trigger, window, status: "running", iteration: 1 }`.
3. Pre-fetch all per-component data in parallel via Grafana proxy.
4. Spawn 9 subagents in parallel via Agent SDK `query()`.
5. Per-subagent timeout: 90s. On timeout → output is `{ status: "inconclusive", confidence: 0, notes: "timeout" }`.
6. Per-subagent retry: 1 retry on 5xx from Anthropic or tool-level Grafana failure; no retry on schema-validation failure (logged + treated as inconclusive).
7. Stream subagent outputs to UI as they arrive (SSE — Section 4.6).
8. Invoke synthesizer once all 9 are done OR after a 200s hard floor (covers 90s × first attempt + 90s × retry + slack; partial results OK).
9. Run Stop hook to decide expand vs. finish (Section 4).
10. On finish: persist RCA, post to Slack, set `runs.status = "completed"`.

**Quorum rule:** as long as ≥ 6 of 9 subagents return usable output, synthesizer runs. Otherwise the run is `degraded`, synthesizer is NOT called, a critical event is created, and the user is notified.

**Per-subagent failure also creates events** — see Section 5.

### 3.4 Synthesizer

One-shot Claude `query()`, no tools. Input:

```
<full infra.md — prompt cached>
<dependency_graph (JSON)>
<9 subagent outputs (concatenated JSON)>
<past similar RCAs from Mongo — see 3.5>
<window>
```

Output schema (enforced by Zod after parse):

```json
{
  "summary": "one-paragraph TL;DR",
  "root_cause": {
    "component": "postgres-primary",
    "description": "...",
    "confidence": 0.82
  },
  "contributing_factors": [
    { "component": "auth-service", "description": "...", "severity": "warn" }
  ],
  "timeline": [
    { "ts": "09:12:30Z", "event": "..." }
  ],
  "evidence": [
    { "component": "...", "type": "log|metric|cw", "ref": "...", "excerpt": "..." }
  ],
  "suggested_next_steps": ["..."],
  "similar_past_rcas": ["rca_id_1", "rca_id_2"]
}
```

### 3.5 Past similar RCAs

Before the synthesizer runs, the coordinator queries Mongo:

```js
for each component flagged by subagents:
    db.rcas.find({
        "root_cause.component": component,
        "status": "resolved"
    }).sort({ created_at: -1 }).limit(3)
```

Results de-duplicated by `_id`, top 3 by recency overall. Resolution notes joined in. Embedding-based similarity deferred to phase 3.

### 3.6 Token budget per cycle

| Stage | Approx |
|---|---|
| 9 subagent calls × (~5K prompt + ~15K pre-fetch + ~2K output) | ~200K tokens |
| Synthesizer | ~30K tokens |
| Per cycle | ~230K tokens |
| Savings from prompt caching after iteration 1 | ~25K tokens |

`cache_control: { type: "ephemeral" }` applied to any prompt block containing `infra.md` content.

### 3.7 Out of scope for the coordinator

- Stop-hook decision (Section 4).
- Tool implementations themselves (separate `grafana.service.ts` injected as a NestJS provider).
- SSE wire protocol details (Section 4.6).

---

## 4. The expand-window loop — APPROVED

### 4.1 Loop pseudocode

```ts
async function runRcaCycle(req) {
  const run = await mongo.runs.create({ trigger: req.trigger, started_at: now() });
  let from = req.from;
  let to   = req.to;
  let iteration = 0;
  let lastRca = null;

  while (true) {
    iteration++;
    await mongo.runs.update(run._id, { iteration, current_window: { from, to } });

    const { subagentOutputs } = await spawnAllSubagents({ from, to, run });
    lastRca = await synthesize({ subagentOutputs, window: { from, to }, run });
    await streamToUi(run._id, { type: "iteration_complete", iteration, rca: lastRca });

    const decision = await stopHook.evaluate({ rca: lastRca, run, window: { from, to } });
    if (decision.stop) {
      await finalize(run._id, lastRca, decision.reason);
      return lastRca;
    }

    from = subtract(from, MINUTES(WINDOW_STEP_MINUTES));

    if (hoursBetween(from, to) > WINDOW_MAX_HOURS) {
      await finalize(run._id, lastRca, "time_capped");
      return lastRca;
    }

    await sleep(BACKOFF_MS);
  }
}
```

### 4.2 Stop hook predicate

```ts
async function evaluate({ rca, run, window }) {
  if (hoursBetween(window.from, window.to) >= WINDOW_MAX_HOURS) {
    return { stop: true, reason: "time_capped" };
  }

  const meaningful =
    rca.root_cause.confidence >= RCA_CONFIDENCE_THRESHOLD &&
    rca.evidence.length > 0;

  let spikeOver = true;
  if (run.trigger === "webhook" && run.alert_uid) {
    const alertState = await grafana.getAlertState(run.alert_uid);
    const metricBack = await checkMetricBaseline(run.alert_uid, window);
    spikeOver = (alertState === "ok") && metricBack;
  }

  if (meaningful && spikeOver) return { stop: true, reason: "success" };
  if (meaningful && !spikeOver) return { stop: false, reason: "rca_good_but_incident_ongoing" };
  return { stop: false, reason: "not_meaningful_yet" };
}
```

- Manual runs: spike-finished is auto-true.
- Webhook runs: both meaningful and spike-finished must hold.
- Health-check runs: bypass the loop entirely — one pass, return.

### 4.3 Grafana Alerting state polling

`GET /api/v1/provisioning/alert-rules/<uid>`. Webhook payload provides `alert_uid`, cached on the `runs` document at trigger time. Polled once per loop iteration.

### 4.4 "Metric back to baseline" detection

1. Read the alert rule's query at run-start; cache on `runs`.
2. **Baseline** = average value of that query over 30 minutes immediately preceding the alert's first fire time.
3. **Current** = average over the last 5 minutes.
4. `metricBack = |current - baseline| / baseline <= BASELINE_TOLERANCE` (default 0.20).
5. If baseline is near zero (e.g., error rate normally 0), switch to absolute mode: `current < 0.01 * peak`. The detector picks the right mode automatically by inspecting whether `baseline > 0.05 * peak`.

### 4.5 Failure modes inside the loop — and the events they create

| Failure | Behavior | Event |
|---|---|---|
| Synthesizer call times out (>90s) | Retry once; on second timeout this iteration → "not meaningful", continue | warn, source=anthropic, operation=synthesize |
| Grafana down during baseline check | Skip metric-baseline this iteration, fall back to alert-state only | critical, source=grafana |
| Mongo write fails | Retry 3× exponential; in-memory result still streamed to UI; persistent event surfaced in notification center | critical, source=mongo |
| Anthropic rate-limit | SDK backoff; if exceeded twice → finalize with `reason: "rate_limited"`, best-so-far RCA | critical, source=anthropic |
| `WINDOW_MAX_HOURS` reached with no meaningful RCA | Return last RCA with `reason: "time_capped"` | info, source=stop_hook |

### 4.6 Streaming to the UI — SSE format

`GET /api/runs/:id/stream` events:

```
event: iteration_start
data: { "iteration": 2, "window": {...} }

event: subagent_progress
data: { "component": "auth-service", "status": "querying_loki" }

event: subagent_done
data: { "component": "auth-service", "output": {...} }

event: synthesizer_progress
data: { "stage": "thinking" }

event: iteration_complete
data: { "iteration": 2, "rca": {...}, "stop_decision": {...} }

event: run_complete
data: { "final_rca": {...}, "reason": "success" }

event: error
data: { "message": "...", "fatal": true }
```

UI renders a stepped timeline: each iteration is an expandable card showing 9 subagent results + synthesizer output + stop decision.

### 4.7 Expansion direction

`from` walks **backward** in time; `to` stays fixed. We don't extend forward — the alert spike is in the past, forward-extension adds only post-incident noise.

For manual runs, auto-expand is **off by default**. The form has an opt-in toggle.

### 4.8 Concurrency guards

- Between iterations: `BACKOFF_MS=5000` (env-configurable).
- Per iteration: ~27 Grafana queries (9 components × ~3 queries). Coordinator caps concurrent in-flight Grafana calls at 10 via a semaphore.

---

## 5. Error handling, observability, security — APPROVED

### 5.1 Per-target failure policy

| Layer | What can fail | Policy |
|---|---|---|
| Grafana datasource proxy | 5xx, timeout, datasource unhealthy | 2 retries, exponential backoff (250ms, 1s). Circuit breaker opens after 5 consecutive failures within 60s; half-opens after 30s. While open, return empty results + mark affected subagent as `data_unavailable`. |
| Anthropic API | 429, 5xx, timeout | SDK built-in backoff inside each call attempt. Orchestrator-level cap = the 90s subagent timeout in §3.3, plus 1 retry. On exhaustion → subagent inconclusive + event. |
| MongoDB | connection drop, write failure | Write retries 3× exponential. Total failure → in-memory result still streamed to UI; persistent critical event created (see §5.9). |
| Slack | 4xx (bad webhook), 5xx | Retry 3× backoff for 5xx; 4xx fails fast. **Never blocks RCA completion.** |
| Claude CLI auth | expired session, missing `~/.claude` | Startup check: container refuses to start if `claude --version` or auth probe fails. Clear error: "Run `claude login` on host." |
| `infra.md` malformed | missing fields, bad YAML, dangling `depends_on` | Startup fails with structured error. |

### 5.2 `OutboundCallGuard`

One NestJS service wraps every external HTTP client (Grafana, Slack, Anthropic via SDK hook). Exposes `withGuard(target, fn)`. Per-target in-memory state:

```
{ failures: number, opened_at: timestamp | null }
```

Three states: `CLOSED`, `OPEN`, `HALF_OPEN`. No external library; lost on restart (acceptable for our scale).

### 5.3 Logging

`pino` + structured JSON to stdout. Fields:

| Field | Always present |
|---|---|
| `level` | `info` `warn` `error` |
| `time` | ISO timestamp |
| `run_id` | if applicable |
| `iteration` | if applicable |
| `component` | if applicable |
| `target` | for outbound calls: `grafana` `anthropic` `mongo` `slack` |
| `duration_ms` | for timed ops |
| `msg` | human-readable |

No `DEBUG` in production builds. `LOG_LEVEL` env-configurable.

Logs and **events** (Section 5.9) are separate concerns: logs are for ops + grep; events are user-facing in the UI. Most logs do not become events — only durable-outcome ones do.

### 5.4 Self-observability

Mongo collection `runs` IS our observability — every run records:
- Start/end time, total duration
- Iterations attempted
- Subagent durations
- Token usage per call (from Agent SDK response)
- Stop reason
- Slack delivery success

A small `/system` dashboard page (phase 3) surfaces run-rate stats. No Prometheus self-instrumentation in v1 — overkill for a single-operator tool.

### 5.5 Secrets handling

- `.env` is gitignored.
- `.env.example` committed with placeholder values only.
- README explicitly warns against committing `.env`.
- Sensitive env vars: `GRAFANA_SERVICE_ACCOUNT_TOKEN`, `SLACK_WEBHOOK_URL`.
- v2 hardening (mentioned in README, not built): Docker secrets or host-level secrets manager.
- Outbound HTTP middleware redacts any header containing `authorization`, `token`, `key`, `secret`.

### 5.6 What happens when an external dependency is down — user-visible behavior

| Down | RCA behavior | Persistent event |
|---|---|---|
| Grafana | RCA aborts | critical, source=grafana, suggested_fix="Check GRAFANA_URL and token validity" |
| Mongo | RCA runs, streamed to UI, not persisted | critical, source=mongo |
| Slack | RCA completes, persisted | error, source=slack, suggested_fix="Verify SLACK_WEBHOOK_URL" |
| Anthropic | RCA aborts | critical, source=anthropic |
| Circuit breaker opens | RCA continues with `data_unavailable` for affected component | warn → critical (depending on source criticality) |
| Claude auth expired mid-run | RCA aborts | critical, source=claude_auth, suggested_fix="Run `claude login` then restart rca-api" |
| `infra.md` reload fails on edit | New RCAs use last good config | error, source=infra_md |

### 5.7 Non-goals

- No multi-tenancy or org isolation.
- No RBAC.
- No audit log beyond `runs` + `resolutions` + `events`.
- No background scheduled health checks in v1 (easy to add as phase-3 cron).
- No self-alerting ("alert if RCA tool is down") — that's a Grafana alert pointed at `/healthz`.

### 5.8 Health endpoints

- `GET /healthz` — `{ status, grafana, mongo, claude_auth, unacknowledged_events: { critical, error, warn } }`.
- `GET /readyz` — 200 only if `infra.md` parsed, Claude auth probe passed, Mongo reachable.

Used by Docker healthcheck + external uptime probes.

### 5.9 Persistent events panel — the user's authoritative "is anything wrong" view

Every external-operation outcome that matters becomes a **durable, user-visible event**. The RCA itself does NOT block on these; the event sticks on the dashboard until the user acts or it auto-resolves.

Mongo collection `events`:

```js
events: {
  _id,
  created_at,
  severity: "info" | "warn" | "error" | "critical",
  source: "grafana" | "mongo" | "slack" | "anthropic" | "claude_auth" | "webhook" | "infra_md" | "circuit_breaker" | "stop_hook",
  operation,                       // e.g., "query_loki", "post_message", "synthesize"
  message,                         // e.g., "Slack post failed: 404 invalid_webhook_url"
  context: { run_id?, component?, http_status?, attempt?, duration_ms? },
  status: "unacknowledged" | "ignored" | "resolved",
  acknowledged_by: null,
  acknowledged_at: null,
  resolved_at: null,
  suggested_fix: "..." | null
}
```

### 5.10 What generates events

`OutboundCallGuard` writes to `events` on:
- Any failure after retries are exhausted → `error` or `critical`
- Any circuit-breaker open transition → `critical`
- Auth-probe failure at startup → `critical`
- `infra.md` reload failure → `error`
- Per-subagent failure inside a run → severity scaled by impact
- (Opt-in via `LOG_SUCCESSES=true`) successful operations → `info`. Off by default.

**Auto-resolution:** if the same `(source, operation)` pair succeeds on the next attempt, ALL `unacknowledged` events for that pair flip to `resolved` with `resolved_at = now`. The user sees "this fixed itself" in the panel.

### 5.11 Dashboard notification center

Persistent UI element on every page:
- **Header badge:** bell icon with unacknowledged count. Color = max severity. Hidden when count is 0.
- **Drawer (on click):** unacknowledged events, newest first, grouped by `source + operation`. Per row: severity icon, timestamp, message, "Ignore", "View detail".
- **Detail page (`/events/:id`):** full context dump, suggested fix, "Mark resolved" / "Ignore".
- **Filters:** by severity, source, status.
- **No auto-dismiss.** Events persist until user action OR auto-resolve fires.

---

## 6. Testing strategy — APPROVED

### 6.1 Test layers

| Layer | What | Tool | When |
|---|---|---|---|
| Unit | `infra.md` parser, Zod schemas, Stop hook predicate, LTTB downsampler, baseline detector | Vitest | Pre-commit + CI |
| Integration | NestJS modules with mocked outbound (Grafana, Mongo, Slack) | Vitest + `nock` + `mongodb-memory-server` | Pre-commit + CI |
| E2E | Full RCA cycle: real (memory) Mongo, recorded Grafana fixtures, **stub Claude** | Vitest + JSON fixtures | CI only (slow) |

No browser/UI tests in v1. Dashboard is thin (renders streamed JSON); we test the API contract, the user eyeballs the UI. Add Playwright in phase 3 if UI complexity grows.

### 6.2 Stubbing Claude — the key enabling technique

Agent SDK is fronted by a thin `ClaudeClient` wrapper (in `apps/agent`). In tests, override with `StubClaudeClient`:

```ts
testModule.overrideProvider(ClaudeClient).useValue(
  new StubClaudeClient({
    "auth-service-investigator":     (input) => fixtures.authServiceOutput(input.window),
    "postgres-primary-investigator": ()      => fixtures.postgresOutput_dbConnectionPool,
    "synthesizer":                   (input) => fixtures.synthesizerOutput_from(input.subagentOutputs),
  })
);
```

Fixtures in `apps/agent/test/fixtures/`. Canonical shapes:
- All-healthy
- Single component degraded
- Multi-component cascade (auth-service degraded BECAUSE postgres-primary failed)
- Inconclusive
- Quorum failure (4 of 9 subagents timed out)

### 6.3 Stop-hook tests — highest-value tests in the system

| Test | Setup | Expected |
|---|---|---|
| Confident + evidenced + manual | `confidence=0.9, evidence=[...]` | `stop: true, reason: "success"` |
| Confident but evidence empty | `confidence=0.9, evidence=[]` | `stop: false, reason: "not_meaningful_yet"` |
| Low confidence | `confidence=0.3` | `stop: false` |
| Manual + auto-expand off | confident + manual + no toggle | finalize after iteration 1 |
| Confident + Grafana alert firing | webhook + `alertState=alerting` | `stop: false, reason: "rca_good_but_incident_ongoing"` |
| Confident + alert ok + metric not back | `alertState=ok` + baseline check fails | `stop: false` |
| Confident + alert ok + metric back | both pass | `stop: true, reason: "success"` |
| At window cap | `window = 24h` | `stop: true, reason: "time_capped"` regardless of confidence |

### 6.4 Grafana client tests

Use `nock`. Categories:
- **Happy path:** auto-discovery picks UIDs; queries return well-formed payloads; assert headers (`Authorization: Bearer <token>`), request bodies, downsampling.
- **Failure path:** 5xx triggers retry; 429 triggers backoff; repeated failures open circuit breaker; verify event created in Mongo.
- **Auth-rejection:** 401 → event severity=critical, suggested_fix mentions token.

Fixtures: small set of stripped real Loki/Prom/CW response shapes in `apps/api/test/fixtures/grafana/`.

### 6.5 Coordinator integration tests

`mongodb-memory-server` + `nock` + stub Claude:

| Test | Asserts |
|---|---|
| 9-subagent happy path | All 9 outputs received, synthesizer called, RCA persisted with correct shape |
| 6-of-9 quorum met | Synthesizer runs, RCA persisted, partial-failure noted, 3 events created |
| 5-of-9 quorum failed | Run `degraded`, synthesizer NOT called, single critical event "Quorum not met" |
| Expand-window loop | Stub returns low confidence twice then high; `runs.iteration=3`, window expanded backward by 30min × 2 |
| Time cap | Stub never confident; loop terminates at `WINDOW_MAX_HOURS` with `reason: "time_capped"` |
| Slack failure | Slack 500; RCA persisted, event created, run completes anyway |
| Mongo write failure mid-run | Inject failure; in-memory RCA returned to caller with warning |

### 6.6 `infra.md` parser tests

| Test | Expected |
|---|---|
| Valid file, 3 components | Parses, generates 3 prompt files, validation passes |
| Missing required field (`type`) | Validation fails with error pointing to component + field |
| Cycle in `depends_on` | Parses, logs warning |
| Unknown component in `depends_on` | Validation fails (fatal) |
| Component with no data sources | Validation fails |
| Exceeds `MAX_COMPONENTS` | Validation fails |
| Missing file | Container refuses to start |

### 6.7 Resolution-loop tests

- Past RCA with `root_cause.component = "postgres-primary"` AND a resolution → returned when next RCA flags postgres.
- Past RCA without resolution → NOT returned.
- More than 3 matches → top-3 by recency.
- No matches → synthesizer prompt has `similar_past_rcas: []`.

### 6.8 Non-tests

- Claude output content quality (we test the contract, not the wisdom).
- Next.js UI render (eyeball it).
- Anthropic SDK internals.
- MongoDB itself.
- Network-level Grafana availability (covered by circuit-breaker tests + events panel).

### 6.9 CI

`.github/workflows/ci.yml`:
1. Checkout
2. Node 22, pnpm install
3. Lint (eslint + prettier check)
4. Typecheck (`tsc --noEmit`)
5. Unit + integration tests (`pnpm test`)
6. Docker compose build (verify both containers build cleanly)

E2E runs on `main` only.

### 6.10 Local dev loop

- `pnpm test --watch` — inner loop
- `pnpm test:e2e` — slow lane
- `pnpm validate-infra <path>` — standalone parser check, no container

---

## Decisions log (for traceability)

| Decision | Rationale | Date |
|---|---|---|
| TypeScript + NestJS + Next.js | Single language across stack; Agent SDK is officially TS | 2026-05-22 |
| Claude Agent SDK over raw API | Native subagent feature fits "one subagent per component"; Stop hook fits the expand-window loop | 2026-05-22 |
| CLI auth, no API key | User prefers Claude Code's OAuth session over key management | 2026-05-22 |
| All data via Grafana datasource proxy | Single credential, no duplicate secrets, respects existing security boundary | 2026-05-22 |
| Hybrid MD for components | Single source of truth — human prose + machine-parseable YAML | 2026-05-22 |
| 4h initial window, +30m step, 24h cap | User-specified loop tuning | 2026-05-22 |
| Slack delivery + Mongo persistence | User's existing tooling; resolution capture for learning loop | 2026-05-22 |
| Dashboard primary, webhook last | User explicitly de-prioritized webhook | 2026-05-22 |
| No webhook auth | Internal network only | 2026-05-22 |
| Approach 1: SDK-native subagents + Stop hook | Idiomatic, parallel, hook handles the loop cleanly | 2026-05-22 |
| Quorum: ≥6 of 9 subagents must succeed | Tolerates partial failures without producing garbage RCAs | 2026-05-22 |
| Component-keyed past-RCA lookup (no embeddings) | Simple, fast, good enough for v1 | 2026-05-22 |
| Manual auto-expand off by default | Manual runs respect the user's chosen window unless they opt in | 2026-05-22 |
| 20% baseline tolerance | User-approved default | 2026-05-22 |
| SSE for live RCA stream | Simpler than WebSockets for one-way push | 2026-05-22 |
| Persistent events panel with auto-resolve | Every external-op failure becomes durable + visible; non-blocking on RCAs | 2026-05-22 |
| Stub Claude in tests via `ClaudeClient` wrapper | Determinism without paying for live calls | 2026-05-22 |
