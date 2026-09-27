---
name: storybook
description: Use when a page should show a project's real UI (screens, components, states, design options for the operator to pick from) and the project has a Storybook, a .storybook folder. Covers uploading the built Storybook to Indy and showing its stories with story blocks, so nothing is rebuilt or copied by hand.
---

# Showing a project's Storybook in Indy

Indy can show stories from a project's own Storybook on a page, drawn by the compiled
components themselves. It is the right way to put real UI in front of the operator: a
design review, the states of a screen, a before and after, or a form asking which option to
ship. Do not rebuild a screen in HTML or React when a story for it exists or can be written.

Indy usually runs on another machine, so it cannot read the project. You build the
Storybook and upload the build; pages then point at stories by id.

## Upload the build

1. Build it. Use the project's script if it has one (`npm run build-storybook`), otherwise
   `npx storybook build --preview-only`. `--preview-only` leaves out Storybook's own
   browsing UI, which pages do not use, and makes the upload several times smaller. Note
   the output folder (`storybook-static` unless `-o` says otherwise).
2. Call `artifact_storybook_upload` with `storybook` set to the project name (the same
   name as the pages' `project:`), and `dir` if the folder is not `storybook-static`.
3. Run the command it returns, from the folder that holds the build. It works once, for
   half an hour; ask for a new one if it expires or the upload fails.
4. Read the reply. It gives the number of stories stored and anything Indy had to adjust.

Upload again whenever the components change. It takes seconds: files that did not change
are not stored twice.

The first time, set how the stories follow Indy's light and dark schemes. Read
`.storybook/preview` for the global that picks the theme (often `theme`, or a
`backgrounds` value) and pass `light` and `dark` to the upload or to
`artifact_storybook_set`, e.g. `light: { "theme": "day" }, dark: { "theme": "night" }`.
If stories load images from a remote host (a CDN, TMDB, a placeholder service), pass it in
`hosts` as an https origin, or those images stay blank.

## Find the stories

`artifact_stories` with the `storybook` name and a `query` lists ids, titles and names. The
id is also the `id=` or `path=/story/` part of a Storybook address in the browser, and
`index.json` in the build folder has every one. Pick stories that already show the state
you need.

## Put them on a page

````md
```story
id: screens-friends--requests
width: 402
height: 874
```
````

- For a component, the id alone is enough: the frame takes the story's height.
- For a full screen, set `width` and `height` to the size the project designs at (look
  for viewport settings in `.storybook/preview`). A wide story is scaled down to fit the
  column, so phone and desktop screens both work.
- `args` changes a story's props, e.g. `args: { label: Save, disabled: true }`. Values must
  be simple: letters, digits, spaces, `_`, `-`, numbers, colours, true/false and null.
- `:::columns` puts screens side by side; `:::choice` with a story in each `:::option`
  asks the operator to pick one. Both stack on a phone unless you add `compact`, which
  keeps them two across. Use it for three or more screens, so the reader can compare
  them without scrolling past each one. Add `columns=2` as well, so a wide screen shows
  two per row: four screens in one row are too small to judge.
  `:::choice{name=pick columns=2 compact}`.

The full key list is in `indy://reference` under `story`.

## When a state has no story

Write the story in the repo next to the component, the way the project writes its other
stories, then rebuild, upload and publish. The story stays useful after the review, and
the page still has no copied code. Do not add a story just to set an arg the URL can
carry.

## Keep in mind

- A page version keeps the build it was published with. To show new components on an
  existing page, upload, then `artifact_update` the page (even with the same source).
- Publishing warns about a story id that is not in the build and suggests close ones.
  Fix those before sending the link.
- Anyone who can open a page with a story can load that build's files, including stories
  not on the page. Mention it before the operator shares a page from a private project.
