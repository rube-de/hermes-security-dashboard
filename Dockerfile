# syntax=docker/dockerfile:1

# ---- builder: install all deps and build the adapter-node server ----
# Node base (not the bun image) so the build runs under Node: db.ts imports the
# built-in node:sqlite, which Bun's runtime has no equivalent for and would fail
# to resolve during `vite build`. Bun is still used as the fast package manager.
FROM node:26-bookworm-slim AS builder
WORKDIR /app
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# Base path is baked at build time (SvelteKit paths.base). Empty → root deploy.
# Pass with: docker build --build-arg BASE_PATH=/security .
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
# `bun run build` dispatches vite via its node shebang since Node is on PATH here.
RUN bun run build

# ---- prod-deps: production-only node_modules (adapter-node externalizes
#      `dependencies`; everything in devDependencies is bundled into build/) ----
FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# ---- runtime: Node with built-in node:sqlite, non-root, on the shared volume ----
# node:sqlite is stable and unflagged on Node 24+; pinned to 26 (matches dev),
# so the start command needs no --experimental-sqlite flag.
FROM node:26-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HERMES_DB=/data/hermes.db
ARG BASE_PATH=""
ENV BASE_PATH=$BASE_PATH

# UID:GID 10000:10000 matches the shared, externally file-synced data volume.
RUN groupadd -g 10000 app \
    && useradd -u 10000 -g 10000 -m -s /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown 10000:10000 /data

COPY --chown=10000:10000 package.json ./
COPY --chown=10000:10000 --from=prod-deps /app/node_modules ./node_modules
COPY --chown=10000:10000 --from=builder /app/build ./build

USER 10000:10000

# Live DB, WAL/SHM and the snapshot all live on the synced volume. The sync
# sidecar must copy ONLY hermes.db.snapshot — never the live .db/-wal/-shm.
VOLUME ["/data"]
EXPOSE 3000

# Liveness via the dedicated endpoint, base-path aware.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+(process.env.BASE_PATH||'')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
