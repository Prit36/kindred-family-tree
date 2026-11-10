# Kindred — family tree

A personal family tree visualiser. Everything is stored in your browser (localStorage); there is no server or account.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` produces a static site in `dist/` that can be hosted anywhere.

## Using it

- **Add yourself**, then select any card and use the **+** bubbles (up = parent, down = child, left = sibling, right = partner) or the buttons in the side panel.
- Relationship labels (Father, Sister-in-law, Cousin once removed…) are worked out relative to the "home" person. Use **This is me** on anyone to change it.
- Selecting someone highlights their direct line — ancestors and descendants.
- Drag to pan, scroll to zoom, `/` to search, `Ctrl+Z` / `Ctrl+Shift+Z` to undo and redo.
- The **⋯** menu exports a PNG image or a JSON backup, and imports a backup.

Your tree lives only in the browser you created it in, so export a backup now and then.

## Code map

| Path | What it does |
| --- | --- |
| `src/lib/tree.ts` | Data model operations (add/link/unlink/delete, validation of imported files) |
| `src/lib/layout.ts` | Generational layout: partner grouping, ordering, positioning, connector paths |
| `src/lib/kinship.ts` | Relationship naming relative to the home person |
| `src/store.ts` | App state, undo history, autosave |
| `src/components/` | Canvas (pan/zoom), cards, details panel, dialogs, top bar |
