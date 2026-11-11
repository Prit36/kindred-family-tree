import { useEffect, useState } from 'react';
import { ArrowLeftRight, Focus, ImageUp, Users, X } from 'lucide-react';
import { useStore } from './store';
import {
  adjustPhoto,
  importBackup,
  isBackupFile,
  loadSample,
  pickPhotoFor,
  savePhoto,
  setPhotoFromFile,
  startOver,
  viewPhoto,
} from './lib/actions';
import type { CropView } from './lib/crop';
import { releasePhoto, type PhotoSource } from './lib/files';
import { focusSet, type FocusScope } from './lib/branches';
import { familySides, focusTitle, sideForFocus } from './lib/sides';
import { relationBetween } from './lib/kinship';
import { deletePerson, displayName, pathBetween, shortName } from './lib/tree';
import { Avatar } from './components/Avatar';
import { Canvas } from './components/Canvas';
import { ConfirmDialog } from './components/ConfirmDialog';
import { InsightsDialog } from './components/InsightsDialog';
import { Modal } from './components/Modal';
import { PersonDialog } from './components/PersonDialog';
import { PersonPanel } from './components/PersonPanel';
import { PhotoCropper } from './components/PhotoCropper';
import { PhotoViewer } from './components/PhotoViewer';
import { Timeline } from './components/Timeline';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';

const SHORTCUTS: { title: string; rows: [keys: string[], what: string][] }[] = [
  {
    title: 'Getting around',
    rows: [
      [['↑', '↓'], 'Go to a parent or child'],
      [['←', '→'], 'Go to the next person in the same generation'],
      [['/'], 'Search by name, place, year or relationship'],
      [['T'], 'Switch between the tree and the timeline'],
      [['H'], 'Jump back to yourself'],
      [['F'], 'Fit the whole tree on screen'],
      [['+', '−'], 'Zoom in and out'],
      [['Esc'], 'Deselect'],
    ],
  },
  {
    title: 'The selected person',
    rows: [
      [['Enter'], 'Edit - or double-click their card'],
      [['P'], 'View their photo full size'],
      [['Del'], 'Delete'],
      [['B'], 'Show only their direct line - press again for the whole tree'],
      [['Shift', 'B'], 'Show only their family: every blood relative, aunts to cousins'],
      [['Shift', 'click'], 'See how someone else is related to them'],
    ],
  },
  {
    title: 'Anywhere',
    rows: [
      [['Ctrl', 'Z'], 'Undo'],
      [['Ctrl', 'Shift', 'Z'], 'Redo'],
      [['?'], 'Show this list'],
    ],
  },
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={720}>
      <div className="shortcuts">
        {SHORTCUTS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.rows.map(([keys, what]) => (
                <div key={what}>
                  <dt>
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="shortcuts-note">
          In a big tree, <strong>Sides</strong> (bottom left) lists your father's side, your mother's side and each family
          that married in, in the colours their cards are tinted with - click one to show only that side. The small{' '}
          <strong>−</strong> buttons on the connecting lines fold a branch away; the <strong>+</strong> badge left behind
          brings it back. Rest on any connecting line to see who it joins: couples' lines are solid when married, dashed for
          partners and dotted when divorced. You can also drop a photo onto anyone's card, or a backup
          file anywhere to import it.
        </p>
      </div>
    </Modal>
  );
}

/** The cropper for a photo picked from the details panel or dropped on a card. */
function PhotoDialog({ personId, source, view }: { personId: string; source: PhotoSource; view?: CropView }) {
  const person = useStore((s) => s.tree.people[personId]);
  const { closeDialog } = useStore.getState();
  // Freed when the dialog is closed rather than in an effect cleanup, which StrictMode
  // would run straight after mounting.
  const close = () => {
    closeDialog();
    releasePhoto(source);
  };
  return (
    <PhotoCropper
      source={source}
      view={view}
      title={person ? `Photo of ${shortName(person)}` : undefined}
      onCancel={close}
      onSave={(photo, saved, cropView) => {
        savePhoto(personId, photo, saved, cropView);
        close();
        // A different photo picked inside the cropper is no longer needed either.
        if (saved !== source) releasePhoto(saved);
      }}
    />
  );
}

function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const tree = useStore((s) => s.tree);
  const { closeDialog, commit, toast, undo } = useStore.getState();
  if (!dialog) return null;

  switch (dialog.type) {
    case 'first':
    case 'add':
    case 'edit': {
      // The person a dialog refers to can vanish (undo); just close in that case.
      const refId = dialog.type === 'add' ? dialog.anchorId : dialog.type === 'edit' ? dialog.personId : null;
      if (refId && !tree.people[refId]) return null;
      const key =
        dialog.type === 'add'
          ? `add-${dialog.relation}-${dialog.anchorId}`
          : dialog.type === 'edit'
            ? `edit-${dialog.personId}`
            : dialog.type;
      return <PersonDialog key={key} spec={dialog} />;
    }
    case 'delete': {
      const person = tree.people[dialog.personId];
      if (!person) return null;
      return (
        <ConfirmDialog
          title={`Delete ${displayName(person)}?`}
          confirmLabel="Delete"
          danger
          onClose={closeDialog}
          onConfirm={() => {
            commit(deletePerson(tree, person.id));
            closeDialog();
            toast(`${shortName(person)} was removed`, { action: { label: 'Undo', run: undo } });
          }}
        >
          They'll be removed from the tree along with their links to relatives. Other people stay where they are.
        </ConfirmDialog>
      );
    }
    case 'reset':
      return (
        <ConfirmDialog
          title="Start over?"
          confirmLabel="Clear the tree"
          danger
          onClose={closeDialog}
          onConfirm={() => {
            startOver();
            closeDialog();
          }}
        >
          This removes everyone from the tree. Consider exporting a backup first.
        </ConfirmDialog>
      );
    case 'sample': {
      const hasPeople = Object.keys(tree.people).length > 0;
      return (
        <ConfirmDialog
          title="Load the sample family?"
          confirmLabel="Load sample"
          onClose={closeDialog}
          onConfirm={() => {
            loadSample();
            closeDialog();
          }}
        >
          {hasPeople
            ? 'This replaces your current tree with a fictional family. You can undo it straight away, but exporting a backup first is safest.'
            : 'A fictional four-generation family to explore before starting your own.'}
        </ConfirmDialog>
      );
    }
    case 'shortcuts':
      return <ShortcutsDialog onClose={closeDialog} />;
    case 'insights':
      return <InsightsDialog tab={dialog.tab} />;
    case 'photo':
      // The person can vanish (undo) while the cropper is open.
      if (!tree.people[dialog.personId]) return null;
      return (
        <PhotoDialog key={dialog.source.url} personId={dialog.personId} source={dialog.source} view={dialog.view} />
      );
    case 'viewPhoto': {
      const person = tree.people[dialog.personId];
      if (!person?.photo) return null;
      return (
        <PhotoViewer
          key={person.photoOriginal || person.photo}
          person={person}
          onClose={closeDialog}
          onAdjust={person.photoOriginal ? () => void adjustPhoto(person.id) : undefined}
          onChange={() => {
            // The picker only takes a photo while no dialog is open.
            closeDialog();
            pickPhotoFor(person.id);
          }}
        />
      );
    }
  }
}

/** "Noah is Arthur's great-grandson" - shown while a second person is Shift+clicked. */
function CompareBanner() {
  const tree = useStore((s) => s.tree);
  const selectedId = useStore((s) => s.selectedId);
  const compareId = useStore((s) => s.compareId);
  const compare = useStore((s) => s.compare);

  const base = selectedId ? tree.people[selectedId] : undefined;
  const other = compareId ? tree.people[compareId] : undefined;
  if (!base || !other) return null;

  const label = relationBetween(tree, base.id, other.id);
  const connected = label || pathBetween(tree, base.id, other.id);

  return (
    <div className="compare" role="status">
      <Avatar person={other} size={28} />
      <span className="compare-text">
        {label ? (
          <>
            <strong>{shortName(other)}</strong> is <strong>{shortName(base)}</strong>'s{' '}
            <em>{label.charAt(0).toLowerCase() + label.slice(1)}</em>
          </>
        ) : connected ? (
          <>
            <strong>{shortName(other)}</strong> and <strong>{shortName(base)}</strong> are connected by marriage - follow
            the highlighted line
          </>
        ) : (
          <>
            <strong>{shortName(other)}</strong> and <strong>{shortName(base)}</strong> aren't connected in this tree
          </>
        )}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label="Swap the two people"
        data-tip="Swap"
        onClick={() => useStore.setState({ selectedId: other.id, compareId: base.id })}
      >
        <ArrowLeftRight size={15} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Stop comparing"
        data-tip="Close (Esc)"
        onClick={() => compare(null)}
      >
        <X size={16} />
      </button>
    </div>
  );
}

const SCOPES: { scope: FocusScope; label: string; tip: string }[] = [
  { scope: 'side', label: 'Side', tip: 'Just this side, and how it links to you' },
  { scope: 'line', label: 'Line', tip: 'Ancestors and descendants only (B)' },
  { scope: 'close', label: 'Close', tip: 'Parents, siblings, children and their partners' },
  { scope: 'family', label: 'Family', tip: 'Every blood relative - aunts, uncles, cousins (Shift+B)' },
];

/** "Showing only Father's side" - while the rest of the tree is hidden. */
function FocusBanner() {
  const tree = useStore((s) => s.tree);
  const focus = useStore((s) => s.focus);
  const { select, clearFocus, focusOn } = useStore.getState();

  const person = focus ? tree.people[focus.id] : undefined;
  if (!focus || !person) return null;
  const shown = focusSet(tree, focus).size;
  const total = Object.keys(tree.people).length;
  const sides = familySides(tree);
  const side = sideForFocus(sides, focus);
  const title = focusTitle(tree, focus);
  // Other ways to narrow the tree around the same person, if they'd show something different.
  const scopes = SCOPES.filter(({ scope }) => {
    if (scope === focus.scope) return true;
    // Only the root of a side (your father, your wife…) has a side to show.
    if (scope === 'side' && !sideForFocus(sides, { id: person.id, scope })) return false;
    const size = focusSet(tree, { id: person.id, scope }).size;
    return size < total && size !== shown;
  });

  return (
    <div className="compare focus-banner" role="status">
      <span className="focus-icon" data-tone={side?.tone}>
        <Focus size={16} />
      </span>
      <span className="focus-summary">
        <button type="button" className="focus-name" onClick={() => select(person.id, true)} data-tip={`Go to ${shortName(person)}`}>
          {title}
        </button>
        <span className="focus-count">
          Showing {shown} of {total} people
        </span>
      </span>
      {scopes.length > 1 && (
        <>
          <span className="focus-divider" aria-hidden="true" />
          <div className="segmented focus-scopes" role="radiogroup" aria-label={`How much around ${shortName(person)} to show`}>
            {scopes.map(({ scope, label, tip }) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={scope === focus.scope}
                data-tip={tip}
                onClick={() => scope !== focus.scope && focusOn(person.id, scope)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <span className="focus-divider" aria-hidden="true" />
      <button type="button" className="btn focus-exit" onClick={clearFocus} data-tip="Back to the whole tree (B)">
        <Users size={15} />
        Show everyone
      </button>
    </div>
  );
}

/** Stacked under the top bar, centred in the space the details panel leaves free. */
function Banners() {
  const panelOpen = useStore((s) => Boolean(s.selectedId && s.tree.people[s.selectedId]));
  return (
    <div className={`compare-wrap${panelOpen ? '' : ' is-wide'}`}>
      <FocusBanner />
      <CompareBanner />
    </div>
  );
}

/**
 * Files dropped on the window: a photo onto a person's card (or their details panel)
 * sets their picture, a backup file anywhere imports it. Returns whether a file is
 * currently being dragged over the window.
 */
function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    let lit: Element | null = null;
    const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const personTarget = (e: DragEvent) =>
      useStore.getState().dialog ? null : ((e.target as Element | null)?.closest?.('[data-person-id]') ?? null);
    const light = (el: Element | null) => {
      if (lit === el) return;
      lit?.classList.remove('is-drop-target');
      el?.classList.add('is-drop-target');
      lit = el;
    };
    const reset = () => {
      depth = 0;
      light(null);
      setDragging(false);
    };

    const onEnter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // Without this the browser would navigate away to the dropped file.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      light(personTarget(e));
    };
    const onLeave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      const personId = (personTarget(e) as HTMLElement | null)?.dataset.personId;
      reset();
      const { dialog, toast } = useStore.getState();
      if (dialog) return; // dialogs take care of their own drops
      const files = Array.from(e.dataTransfer?.files ?? []);
      const image = files.find((f) => f.type.startsWith('image/'));
      const backup = files.find(isBackupFile);
      if (image && personId) void setPhotoFromFile(personId, image);
      else if (backup) void importBackup(backup);
      else if (image) toast("Drop the photo onto someone's card to set their picture");
      else toast('Drop a photo, a .json backup or a .ged GEDCOM file', { tone: 'error' });
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return dragging;
}

export default function App() {
  const empty = useStore((s) => Object.keys(s.tree.people).length === 0);
  const dialogOpen = useStore((s) => s.dialog !== null);
  const timeline = useStore((s) => s.mode === 'timeline') && !empty;
  const dragging = useFileDrop();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { dialog, undo, redo, select, compare, selectedId, compareId, openDialog, focus, focusOn, clearFocus } =
        useStore.getState();
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      if (dialog || typing) return;

      if (mod) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (key === 'y') {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.altKey) return;

      if (e.key === 'Escape') {
        if (compareId) compare(null);
        else if (selectedId) select(null);
        else if (focus) clearFocus();
      } else if (e.key === '?') {
        openDialog({ type: 'shortcuts' });
      } else if (e.key.toLowerCase() === 't') {
        const { mode, setMode, tree } = useStore.getState();
        if (Object.keys(tree.people).length > 0) setMode(mode === 'tree' ? 'timeline' : 'tree');
      } else if (e.key.toLowerCase() === 'b') {
        // B shows the selected person's direct line, Shift+B their whole family; pressing it
        // again (or with nobody selected) goes back to the whole tree.
        const scope: FocusScope = e.shiftKey ? 'family' : 'line';
        if (selectedId && !(focus?.id === selectedId && focus.scope === scope)) focusOn(selectedId, scope);
        else clearFocus();
      } else if (selectedId) {
        // Enter on a focused button or menu item belongs to that control, not to the selection.
        const onControl = Boolean(el.closest('button, a, [role="menu"]'));
        if ((e.key === 'Enter' && !onControl) || e.key.toLowerCase() === 'e') {
          e.preventDefault();
          openDialog({ type: 'edit', personId: selectedId });
        } else if (e.key.toLowerCase() === 'p') {
          viewPhoto(selectedId);
        } else if (e.key === 'Delete' || (e.key === 'Backspace' && !onControl)) {
          e.preventDefault();
          openDialog({ type: 'delete', personId: selectedId });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app${timeline ? ' is-timeline' : ''}`}>
      {/* The tree stays mounted under the timeline so it keeps its place. */}
      <Canvas />
      {timeline && <Timeline />}
      <TopBar />
      {empty && <Welcome />}
      <Banners />
      <PersonPanel />
      <Dialogs />
      <Toasts />
      {dragging && !dialogOpen && (
        <div className="drop-hint" role="status">
          <ImageUp size={16} />
          {empty
            ? 'Drop a backup or GEDCOM file to import it'
            : 'Drop a photo on a card - or a backup or GEDCOM file anywhere to import it'}
        </div>
      )}
    </div>
  );
}
