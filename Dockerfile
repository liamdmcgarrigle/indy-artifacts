# syntax=docker/dockerfile:1
#
# Artifacts server. Four stages:
#   deps        npm ci against the lockfile only
#   build       primitives bundle, vendored mermaid, next build (standalone)
#   extras      the packages a compiled artifact may import, installed on their own
#   runtime     standalone server plus themes, vendor assets and those extras
#
# The extras stage exists because Next's output tracing keeps only the files the
# server itself imports. An artifact's bundle needs whole packages: react-dom's
# traced copy has no client.js, and chart.js, d3 and lucide-react are not traced
# at all. esbuild resolves these at publish time, from ARTIFACTS_BUILD_MODULES.

FROM node:24-bookworm-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY packages/primitives/package.json packages/primitives/package.json
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /src
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

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=5174 \
    ARTIFACTS_DATA=/data \
    ARTIFACTS_THEMES=/themes \
    ARTIFACTS_BUILD_MODULES=/artifact-modules:/app/node_modules \
    ARTIFACTS_TMP=/data/tmp

WORKDIR /app
COPY --from=build /src/app/.next/standalone ./
COPY --from=build /src/app/.next/static ./app/.next/static
COPY --from=build /src/app/public ./app/public
COPY --from=build /src/themes /themes
COPY --from=extras /extras/node_modules /artifact-modules

RUN mkdir -p /data && chown -R 1000:1000 /data /app

USER 1000:1000
EXPOSE 5174
CMD ["node", "app/server.js"]
