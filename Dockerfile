# syntax=docker/dockerfile:1
#
# Indy, as one image with one port.
#
#   deps      npm ci against the lockfile
#   build     the <art-*> primitives, vendored mermaid, next build (standalone)
#   extras    the packages a compiled artifact may import, from docker/extras
#   collab    the document server and its dependencies, from the root lockfile
#   runtime   the app, the document server and the proxy that fronts them both
#
# The extras stage exists because Next's output tracing keeps only the files the
# server itself imports. An artifact's bundle needs whole packages: react-dom's
# traced copy has no client.js, and chart.js, d3 and lucide-react are not traced
# at all. esbuild resolves them at publish time from INDY_BUILD_MODULES. Tailwind
# is there too, with its native scanner, for artifacts that import tailwindcss.
#
# /artifact-kit holds the shadcn components artifacts import as "@/components/ui".
# It sits away from /app so that nothing under it can find the app's own copy
# of React: an artifact must bundle exactly one.

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
# Pinned with a lockfile; the versions match app/package.json, which
# app/test/deploy.test.ts checks.
COPY docker/extras/package.json docker/extras/package-lock.json ./
RUN npm ci --no-audit --no-fund --omit=dev

FROM node:24-bookworm-slim AS collab
WORKDIR /src
# The document server's dependencies, from the root lockfile like everything
# else, then gathered into one folder beside its server.
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY collab/package.json collab/package.json
COPY packages/primitives/package.json packages/primitives/package.json
RUN npm ci --omit=dev --workspace collab --include-workspace-root=false --no-audit --no-fund \
 && rm -f node_modules/collab \
 && mkdir -p /collab/node_modules \
 && cp -a node_modules/. /collab/node_modules/ \
 && if [ -d collab/node_modules ]; then cp -a collab/node_modules/. /collab/node_modules/; fi \
 && cp collab/package.json /collab/
COPY collab/server.mjs /collab/

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
    INDY_BUILD_MODULES=/artifact-modules/node_modules:/app/node_modules \
    INDY_ARTIFACT_KIT=/artifact-kit \
    INDY_APP_ENTRY=/app/app/server.js \
    INDY_COLLAB_ENTRY=/app/collab/server.mjs

WORKDIR /app
# The standalone output mirrors the repo, so the server is at app/server.js.
COPY --from=build /src/app/.next/standalone ./
COPY --from=build /src/app/.next/static ./app/.next/static
COPY --from=build /src/app/public ./app/public
COPY --from=build /src/themes ./themes
COPY --from=extras /extras/node_modules /artifact-modules/node_modules
COPY --from=build /src/app/src/components/ui /artifact-kit/components/ui
COPY --from=build /src/app/src/lib/utils.ts /artifact-kit/lib/utils.ts
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
