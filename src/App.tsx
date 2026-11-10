import { useEffect } from 'react';
import { useStore } from './store';
import { loadSample, startOver } from './lib/actions';
import { deletePerson, displayName, shortName } from './lib/tree';
import { Canvas } from './components/Canvas';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PersonDialog } from './components/PersonDialog';
import { PersonPanel } from './components/PersonPanel';
import { Toasts } from './components/Toasts';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';

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
      const key = dialog.type === 'add' ? `add-${dialog.relation}-${dialog.anchorId}` : dialog.type;
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
  }
}

export default function App() {
  const empty = useStore((s) => Object.keys(s.tree.people).length === 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { dialog, undo, redo, select, selectedId } = useStore.getState();
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;

      if (mod && !typing && !dialog && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && !typing && !dialog && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape' && !dialog && !typing && selectedId) {
        select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Canvas />
      <TopBar />
      {empty && <Welcome />}
      <PersonPanel />
      <Dialogs />
      <Toasts />
    </div>
  );
}
