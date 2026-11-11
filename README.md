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
- **Gujarati relationship names.** The language button in the top bar (or `L`) names relationships in English, in ગુજરાતી, or in Gujarati written in English letters. Gujarati tells apart what English lumps together - મોટા બાપુ / કાકા (father's elder / younger brother), ફોઈ / ફુઆ, મામા / મામી, માસી / માસા, જેઠ / દિયર, જેઠાણી / દેરાણી, નણંદ / નણદોઈ, સાળો / સાળી / સાળાવેલી / સાઢુભાઈ, ભત્રીજો / ભાણેજ, પૌત્ર / દોહિત્ર, વેવાઈ / વેવાણ - and anyone without a word of their own is named through the chain ("કાકાનો દીકરો", "પતિના મામા"). Elder and younger come from birth dates; without them the general word is used. The details panel shows the other spelling and the English meaning ("Kaka · Father's younger brother"), and search finds people by any of the three.
- Selecting someone highlights their direct line - ancestors and descendants - and, more strongly, the chain of people connecting them to you. The same chain is listed under their name in the side panel.
- **Shift+click** a second card to see how those two people are related to each other.
- **Sides of the family.** Kindred splits the tree into your close family, your father's side, your mother's side and each family that married in (your wife's parents and siblings, your brother's wife's family…), and tints every card with its side's colour. **Sides** (bottom left) lists them: rest on one to light it up, click it to show only that side plus the people linking it to you. Families that married into an aunt or cousin are tucked under that side. The details panel says which side someone is on, and **Show only** narrows the tree around them to their direct line (`B`), close family, or every blood relative (`Shift+B`).
- **Connecting lines** say what they join. A couple's line is heavier than the lines down to children, and solid for married, dashed for partners, dotted for divorced; every line takes its side's colour. Rest on (or tap) a line to light up the people it joins and see who they are to you - "George, maternal grandfather & Ruth, maternal grandmother · married · 1 child", or a set of siblings with each one's relationship.
- **Zoomed out**, cards switch to large type showing just the relationship and first name ("Father · Robert", "Wife · Maya") on their side's colour, so a big tree stays readable without zooming in.
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
| `src/lib/kinship.ts` | Relationship naming relative to the home person (English) |
| `src/lib/gujarati.ts` | Gujarati relationship names, from the chain of links between two people |
| `src/lib/naming.ts` | Picks English or Gujarati labels for the rest of the app |
| `src/lib/sides.ts` | Sides of the family (close family, each parent's side, families that married in) |
| `src/lib/branches.ts` | Which part of the tree is drawn: focus (line, close family, family, side) and folded branches |
| `src/lib/treeStore.ts` | Saving and loading the tree in IndexedDB (with the one-off move from localStorage) |
| `src/lib/gedcom.ts` | GEDCOM 5.5.1 export and import |
| `src/lib/timeline.ts` | Lifetimes on the time axis: guessed ends, row order, overlaps, axis ticks |
| `src/lib/insights.ts` | Upcoming birthdays/anniversaries and data-consistency checks |
| `src/store.ts` | App state, undo history, autosave |
| `src/components/` | Canvas (pan/zoom), timeline, cards, details panel, dialogs, top bar |
