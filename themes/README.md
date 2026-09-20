# Themes

A theme is one CSS file. It defines the token contract twice: once on `:root` for the light
scheme, once on `:root[data-scheme="dark"]` for dark. Nothing else belongs in it. No selectors for
`art-*` elements, no `@font-face`, no `@media (prefers-color-scheme)`. The shell stamps
`data-scheme` on `<html>`, so a media query would only fight it.

Each block also sets `color-scheme: light` or `color-scheme: dark`, which is what makes form
controls, scrollbars and the canvas behind the page follow the theme.

`packages/primitives/src/primitives.css` reads these tokens and no others, so swapping a theme is a
one-file change. A missing token leaves the rule that wanted it unresolved, so define all of them
in both blocks even where the two values are the same.

Font families are named but never loaded. A reader who has `"Nunito Sans"` or `"Manrope"` installed
gets them; everyone else gets the system stack. Artifact pages download no webfonts.

## The contract

| Group | Tokens |
|---|---|
| Surfaces | `--art-bg` `--art-surface` `--art-surface-2` |
| Lines | `--art-border` `--art-border-strong` |
| Text | `--art-text` `--art-text-muted` `--art-text-faint` |
| Accent | `--art-accent` `--art-accent-hover` `--art-accent-wash` `--art-on-accent` `--art-link` |
| Semantic | `--art-good` `--art-good-wash` `--art-warn` `--art-warn-wash` `--art-bad` `--art-bad-wash` `--art-info` `--art-info-wash` |
| Type | `--art-font-sans` `--art-font-mono` `--art-font-size` |
| Shape | `--art-radius` `--art-radius-lg` `--art-shadow` |
| Charts | `--art-chart-1` … `--art-chart-6` |

`--art-chart-1` through `--art-chart-6` are read from the computed style when a chart is
constructed, so a series picks up whichever theme it was drawn under.

## Adding one

Copy `default.css`, rename it, change the values, and add the name to `THEMES` in
`app/src/lib/pipeline/types.ts` so frontmatter can select it. `app/test/themes.test.ts` checks
every file in this directory for the full contract in both blocks.
