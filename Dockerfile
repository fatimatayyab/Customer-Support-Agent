# Production image for the API (apps/api) — the only app being containerized
# so far; the dashboard and widget aren't Dockerized yet.
#
# This is a pnpm-workspace monorepo: apps/api depends on packages/db and
# packages/shared via "workspace:*", and those two packages ship raw
# TypeScript with no build step of their own. Production already runs
# apps/api's own source directly through tsx ("start": "tsx src/server.ts"),
# not a compiled dist/server.js — see docs/08_Production_Architecture.md,
# item 1, for why. This image does exactly the same thing: install the
# whole workspace, then run the API's existing, unmodified start script.

FROM node:20-slim

WORKDIR /app

# Pin the exact pnpm version this repo already commits to
# (package.json's "packageManager" field), via Corepack (ships with Node 20).
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Full monorepo copy — node_modules, secrets, and other apps' build output
# are excluded via .dockerignore. pnpm needs every workspace member present
# to resolve pnpm-lock.yaml correctly, not just apps/api's own package.json.
COPY . .

# Installs every workspace's dependencies, including devDependencies (no
# --prod) — apps/api's own "start" script depends on tsx, which is listed
# as a normal dependency, but this keeps the image correct-by-default
# rather than depending on that staying true. Simplicity over a smaller
# image, for this first version.
RUN pnpm install --frozen-lockfile

# Activates behavior the app already has (see app.ts, session-token.ts,
# platform-session-token.ts): structured JSON logs instead of pino-pretty,
# and the Secure flag on session cookies. Not new behavior — it's the
# app's existing production-mode switch, now actually reachable.
ENV NODE_ENV=production

# Matches env.ts's own API_PORT default, so the app's behavior here is
# identical to running it anywhere else — nothing in this file is
# Render-specific.
EXPOSE 4000

WORKDIR /app/apps/api

# Runs tsx directly as the container's PID 1, rather than through
# `pnpm --filter @csa/api start` (the same command, just invoked via pnpm's
# wrapper) — verified live that pnpm's filter/recursive runner does not
# forward SIGTERM to the underlying tsx/node process cleanly: `docker stop`
# reported "Command failed with signal SIGTERM" instead of letting
# server.ts's own graceful-shutdown handler (SIGTERM -> app.close()) run at
# all. This is a Dockerfile-only change — apps/api/package.json's "start"
# script (used by `pnpm dev`/CI/local runs) is untouched, and this runs the
# exact same tsx src/server.ts underneath.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
