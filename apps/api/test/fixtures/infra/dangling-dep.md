# Infra

## Component: a

```yaml
name: a
type: service
description: A
loki:
  selector: '{a}'
depends_on: [b-does-not-exist]
```
