# Kindred - family tree

A personal family tree visualiser. Everything is stored in your browser (IndexedDB); there is no server or account.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` produces a static site in `dist/` that can be hosted anywhere.

Fonts are committed. Run `python scripts/optimize_fonts.py` manually after content, typography or Fontsource changes; font processing is not part of the build.

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
- **Names written the Gujarati way.** In a tree whose names follow the custom of given name, father's name, surname (a wife: her husband's name), only the given name is kept - the middle name is worked out from the tree, so a daughter's changes to her husband's when she marries. Cards show just the given name; rest on one, or open its details, for the whole name. Trees that wrote the middle name into the first name are tidied when opened; a middle name the tree can't work out (the father isn't in it) is kept in the edit dialog's **Father's name** field.
- Search (`/`) matches names, birth surnames, birthplaces, years, occupation, education, blood group, notes and relationships - try "aunt" or "1960".
- Drag to pan, scroll to zoom, arrow keys to walk the tree, `H` to jump back to yourself, `F` to fit, `Ctrl+Z` / `Ctrl+Shift+Z` to undo and redo. Press `?` for the full list.
- **Timeline** (top bar, or `T`) lays everyone's lifetime out as a bar on a horizontal time axis, so you can see who was alive at the same time. A dot on a parent's bar, in the child's colour, marks each child's birth; rest on it for who was born and how old the parent was. Click someone to light up the part of every other life that ran alongside theirs, draw lines to their parents and children (labelled with each parent's age at the birth), and open their row to show their life events as labelled chips ("Chloe born 1985", "Arthur died 2010"); click a chip or dot to go to that person. Shift+click a second person to see when the two of them were both alive. Rest the pointer on a bar for a card with that person's dates; hover anywhere to read the year, how many were alive and everyone's age at that moment. Order people oldest first or grouped by family, zoom with the buttons, `+`/`−` or Ctrl+scroll, and walk the rows with `↑`/`↓`. Missing dates fade out (a lifetime of 75 years is assumed), and people with no dates at all are listed underneath.
- **Descendants** (top bar, or `D`) draws one person's whole family as a tree: they sit where the trunk meets the canopy, each generation above them is a ring - children, grandchildren (પૌત્ર-પૌત્રી, દોહિત્ર), great-grandchildren - and everyone is a slice as wide as their own family, hanging from branches that thicken towards the trunk. Each of their children's branches has its own colour, listed bottom left with its size; a daughter's family (born to another surname) is hatched, and **Sons' line** shows only the line carried on by sons, as a vanshavali does. Slices show the name and, close in, who they are to you (કાકા, ફોઈ…); zoom in and smaller names appear. Rest on someone to light their line down to the trunk and their family above them, with a card saying what they are to the person at the foot ("દોહિત્રની દીકરી · Daughter's son's daughter"), their spouse and how many descend from them; click to open their details. Pick whose tree it is from the name at the top left (the largest families are suggested), double-click someone (or press `C`) to make them the trunk, or click a parent under the ground to go a generation back. Opening it with someone selected shows their family; otherwise it starts at the head of your father's line. Those who have died are written સ્વ. in Gujarati. **Save as image** in the ⋯ menu saves the tree with a title, ready to print.
- **Cards** (top bar, or `K`) deals everyone out as a collectible card: their photo or initials, age, what they are to you, the year they were born, how many children and descendants they have, and what they do. The biggest families and longest lives make **Rare** and **Legendary** cards, framed in colour or turning gold, and every card tilts and catches the light as the pointer moves over it. The deck's rarest cards are held up in a fan at the top; pick **Close family**, **Your family** or **Everyone**, and order them by generation, eldest first or biggest family - the cards glide to their new places. Click a card to bring it into the spotlight, where it turns over (`Space`) to show their life line with each child's birth on it, their parents, partner, children, brothers and sisters, how many generations follow them, and their next birthday; click a name there to go to that person's card, or walk the deck with `←` `→`.
- **Who's who?** (in Cards) is a game with your own relatives: a card is dealt and turned over with its relationship hidden, and you say what they are to you from four choices - in English, ગુજરાતી or Gujarati in English letters, whichever is on, and switching mid-round. Rounds of ten start with close family and reach further out; get one right and the card is stamped **Known** (with confetti, and a streak that doubles and triples the points), get it wrong and the card shakes and the chain from you to them is laid out. Known cards keep their stamp in the collection, and the best streak is remembered.
- The **calendar** button in the top bar lists birthdays and anniversaries coming up in the next 30 days (a dot means one is today), and **Checks** points out likely mistakes: someone dying before they were born, a child born after a parent died, a parent aged 8, a living person aged 130, or the same person entered twice. Warnings you know are fine can be hidden.
- The **⋯** menu exports a PNG image, a JSON backup or a **GEDCOM** (`.ged`) file, and imports either a backup or a GEDCOM file from another program (Ancestry, FamilySearch, MyHeritage, Gramps…). GEDCOM files don't carry photos, so the JSON backup is the one to keep. Occupation and education come in as fields of their own; details Kindred has no field for yet - death place, marriage dates, approximate dates like "ABT 1850" - are kept in each person's notes.

Your tree lives only in the browser you created it in, so export a backup now and then. Kindred asks the browser to keep its storage persistent; trees saved by earlier versions in localStorage are moved to IndexedDB automatically on first load.

## Code map

| Path | What it does |
| --- | --- |
| `src/lib/tree.ts` | Data model operations (add/link/unlink/delete, validation of imported files) |
| `src/lib/layout.ts` | Generational layout: partner grouping, generations, ordering (fewest crossings), positioning, connector paths |
| `src/lib/shape.ts` | A token for the tree's structure, so caches survive edits that don't move anyone (notes, photos, names) |
| `src/lib/lineHover.ts` | The hovered or pinned family line, kept outside React so hovering doesn't redraw the canvas |
| `src/lib/kinship.ts` | Relationship naming relative to the home person (English) |
| `src/lib/gujarati.ts` | Gujarati relationship names, from the chain of links between two people |
| `src/lib/names.ts` | Gujarati full names (Prit Bharatbhai Prajapati): the father's or husband's name worked out from the tree, and taken out of names that repeat it |
| `src/lib/naming.ts` | Picks English or Gujarati labels for the rest of the app |
| `src/lib/sides.ts` | Sides of the family (close family, each parent's side, families that married in) |
| `src/lib/branches.ts` | Which part of the tree is drawn: focus (line, close family, family, side) and folded branches |
| `src/lib/treeStore.ts` | Saving and loading the tree in IndexedDB (with the one-off move from localStorage) |
| `src/lib/gedcom.ts` | GEDCOM 5.5.1 export and import |
| `src/lib/fan.ts` | Descendants view: rings and slices, branch paths, fitting names in, generation names in Gujarati, the heads of the tree's families |
| `src/lib/fanExport.ts` | The descendants view as a picture (colours resolved, root person and title drawn in) |
| `src/lib/timeline.ts` | Lifetimes on the time axis: guessed ends, row order, overlaps, axis ticks |
| `src/lib/insights.ts` | Upcoming birthdays/anniversaries and data-consistency checks |
| `src/lib/cards.ts` | Family cards: each person's generation and distance from you, descendants, rarity; the decks, their order, the hand of rarest cards; what's been collected |
| `src/lib/quiz.ts` | Who's who?: rounds of questions that widen as they go, choices that differ in every language, the clue under each question |
| `src/lib/confetti.ts` | A burst of paper from a point on the screen, in the theme's colours (off when motion is turned down) |
| `src/lib/viewSwap.ts` | Switching views as a slide, the new view coming in from the side its tab is on |
| `src/store.ts` | App state, undo history, autosave |
| `src/components/` | Canvas (pan/zoom, draws only what's near the screen), minimap, timeline, descendants fan, family cards (CardsView, FamilyCard, WhoQuiz), cards, details panel, dialogs, top bar |
