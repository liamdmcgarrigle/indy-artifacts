# Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted artifact system where agents publish versioned, sandboxed, themed visual reports over MCP, and the operator reviews them with anchored comments that reach the publishing agent.

**Architecture:** One Next.js 16 container serves the viewer shell, the JSON API and an MCP streamable-HTTP endpoint, backed by SQLite (`node:sqlite`). Markdown with directives compiles through a unified pipeline into sanitized HTML plus a block map; React/Svelte artifacts compile with esbuild at publish time; raw HTML and mermaid render in opaque-origin sandboxed iframes. A host-side Python poller turns comment events into `orca terminal send` calls.

**Tech Stack:** Node 24, Next.js 16.3.5, React 19.3, TypeScript 5.9, vitest 5, unified/remark/rehype 11, esbuild 0.28 + esbuild-svelte 0.9.5, Chart.js 4.5, CodeMirror 6, mcp-handler 2.2 + @modelcontextprotocol/server 2, zod 4, podman compose, Python 3 (host).

**Spec:** `docs/superpowers/specs/2026-09-20-artifacts-design.md`

## Global Constraints

- Node 24 only; `node:sqlite` `DatabaseSync` (no better-sqlite3, no native addons beyond esbuild).
- All npm work runs in a worker: `W_CACHE=artifacts W_NET=bridge spawn-worker docker.io/library/node:24-bookworm-slim "<cmd>"`. Never install a toolchain on the host.
- The app listens on port 5174, bound `0.0.0.0`, reachable at `http://agentbox:5174`.
- Agent-authored content NEVER runs script in the trusted shell. Only the sanitizer's output is inserted; everything executable goes in `<iframe sandbox="allow-scripts">` without `allow-same-origin`.
- CSP for embeds: `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts`.
- Theme token names are exactly the `--art-*` contract in spec section 7.4. Primitives may use no other colour source.
- Every module under `app/src/lib/` must be importable by vitest without Next.js.
- Record every judgment call made at a roadblock in `DECISIONS.md` at the repo root.

---

### Task 1: Workspace scaffolding

**Files:**
- Create: `package.json`, `.gitignore`, `.npmrc`, `app/package.json`, `app/tsconfig.json`, `app/next.config.ts`, `app/vitest.config.ts`, `packages/primitives/package.json`, `DECISIONS.md`

**Interfaces:**
- Produces: npm workspaces `app` and `@artifacts/primitives`; scripts `npm test`, `npm run build`, `npm run dev` at the root.

- [ ] **Step 1: Write root package.json with workspaces and pinned versions**
- [ ] **Step 2: Write app/package.json with the dependency set from the plan header**
- [ ] **Step 3: Run `npm install` in a worker; verify lockfile and node_modules**
- [ ] **Step 4: Add a trivial vitest test and run it in a worker to prove the harness works**
- [ ] **Step 5: Commit**

### Task 2: Database layer

**Files:**
- Create: `app/src/lib/db/schema.sql`, `app/src/lib/db/index.ts`, `app/test/db.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): DatabaseSync` applying `schema.sql` idempotently with WAL and foreign keys; `withTx(db, fn)`.

- [ ] **Step 1: Write failing test: openDb creates tables and is idempotent**
- [ ] **Step 2: Write schema.sql from spec section 11 (STRICT tables)**
- [ ] **Step 3: Write index.ts (DatabaseSync, pragmas, exec schema)**
- [ ] **Step 4: Run tests in worker**
- [ ] **Step 5: Commit**

### Task 3: Markdown pipeline

**Files:**
- Create: `app/src/lib/pipeline/index.ts`, `directives.ts`, `blocks.ts`, `sanitize.ts`, `types.ts`
- Test: `app/test/pipeline.test.ts`, fixtures in `app/test/fixtures/`

**Interfaces:**
- Produces: `renderMarkdown(source: string): { frontmatter, html, blocks: Block[], warnings: Warning[] }` where `Block = { id, lines: [number, number], kind }` and `Warning = { line, message }`.
- Every top-level element gets `data-block` and `data-lines`.
- Directives: card, callout, kpis, columns/col, tabs/tab, details, html. Fences: chart, table, mermaid, html.
- Sanitizer allows `art-*` elements and their attributes; strips script, style, event handlers, `javascript:` URLs.

- [ ] **Step 1: Failing test: heading + paragraph gets block ids and line ranges**
- [ ] **Step 2: Failing test: every directive renders its `art-*` element**
- [ ] **Step 3: Failing test: chart fence produces `data-chart` JSON; bad YAML yields a warning with a line number**
- [ ] **Step 4: Failing test: `<script>`, `onclick=`, `javascript:` and `<style>` are stripped**
- [ ] **Step 5: Implement types, directives, blocks, sanitize, index**
- [ ] **Step 6: Run tests in worker until green**
- [ ] **Step 7: Commit**

### Task 4: Primitives package

**Files:**
- Create: `packages/primitives/src/*.ts`, `packages/primitives/src/primitives.css`, `packages/primitives/build.mjs`
- Test: `app/test/primitives.test.ts` (JSDOM upgrade smoke test)

**Interfaces:**
- Produces: `dist/primitives.js` (ESM, defines `art-card`, `art-callout`, `art-kpis`, `art-kpi`, `art-columns`, `art-tabs`, `art-tab`, `art-table`, `art-chart`, `art-details`) and `dist/primitives.css`.
- Light DOM only; all colour from `--art-*` tokens.

- [ ] **Step 1: Failing test: defining elements upgrades markup in JSDOM**
- [ ] **Step 2: Implement elements as plain HTMLElement subclasses**
- [ ] **Step 3: Implement primitives.css using only tokens**
- [ ] **Step 4: Build with esbuild; run tests**
- [ ] **Step 5: Commit**

### Task 5: Themes

**Files:**
- Create: `themes/default.css`, `themes/picaflick.css`, `themes/backup-studio.css`, `themes/README.md`
- Test: `app/test/themes.test.ts`

**Interfaces:**
- Produces: each theme defines the full `--art-*` contract on `:root` and on `[data-scheme="dark"]`.

- [ ] **Step 1: Failing test: every theme defines every token in both schemes**
- [ ] **Step 2: Write the three theme files with the exact values from spec 7.4**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

### Task 6: Service layer

**Files:**
- Create: `app/src/lib/service/artifacts.ts`, `versions.ts`, `comments.ts`, `events.ts`, `assets.ts`, `errors.ts`
- Test: `app/test/service.test.ts`

**Interfaces:**
- Produces: `publishArtifact`, `updateArtifact` (with `expectedVersion` -> `ConflictError`), `getArtifact`, `listArtifacts`, `getVersion`, `diffVersions`, `createComment`, `listComments`, `patchComment`, `sendFeedback`, `listEvents`, `ackEvent`, `copyAssets`.

- [ ] **Step 1: Failing tests for publish/update/conflict/comment/send/events**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

### Task 7: Build service for react/svelte

**Files:**
- Create: `app/src/lib/build/index.ts`, `app/build-worker.mjs`
- Test: `app/test/build.test.ts`

**Interfaces:**
- Produces: `buildArtifact({ kind, files, outDir }): Promise<{ status, log, bytes }>`; allowlisted imports only; 20 s timeout; 5 MB output cap.

- [ ] **Step 1: Failing tests: react fixture builds; svelte fixture builds; `import fs` is rejected**
- [ ] **Step 2: Implement worker and service**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

### Task 8: API routes

**Files:**
- Create: `app/src/app/api/**/route.ts`
- Test: `app/test/api.test.ts`

- [ ] **Step 1: Failing tests calling each handler with Request objects**
- [ ] **Step 2: Implement routes over the service layer**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

### Task 9: MCP endpoint

**Files:**
- Create: `app/src/app/mcp/route.ts`, `app/src/lib/mcp/tools.ts`
- Test: `app/test/mcp.test.ts`

**Interfaces:**
- Produces: nine tools from spec section 9 plus the `artifacts://reference` resource.

- [ ] **Step 1: Failing test: initialize + tools/list returns the nine tools**
- [ ] **Step 2: Failing test: publish then get round-trips**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

### Task 10: Embed (sandbox) routes

**Files:**
- Create: `app/src/app/embed/[slug]/[version]/[block]/route.ts`, `app/src/lib/embed/document.ts`, `app/public/vendor/` (mermaid), `app/public/embed-bridge.js`
- Test: `app/test/embed.test.ts`

**Interfaces:**
- Produces: an HTML document per block with the CSP header and meta, theme + primitives CSS, the height/pick bridge.

- [ ] **Step 1: Failing test: CSP header and meta present; body contains the block payload**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**

### Task 11: Viewer shell

**Files:**
- Create: `app/src/app/layout.tsx`, `page.tsx`, `a/[slug]/page.tsx`, `a/[slug]/v/[n]/page.tsx`, `app/src/components/*`

- [ ] **Step 1: Index page listing artifacts**
- [ ] **Step 2: Artifact page rendering html + mounting primitives + iframes**
- [ ] **Step 3: Version switcher and diff view**
- [ ] **Step 4: Commit**

### Task 12: Comments UI

**Files:**
- Create: `app/src/components/comments/*`, `app/src/lib/anchors.ts`
- Test: `app/test/anchors.test.ts`

**Interfaces:**
- Produces: `resolveAnchor(root, anchor): DOMRect | null`, `anchorFromSelection`, `anchorFromPoint`; pin overlay; sidebar; notify checkbox; send batch.

- [ ] **Step 1: Failing tests for anchor resolution and re-anchoring by quote/context**
- [ ] **Step 2: Implement anchors library**
- [ ] **Step 3: Implement pin overlay, sidebar, composer, comment tool**
- [ ] **Step 4: Commit**

### Task 13: Editor

**Files:**
- Create: `app/src/app/a/[slug]/edit/page.tsx`, `app/src/components/editor/*`

- [ ] **Step 1: CodeMirror 6 markdown editor loading latest source**
- [ ] **Step 2: Save creates a human version; conflict handling**
- [ ] **Step 3: Commit**

### Task 14: Hook poller

**Files:**
- Create: `hook/artifacts-hook.py`, `hook/artifacts-hook.service`, `hook/test_hook.py`, `hook/README.md`

- [ ] **Step 1: Failing python test with a fake API and a fake orca on PATH**
- [ ] **Step 2: Implement poller**
- [ ] **Step 3: Run tests with host python3**
- [ ] **Step 4: Commit**

### Task 15: Plugin packaging

**Files:**
- Create: `plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`, `plugin/.mcp.json`, `plugin/skills/artifacts/SKILL.md`, `plugin/skills/artifacts/reference.md`, `plugin/README.md`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`

- [ ] **Step 1: Write manifests and marketplaces**
- [ ] **Step 2: Write SKILL.md and reference.md**
- [ ] **Step 3: Install into Claude Code on the box and verify the tools appear**
- [ ] **Step 4: Commit**

### Task 16: Container and compose

**Files:**
- Create: `Dockerfile`, `compose.yaml`, `compose.dev.yaml`, `.env.example`, `README.md`

- [ ] **Step 1: Multi-stage Dockerfile, standalone output**
- [ ] **Step 2: compose.yaml with port 5174 and the read-only asset mounts**
- [ ] **Step 3: Build the image and start the stack**
- [ ] **Step 4: Commit**

### Task 17: End-to-end verification

- [ ] **Step 1: Publish a markdown artifact through MCP from a live agent session**
- [ ] **Step 2: Publish react, svelte and html artifacts**
- [ ] **Step 3: Comment, send batch, observe the terminal message**
- [ ] **Step 4: Edit in browser, read back with artifacts_get**
- [ ] **Step 5: Write RESULTS.md and DECISIONS.md; commit**
