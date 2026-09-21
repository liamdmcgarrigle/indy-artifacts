# Implementation decisions

Judgment calls made while building, for review. Each says what the spec or plan implied, what was
done instead, and why.

## Design

1. **Primitives are plain custom elements, not Lit.** The spec named Lit. They must render in light
   DOM so theme CSS cascades into them, which removes Lit's main benefit, and dropping it removes a
   runtime dependency from every sandbox frame.

2. **The `:::html` directive was dropped; the ```html fence is the only raw-HTML escape hatch.** A
   container directive's body is parsed as markdown, so raw HTML inside one never survives to the
   renderer. The fence does the same job and already goes to a sandbox frame.

3. **Versions store source only and render on read,** behind an in-process cache keyed on content
   hash plus asset base. Pipeline and theme fixes then apply to old artifacts, and no schema column
   holds derived HTML.

4. **chart.js is bundled into the primitives file rather than left external.** The file is served
   raw to the browser and to sandbox frames, which have no import map, so a bare `chart.js/auto`
   specifier would not resolve and charts would fail silently. The bundle is 214 KB minified.

5. **Compiled artifacts build in-process with a timeout race, not in a child process.** The plan
   called for a child process for kill-ability. esbuild never executes artifact code, it only parses
   and transforms, so the runaway case the child process guarded against does not arise, and an
   in-process build removes a file that the standalone container build would have had to carry.

6. **The SQL schema is a TypeScript string, not a `.sql` file read at runtime.** Next's standalone
   output traces imports, not sibling data files, so a `.sql` file could ship missing.

7. **TypeScript pinned to 5.9.3,** not the 7.0.2 that npm tags latest. TypeScript 7 is the new native
   compiler and Next.js 16.3.5 does not list it as supported.

8. **Notifications to an agent are always a single line.** `orca terminal send --enter` replays every
   newline as a submission, so a multi-line message arrives as several separate prompts, and in a
   plain shell each line runs as its own command. Verified against a scratch terminal. Detail beyond
   one line is fetched by the agent with `artifacts_comments`.

## Deployment

9. **`userns_mode: keep-id` in compose.** Under rootless podman the container's uid 1000 otherwise
   maps to a subuid that cannot write the bind-mounted `./data`, and the server fails to open its
   database. keep-id maps the host user to the same uid inside.

10. **A separate `extras` image stage installs react, react-dom, svelte, chart.js, d3 and
    lucide-react in full.** Next's output tracing keeps only the files the server imports, so the
    traced `react-dom` has no `client.js` and every compiled artifact failed to build. esbuild
    resolves artifact imports from `ARTIFACTS_BUILD_MODULES`, which lists the extras directory first
    and the traced one second.

11. **The build scratch directory is configurable (`ARTIFACTS_TMP`, set to `/data/tmp`).** The host's
    `/tmp` is mounted read-only into the container so artifacts can reference assets by host path,
    which shadows the container's own writable `/tmp`.

12. **The events feed is the one snake_case surface.** The host poller is Python written against a
    snake_case contract; everything else on the wire follows the TypeScript service types. The
    mapping lives in the events route, with a contract test.

13. **The mermaid bundle is 5.2 MB.** It is vendored whole rather than tree-shaken by diagram type.
    It loads only inside frames that contain a mermaid block, from local disk, and the browser
    caches it across frames.

## Bugs found and fixed during end-to-end testing

14. **A failed first publish left an artifact row with no versions,** holding its slug forever.
    `publishArtifact` now deletes the row if the first version does not land. Regression test added.

15. **A build-scratch failure escaped the build service** instead of being reported as a build error,
    because the temp directory was created before the try block.

16. **Svelte artifacts link no stylesheet.** Svelte injects its CSS into the bundle, so the embed
    route now checks whether `bundle.css` exists rather than linking it unconditionally and 404ing.

17. **picaflick's light scheme had `--art-link: #5A9AE6`,** a low-contrast blue on white. Changed to
    the darker `#2A71CE`; the dark scheme keeps the lighter value.

## Changes after the first review

18. **The comments sidebar was replaced by cards attached to the pin.** The operator asked for the
    Figma behaviour: no panel taking a third of the window, the composer and the thread opening at
    the spot being discussed. The card opens to the right of its pin and flips left when the window
    has no room. Below 760px it becomes a sheet at the bottom of the window. The list is still
    reachable from the Threads button in the header, which is also the only way to reach a thread
    whose anchor no longer resolves, and Send moved into the header next to it.

19. **Pins were measured against the wrong element.** Positions were computed from `.stage` while
    the overlay sits inside `.stage__inner`, so every pin was off by the stage padding plus the
    centring margin, which grew with the window. The overlay's own box is now the origin. The
    geometry moved into `lib/anchors.ts` as `spotFor`, with tests for the flip and the clamp.

## Known limits

- No authentication. Anyone who can reach the port can publish, comment and edit. The port is only
  open to the tailnet, which is the whole access control today.
- Delivery needs the agent's terminal to still exist. The session id is stored for a future
  `claude -p --resume` path but nothing uses it yet.
- Comment anchors inside compiled and raw-HTML artifacts resolve to the frame, not to a position
  within it, because the parent cannot read into an opaque-origin frame. The frame reports the
  clicked element's selector and text, which is what the agent gets.
- `esbuild` install scripts are skipped by npm 11's default gating. The arm64 binary arrives through
  the `@esbuild/linux-arm64` optional dependency instead, which was verified to work.
