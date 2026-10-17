# stub docs

The data flow of stub, as a diagram-heavy Starlight site. Same stack as fkn.dev: Astro, Starlight,
`astro-mermaid`.

```sh
npm install
npm run dev          # localhost:4321
npm run build
npm run check        # build, check every diagram in a real browser, then every citation
npm run check-citations  # every src/, tests/ and scripts/ citation points inside its file
```

## The diagram check is not optional

`astro-mermaid` rewrites a ```` ```mermaid ```` fence into a holder at BUILD time and mermaid draws into
it in the BROWSER. So a diagram with a syntax error builds perfectly and renders as an empty box for
every reader. `npm run check` serves the build, loads all 59 pages in both themes, and asserts:

- the number of holders on a page equals the number of fences in its source
- every holder drew a real `<svg>`, and not mermaid's own syntax-error graphic
- no page scrolls horizontally
- no figure runs under the sidebar or the table-of-contents rail

The last one exists because it was measured wrong twice. A figure that breaks out of the text column
by a fixed amount is centred, does not overflow the viewport, and does not make the body scroll, and
still runs 72px under the TOC at 1280 and 120px at 1920. A check watching only overflow and body
scroll calls that a pass. The breakout is now bounded by `--sl-content-pad-x`, which is the whole of
the honest budget, and a diagram wider than the pane scrolls inside its own figure.

The preview server must be running for `check-diagrams` (`npm run preview -- --port 4321`), and it
resolves `playwright` by walking up to the stub repo's `node_modules`.

## Writing a page

Conventions live at `/start/reading-the-diagrams`. The short version: every diagram is a mermaid
fence, every decision node carries the VERBATIM condition under its question, edge labels say what the
branch is rather than yes or no, anything touching `graph.link` or `graph.set` carries an
irreversibility aside, and code comments are quoted as blockquotes with their file:line. The code is
the authority: where it disagrees with a page, the page is what changes.
