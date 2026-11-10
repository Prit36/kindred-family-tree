import { useStore } from '../store';
import { canvasHandle } from './canvasHandle';
import { downloadTreeJson } from './files';
import { sampleTree } from './sample';
import { emptyTree, sanitizeTree } from './tree';

/** Whole-tree actions shared by the menu and the welcome screen. */

const undoAction = () => ({ label: 'Undo', run: useStore.getState().undo });

export function exportBackup() {
  const { tree, toast } = useStore.getState();
  downloadTreeJson(tree);
  toast('Backup downloaded');
}

export async function exportImage() {
  const { toast } = useStore.getState();
  if (!canvasHandle.exportPng) return;
  try {
    await canvasHandle.exportPng();
    toast('Image downloaded');
  } catch {
    toast("Couldn't create the image", { tone: 'error' });
  }
}

export async function importBackup(file: File) {
  const { commit, toast, fitView, tree: current } = useStore.getState();
  try {
    const tree = sanitizeTree(JSON.parse(await file.text()));
    const count = Object.keys(tree.people).length;
    if (count === 0) throw new Error('empty');
    const hadPeople = Object.keys(current.people).length > 0;
    commit(tree);
    fitView();
    toast(`Imported ${count} ${count === 1 ? 'person' : 'people'}`, hadPeople ? { action: undoAction() } : undefined);
  } catch {
    toast("That file isn't a family tree backup", { tone: 'error' });
  }
}

export function loadSample() {
  const { commit, fitView, toast, tree: current } = useStore.getState();
  const hadPeople = Object.keys(current.people).length > 0;
  commit(sampleTree());
  fitView();
  toast('Sample family loaded — explore, then start your own', hadPeople ? { action: undoAction() } : undefined);
}

export function startOver() {
  const { commit, toast } = useStore.getState();
  commit(emptyTree());
  toast('Tree cleared', { action: undoAction() });
}

/** Opens the system file picker for a backup file. */
export function pickBackupFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void importBackup(file);
  };
  input.click();
}
