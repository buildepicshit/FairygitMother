FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# Install deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/node/package.json packages/node/
COPY packages/skill-openclaw/package.json packages/skill-openclaw/

RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json biome.json ./
COPY packages/ packages/
COPY migrations/ migrations/

# ── Runtime ─────────────────────────────────────────────────────
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

COPY --from=base /app ./

# Data directory for persisted stats
RUN mkdir -p /data
ENV FAIRYGITMOTHER_DATA_DIR=/data
ENV FAIRYGITMOTHER_HOST=0.0.0.0
ENV FAIRYGITMOTHER_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["pnpm", "start"]
