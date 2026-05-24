# Infra overview

## Request flow
ALB → auth-service → payments-api.

---

## Component: auth-service

```yaml
name: auth-service
type: service
description: Validates JWTs
loki:
  selector: '{service="auth-service"}'
```
