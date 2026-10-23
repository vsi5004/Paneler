# Multi-stage Next.js 16 standalone build for paneler.app/app.
# Based on the canonical Next.js Docker template + the /deploy skill's
# dockerfile-nextjs.md reference.

# Node 22, not 20: the 2026-10-21 security release (Brotli decoder OOB write,
# CVE-2026-111497, plus nine others) shipped fixes for 22.x/24.x/26.x only.
# Node 20 is end-of-life and no patched 20.x exists. The minor floats on
# purpose, so the next Node security release arrives on the next build.
# Every stage below derives from this, runner included - which is the stage
# that actually matters, being the long-lived process taking requests.
FROM node:22-alpine AS base

# -----------------------------------------------------------------------------
# Dependencies layer — cached unless package*.json changes.
# -----------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# -----------------------------------------------------------------------------
# Builder — produces .next/standalone (Node server entry) + static assets.
# -----------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Default build mode: standalone Node.js server. STATIC_EXPORT is only used
# for the GH Pages workflow which doesn't build this Dockerfile.
RUN npm run build

# -----------------------------------------------------------------------------
# Runner — minimal image, runs as non-root.
# -----------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Bind to all interfaces — Next 13+ standalone defaults to localhost which
# isn't reachable from outside the container.
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
