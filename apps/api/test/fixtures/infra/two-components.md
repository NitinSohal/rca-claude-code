# Infra overview

## Request flow
Two-service system.

---

## Component: auth-service

```yaml
name: auth-service
type: service
description: Validates JWTs
loki:
  selector: '{service="auth-service"}'
depends_on: [postgres-primary]
```

## Component: postgres-primary

```yaml
name: postgres-primary
type: datastore
description: Primary Postgres
prometheus:
  metrics:
    - name: connections
      query: 'pg_stat_activity_count'
```
