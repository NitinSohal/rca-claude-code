# Infra

## Component: a

```yaml
name: a
type: service
description: A
loki:
  selector: '{a}'
depends_on: [b]
```

## Component: b

```yaml
name: b
type: service
description: B
loki:
  selector: '{b}'
depends_on: [a]
```
