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

## The overhaul

20. **shadcn and Tailwind were considered and left out.** The operator asked whether shadcn would
    give us a lot for free. It would give real behaviour for menus, dialogs and tooltips, which is
    the part of a component library that is genuinely hard. The cost is that shadcn is Tailwind, and
    this project already has a styling contract: a theme is a file of `--art-*` custom properties
    that must reach compiled React artifacts, raw HTML artifacts and sandboxed frames, none of which
    can run our build. Adding Tailwind would mean either two systems styling the same page or
    rewriting the theme contract as a Tailwind preset, and the artifacts we publish still could not
    use it. What we took from shadcn is its actual value, which is the Radix behaviour underneath,
    and only where it was missing: focus rings from one token, keyboard dismissal, reduced-motion
    honoured. If we ever need a combobox or a date picker, the decision is worth reopening for the
    app shell alone, never for the artifact surface.

21. **TipTap replaced the editing complaint rather than the editor.** The operator's complaint was
    that editing felt heavy: open the whole document, scroll to the paragraph, find the line. The
    fix for that is editing one block where it sits, which is now a pencil in the margin and a text
    area over the block, posting the block's own line range to `PUT /api/artifacts/:slug/lines`. A
    TipTap WYSIWYG layer would be a second source of truth for a document whose source is markdown
    an agent has to read back, and round-tripping our directive blocks through a rich-text schema is
    where that goes wrong. It is worth revisiting once the block editor has been lived with; the
    collaboration half of the TipTap ecosystem is what we adopted instead.

22. **Live typing is Yjs and Hocuspocus, not a diff feed.** `artifacts_type` needed to show an agent
    writing, which means the document must tolerate two writers at once and survive a browser that
    is halfway through a sentence. A CRDT does that; a "replace the source" endpoint does not. The
    document is a working copy, not the record: versions stay immutable rows, and the collaboration
    server asks the app to snapshot one once typing has been quiet for two and a half seconds, and
    only if the text changed.

23. **Both processes live in one container.** The collaboration server has to call the app to write
    a version, and the app has to reach the collaboration server for `artifacts_type`. Under rootless
    podman here, container-to-container DNS did not resolve and `host.containers.internal` timed out.
    Rather than fight the network, `start.mjs` supervises both processes in the same container and
    they talk over loopback. If either dies the container dies, which is the behaviour we want.

24. **The viewer follows the document over server-sent events.** Polling from the browser would have
    been simpler, but a page left open on the Mac is the main way the operator watches an agent work,
    and a poll interval slow enough to be cheap is slow enough to feel broken. The stream carries a
    fingerprint of the version number, the comment count and the newest comment timestamp, computed
    from two indexed reads. Nothing is pushed through it, so a dropped connection cannot wedge a
    subscriber. It does mean the network is never idle, which is why the screenshot harness waits on
    `load` rather than `networkidle`.

25. **A screenshot harness, because the box is headless.** Every visual claim until then rested on
    reading HTML out of curl. Playwright runs in a container against a recipe of URLs, each with a
    width, a scheme and steps to perform first, and writes PNGs plus a report of console errors. It
    found three things curl could not see: compiled artifacts rendering blank, a page that had
    stopped hydrating entirely, and pins landing on the wrong line.

26. **The page slides left when a comment card opens.** At 1440px a centred 900px column leaves
    270px of margin and a readable card needs 340px, so a card in the margin either covered the text
    or sat off screen. Docs solves this by moving the page, so we do too: the column translates left
    by exactly the shortfall, capped so it never runs off the left edge, and slides back when the
    card closes. The arithmetic runs on offsets rather than rectangles, because a rectangle read
    during the slide's own transition feeds the slide back into itself.

27. **The thread card was rebuilt from feedback left inside the product.** The operator commented
    on the artifact itself: the card did not look modern, and a comment got lost when the text
    around it moved. The card is now one thread with a single shape for every message, the sentence
    it was left on quoted at the top, resolve and close as icons, and a reply field that is always
    present rather than hidden behind a button. Re-anchoring gives up characters from whichever end
    of the stored context changed until the remainder matches again, so a pin holds its place
    through an edit instead of collapsing to the top of its block, and says so by going hollow when
    it had to guess.

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
