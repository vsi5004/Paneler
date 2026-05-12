# Multi-stage Next.js 16 standalone build for paneler.app/app.
# Based on the canonical Next.js Docker template + the /deploy skill's
# dockerfile-nextjs.md reference.

FROM node:20-alpine AS base

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
