---
name: multipage
description: Use when a result is too big for one Indy page, or has parts people read on their own, such as a course with modules and lessons, a handbook or docs, a report with appendices, a design review with one page per option, or a research dossier. Covers when to split into subpages, how to plan the tree, publishing it in one call with artifact_publish_tree, and keeping it up to date and collecting feedback across every page.
---

# A tree of pages in Indy

A page can sit under another page. A set of pages then becomes a tree, and Indy draws
the way through it: breadcrumbs, a contents list, previous and next at the foot of each
page, one row in the library, and a share link that opens the whole tree. Every page in
the tree is still a full page, with its own versions, comments, ticks and form answers.

The syntax is in `../publish/reference.md` under "Subpages". This skill is about when
to make a tree and how to keep one in good shape.

## One page or a tree

Keep it on one page when people read it top to bottom in one sitting: a status report,
a plan, a test run, a comparison. Tabs, details boxes and columns already fold a long
page. A tree costs the reader a click per page, so it has to earn that.

Make a tree when:

- the parts get read on their own, and people come back to one part (a lesson, a
  runbook step, one service's results);
- one page would pass about 30 KB of markdown or take more than a few minutes to scroll;
- different parts need their own comments, checklists or forms, or change at different
  times;
- you would otherwise publish several pages and link them together by hand.

Shapes that work:

| Result | Top page | Under it |
|:--|:--|:--|
| Course | Description, outcomes, the course map (`::pages{depth=2}`) | Modules, each with its lessons |
| Report with detail | Summary, the numbers that matter, `::pages` | One page per area, then raw data in a group "Appendix" |
| Handbook or docs | What it covers and who for | Sections, then topics |
| Design review | The question and a recommendation | One page per option, so each gets its own comments |
| Research dossier | Findings | One page per source or theme |

## Plan the tree before you write

- **The top page is a real page.** It says what the tree is and what to read first.
  Put `::pages` where the list of parts belongs; it draws cards from the subpages'
  titles and descriptions and stays current as pages change. Use `::pages{depth=2}` for
  a map of two levels, like a course's modules and their lessons.
- **Give every page a `description`.** It is the line under its card, so write what is on
  the page, not its title again.
- **Title pages so they read alone.** The contents list and the breadcrumbs show titles
  without context. Number them when order matters ("2.3 Test before you publish").
- **Three levels below the top at most**, and usually two. A level with one page in it
  is one too many.
- **Order is the order you list them.** Use `group` for pages that belong apart, such
  as "Appendix" or "For authors"; grouped pages come after the rest. Sending only some of
  a parent's pages again leaves the order alone, and new ones go at the end.
- **Don't write navigation.** No "← Previous · Next →" lines, no hand-built contents
  table, no "Back to the course home" links. Indy draws all of that, and hand-written
  links go stale.
- **Do link in the prose** where a sentence points at another page: write
  `[the database pool](/a/load-test-oct-9-db)`. Someone reading through a share link is
  taken to that page under their link when it covers it, and told it is not shared when it
  does not.

## Publish it

Send the whole tree in one call with `artifact_publish_tree`:

```
artifact_publish_tree
  project: "intro-to-agents"
  branch:  "main"
  agent:   { name: "claude", terminal: "$ORCA_TERMINAL_HANDLE" }
  pages:
    - { slug: "ai2011-home", source: "---\ntitle: Intro to Agents\ndescription: ...\n---\n\n...\n\n::pages{depth=2}\n" }
    - { slug: "ai2011-m1",   parent: "ai2011-home", source: "..." }
    - { slug: "ai2011-m1-1", parent: "ai2011-m1",   source: "..." }
    - { slug: "ai2011-plan", parent: "ai2011-home", group: "For authors", source: "..." }
```

- Pick slugs yourself, short and stable, with a shared prefix (`ai2011-m1-1`). They are
  the URLs and how pages name their parent.
- Everything is checked before anything is written: slugs, parents, depth and sizes. A
  mistake comes back as an error and no page changes.
- Pages whose content has not changed keep their version. So a build script that turns
  files into pages can send the whole tree every time; only what changed gets a new
  version.
- If the operator edited a page on the site, the call stops and names it. Read it with
  `artifact_get`, fold your change into their version, and send it again with that page's
  `expected_version`. Never overwrite their edit.
- The result ends with the tree as an outline. Read the warnings in it as you would after
  a single publish.

For one new page in an existing tree, `artifact_publish` with `parent` is enough. For a
change to one page, `artifact_update` it like any page.

When the source lives in files (a course, docs), write a small script that builds the
`pages` list from them, as `build_indy.py` does for a course, rather than pasting 50 pages
into a call by hand.

## Keep it current and hear about it

- `artifact_tree slug:<any page>` shows the tree as an outline, with versions and which
  pages the operator has not seen. Read it before changing a tree you did not just publish.
- `artifact_comments slug:<top> tree:true` lists open threads on every page, each with the
  page it is on. `artifact_wait slug:<top> tree:true` wakes on feedback anywhere in it.
- The operator can add pages, reorder them and move them from the contents list. Take the
  tree as it is now from `artifact_tree`, not as you first published it.
- Moving a page keeps its URL and its comments. To take a page out of a tree, publish it
  with `parent: null`. Moving a page you already published under a shared page would make
  it public, so Indy refuses it unless the operator lets agents share; ask the operator.
- Sharing the top page shares the whole tree; sharing a page partway down shares that page
  and what is under it. Only share when the operator asks (see the publish skill).

When you tell the operator about a tree, give the top page's link and say in one line how
it is laid out ("6 modules, 39 lessons; the author notes are in a group at the end").
