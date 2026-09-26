# syntax=docker/dockerfile:1
#
# Indy, as one image with one port.
#
#   deps      npm ci against the lockfile
#   build     the <art-*> primitives, vendored mermaid, next build (standalone)
#   extras    the packages a compiled artifact may import, installed on their own
#   collab    the document server and its two dependencies
#   runtime   the app, the document server and the proxy that fronts them both
#
# The extras stage exists because Next's output tracing keeps only the files the
# server itself imports. An artifact's bundle needs whole packages: react-dom's
# traced copy has no client.js, and chart.js, d3 and lucide-react are not traced
# at all. esbuild resolves them at publish time from INDY_BUILD_MODULES.

FROM node:24-bookworm-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY collab/package.json collab/package.json
COPY packages/primitives/package.json packages/primitives/package.json
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build:primitives \
 && cd app \
 && node scripts/build-vendor.mjs \
 && npx next build

FROM node:24-bookworm-slim AS extras
WORKDIR /extras
RUN npm init -y > /dev/null \
 && npm install --no-audit --no-fund --omit=dev \
      react@19.3.0 react-dom@19.3.0 svelte@5.57.1 \
      chart.js@4.5.1 d3@7.9.0 lucide-react@1.47.0

FROM node:24-bookworm-slim AS collab
WORKDIR /collab
COPY collab/package.json ./
RUN npm install --no-audit --no-fund --omit=dev
COPY collab/server.mjs ./

FROM node:24-bookworm-slim AS runtime
# The source label links the image on ghcr.io to its repository, which is
# where the package page, its README and its visibility come from.
LABEL org.opencontainers.image.source="https://github.com/liamdmcgarrigle/indy-artifacts" \
      org.opencontainers.image.title="Indy" \
      org.opencontainers.image.description="A self-hosted place for coding agents to publish pages you read, edit, comment on and share." \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=1936 \
    INDY_DATA=/data \
    INDY_TMP=/data/tmp \
    INDY_THEMES=/app/themes \
    INDY_BUILD_MODULES=/artifact-modules:/app/node_modules \
    INDY_APP_ENTRY=/app/app/server.js \
    INDY_COLLAB_ENTRY=/app/collab/server.mjs

WORKDIR /app
# The standalone output mirrors the repo, so the server is at app/server.js.
COPY --from=build /src/app/.next/standalone ./
COPY --from=build /src/app/.next/static ./app/.next/static
COPY --from=build /src/app/public ./app/public
COPY --from=build /src/themes ./themes
COPY --from=extras /extras/node_modules /artifact-modules
COPY --from=collab /collab ./collab
COPY start.mjs proxy.mjs ./

# The node image's own user (uid 1000) owns the data folder. A named volume
# picks that ownership up on first use.
RUN mkdir -p /data/tmp && chown -R node:node /data

USER node
VOLUME /data
EXPOSE 1936

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1936)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "/app/start.mjs"]
