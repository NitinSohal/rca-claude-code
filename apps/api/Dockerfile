# Build stage
FROM node:22-bookworm-slim AS build
WORKDIR /repo

RUN npm i -g pnpm@9.12.0

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/agent/package.json apps/agent/tsconfig.json apps/agent/src apps/agent/src/
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
RUN pnpm install --frozen-lockfile

COPY apps/agent ./apps/agent
COPY apps/api ./apps/api

RUN pnpm --filter @rca/agent run build
RUN pnpm --filter @rca/api run build

# Runtime stage
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@9.12.0 @anthropic-ai/claude-code

ENV NODE_ENV=production
ENV CLAUDE_CONFIG_DIR=/root/.claude
ENV INFRA_MD_PATH=/app/infra/infra.md
ENV PORT=8080

COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/agent/dist ./node_modules/@rca/agent/dist
COPY --from=build /repo/apps/agent/package.json ./node_modules/@rca/agent/package.json
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/pnpm-lock.yaml ./pnpm-lock.yaml

RUN pnpm install --prod --frozen-lockfile

VOLUME ["/app/infra", "/root/.claude"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8080/readyz || exit 1

CMD ["node", "dist/main.js"]
