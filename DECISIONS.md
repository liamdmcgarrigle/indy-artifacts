# Implementation decisions

Judgment calls made while building, for the operator to review. Each says what the spec or plan
implied, what was done instead, and why.

| # | Topic | Decision |
|---|---|---|
| 1 | Primitives library | The spec named Lit for the `<art-*>` custom elements. Built them as plain `HTMLElement` subclasses in light DOM instead. Light DOM is required anyway so theme CSS cascades in, which removes Lit's main benefit, and it drops a runtime dependency from every sandbox frame. |
| 2 | `:::html` directive | Dropped. A container directive's body is parsed as markdown, so raw HTML inside it never survives to the renderer. The ```` ```html ```` fence is the documented escape hatch and does the same job. |
| 3 | Rendered HTML storage | The spec was ambiguous about caching. Versions store source only and render on read behind an in-process LRU cache keyed by content hash. Pipeline and theme fixes then apply to old artifacts, and no schema column is needed for derived HTML. |
| 4 | TypeScript version | Pinned 5.9.3 rather than the 7.0.2 that npm tags latest. TypeScript 7 is the new native compiler and Next.js 16.3.5 does not list it as supported. |
