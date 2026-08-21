# The fetcher daemon.
#
# Built from the repo root, not from apps/worker — npm workspaces resolve @knowit/* through
# the root node_modules, so the build context has to include the whole monorepo.
#
#   docker build -f apps/worker/Dockerfile -t knowit-worker .

FROM node:24-slim AS deps

WORKDIR /app

# Manifests first, source later: dependencies change far less often than code, so this
# layer survives most rebuilds. Every workspace manifest must be present or `npm ci`
# refuses to resolve the workspace links.
COPY package.json package-lock.json ./
COPY packages/core/package.json      packages/core/
COPY packages/db/package.json        packages/db/
COPY packages/adapters/package.json  packages/adapters/
COPY apps/worker/package.json        apps/worker/

# Dev dependencies are kept deliberately: the workspace packages ship TypeScript source
# with no build step, so `tsx` is a runtime requirement rather than a build tool.
RUN npm ci --workspace @knowit/worker --include-workspace-root

# ---------------------------------------------------------------------------

FROM node:24-slim AS runtime

# Fly runs UTC; the scheduler converts to IST itself via active_hours_tz, so the container
# clock stays UTC and only one place does timezone arithmetic.
ENV NODE_ENV=production \
    TZ=UTC

WORKDIR /app

# Node ships its own CA bundle, which lacks some government intermediates (MOSPI fails
# with SELF_SIGNED_CERT_IN_CHAIN for exactly this reason). Installing the system roots
# lets NODE_EXTRA_CA_CERTS point at them rather than disabling TLS verification, which
# would make a regulator feed spoofable.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# Unprivileged: the worker parses untrusted HTML from arbitrary publishers all day.
USER node

# tsx directly rather than `npm start` — npm swallows SIGTERM, and Fly needs the signal to
# reach the process so it can finish its current tick instead of being killed mid-insert.
WORKDIR /app/apps/worker
CMD ["../../node_modules/.bin/tsx", "src/index.ts"]
