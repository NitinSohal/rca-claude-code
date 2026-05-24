FROM node:22-bookworm-slim AS deps
WORKDIR /repo
RUN npm i -g pnpm@9.12.0
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --filter @rca/web --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN npm i -g pnpm@9.12.0
COPY --from=deps /repo/node_modules ./node_modules
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web ./apps/web
RUN pnpm --filter @rca/web build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000 || exit 1
CMD ["node", "apps/web/server.js"]
