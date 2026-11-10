import type { Relation } from '../types';
import { useStore } from '../store';
import { canvasHandle } from './canvasHandle';
import { downloadTreeJson, readPhoto } from './files';
import { sampleTree } from './sample';
import { emptyTree, isPlaceholder, parentsOf, sanitizeTree, shortName, updatePerson } from './tree';

/** Actions shared by the menu, the canvas, the details panel and the welcome screen. */

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

function pickFile(accept: string, onFile: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  };
  input.click();
}

/** Opens the system file picker for a backup file. */
export function pickBackupFile() {
  pickFile('application/json,.json', (file) => void importBackup(file));
}

/** Sets someone's photo straight from a file, without going through the edit dialog. */
export async function setPhotoFromFile(personId: string, file: File) {
  const { toast } = useStore.getState();
  try {
    const photo = await readPhoto(file);
    // Read the tree again: it may have changed while the image was loading.
    const { tree, commit } = useStore.getState();
    const person = tree.people[personId];
    if (!person) return;
    commit(updatePerson(tree, personId, { photo }));
    toast(`Photo updated for ${shortName(person)}`, { action: undoAction() });
  } catch (err) {
    toast(err instanceof Error ? err.message : "That image couldn't be read", { tone: 'error' });
  }
}

export function pickPhotoFor(personId: string) {
  pickFile('image/*', (file) => void setPhotoFromFile(personId, file));
}

export const isBackupFile = (file: File) => file.type === 'application/json' || /\.json$/i.test(file.name);

/**
 * Starts adding a relative. Someone whose two parent slots are taken by a blank
 * placeholder (created when a sibling was added) gets that placeholder to fill in instead.
 */
export function addRelative(relation: Relation, anchorId: string) {
  const { tree, openDialog } = useStore.getState();
  const anchor = tree.people[anchorId];
  if (!anchor) return;
  if (relation === 'parent' && anchor.parentIds.length >= 2) {
    const placeholder = parentsOf(tree, anchorId).find(isPlaceholder);
    if (placeholder) openDialog({ type: 'edit', personId: placeholder.id });
    return;
  }
  openDialog({ type: 'add', relation, anchorId });
}

/** Whether "add parent" has anything to do for this person. */
export function canAddParent(anchorId: string): boolean {
  const { tree } = useStore.getState();
  const anchor = tree.people[anchorId];
  if (!anchor) return false;
  return anchor.parentIds.length < 2 || parentsOf(tree, anchorId).some(isPlaceholder);
}
