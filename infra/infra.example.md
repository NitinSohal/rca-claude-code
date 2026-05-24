# Infra overview

## Request flow
A typical user request hits the ALB → auth-service (validates JWT) → payments-api
(reads from postgres-primary, writes to redis-cache for session state) → emits an event to
RabbitMQ → consumed by notification-worker which sends to SES.

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
cloudwatch:
  namespace: AWS/ECS
  dimensions:
    ClusterName: prod
    ServiceName: auth-service
  metrics: [CPUUtilization, MemoryUtilization]
depends_on: [postgres-primary, redis-cache]
runbook_url: https://wiki.internal/runbooks/auth-service
```

## Component: postgres-primary

```yaml
name: postgres-primary
type: datastore
description: Primary Postgres for application state
prometheus:
  metrics:
    - name: active_connections
      query: 'pg_stat_activity_count{instance="postgres-primary"}'
    - name: replication_lag_seconds
      query: 'pg_replication_lag_seconds{instance="postgres-primary"}'
cloudwatch:
  namespace: AWS/RDS
  dimensions:
    DBInstanceIdentifier: postgres-primary
  metrics: [CPUUtilization, FreeableMemory, DatabaseConnections]
runbook_url: https://wiki.internal/runbooks/postgres
```

## Component: redis-cache

```yaml
name: redis-cache
type: cache
description: Session cache (3-node cluster)
cloudwatch:
  namespace: AWS/ElastiCache
  dimensions:
    CacheClusterId: redis-cache
  metrics: [CPUUtilization, FreeableMemory, CurrConnections, Evictions]
runbook_url: https://wiki.internal/runbooks/redis
```
