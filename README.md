# Kindred - family tree

A personal family tree visualiser. Everything is stored in your browser (IndexedDB); there is no server or account.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` produces a static site in `dist/` that can be hosted anywhere.

## Using it

- **Add yourself**, then select any card and use the **+** bubbles (up = parent, down = child, left = sibling, right = partner) or the buttons in the side panel.
- Relationship labels (Father, Sister-in-law, Cousin once removed…) are worked out relative to the "home" person. Use **This is me** on anyone to change it.
- Selecting someone highlights their direct line - ancestors and descendants - and, more strongly, the chain of people connecting them to you. The same chain is listed under their name in the side panel.
- **Shift+click** a second card to see how those two people are related to each other.
- **Double-click** a card (or press `Enter`) to edit it. Drop a photo onto a card to set their picture; drop a backup file anywhere to import it.
- Search (`/`) matches names, birth surnames, birthplaces, years, notes and relationships - try "aunt" or "1960".
- Drag to pan, scroll to zoom, arrow keys to walk the tree, `H` to jump back to yourself, `F` to fit, `Ctrl+Z` / `Ctrl+Shift+Z` to undo and redo. Press `?` for the full list.
- **Timeline** (top bar, or `T`) lays everyone's lifetime out as a bar on a horizontal time axis, so you can see who was alive at the same time. A dot on a parent's bar, in the child's colour, marks each child's birth; rest on it for who was born and how old the parent was. Click someone to light up the part of every other life that ran alongside theirs, draw lines to their parents and children (labelled with each parent's age at the birth), and open their row to show their life events as labelled chips ("Chloe born 1985", "Arthur died 2010"); click a chip or dot to go to that person. Shift+click a second person to see when the two of them were both alive. Rest the pointer on a bar for a card with that person's dates; hover anywhere to read the year, how many were alive and everyone's age at that moment. Order people oldest first or grouped by family, zoom with the buttons, `+`/`−` or Ctrl+scroll, and walk the rows with `↑`/`↓`. Missing dates fade out (a lifetime of 75 years is assumed), and people with no dates at all are listed underneath.
- The **calendar** button in the top bar lists birthdays and anniversaries coming up in the next 30 days (a dot means one is today), and **Checks** points out likely mistakes: someone dying before they were born, a child born after a parent died, a parent aged 8, a living person aged 130, or the same person entered twice. Warnings you know are fine can be hidden.
- The **⋯** menu exports a PNG image, a JSON backup or a **GEDCOM** (`.ged`) file, and imports either a backup or a GEDCOM file from another program (Ancestry, FamilySearch, MyHeritage, Gramps…). GEDCOM files don't carry photos, so the JSON backup is the one to keep. Details Kindred has no field for yet - occupation, death place, marriage dates, approximate dates like "ABT 1850" - are kept in each person's notes.

Your tree lives only in the browser you created it in, so export a backup now and then. Kindred asks the browser to keep its storage persistent; trees saved by earlier versions in localStorage are moved to IndexedDB automatically on first load.

## Code map

| Path | What it does |
| --- | --- |
| `src/lib/tree.ts` | Data model operations (add/link/unlink/delete, validation of imported files) |
| `src/lib/layout.ts` | Generational layout: partner grouping, ordering, positioning, connector paths |
| `src/lib/kinship.ts` | Relationship naming relative to the home person |
| `src/lib/treeStore.ts` | Saving and loading the tree in IndexedDB (with the one-off move from localStorage) |
| `src/lib/gedcom.ts` | GEDCOM 5.5.1 export and import |
| `src/lib/timeline.ts` | Lifetimes on the time axis: guessed ends, row order, overlaps, axis ticks |
| `src/lib/insights.ts` | Upcoming birthdays/anniversaries and data-consistency checks |
| `src/store.ts` | App state, undo history, autosave |
| `src/components/` | Canvas (pan/zoom), timeline, cards, details panel, dialogs, top bar |
