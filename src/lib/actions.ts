import type { Relation } from '../types';
import { useStore } from '../store';
import { canvasHandle } from './canvasHandle';
import type { CropView } from './crop';
import { decodeGedcom, nameFromFile, parseGedcom, toGedcom } from './gedcom';
import { download, downloadTreeJson, keepOriginal, slug, loadPhoto, loadStoredPhoto, releasePhoto, type PhotoSource } from './files';
import { importOriginals, onStoreFailure, pruneOriginals } from './photoStore';
import { sampleTree } from './sample';
import { emptyTree, isPlaceholder, parentsOf, sanitizeTree, shortName, updatePerson } from './tree';

/** Actions shared by the menu, the canvas, the details panel and the welcome screen. */

const undoAction = () => ({ label: 'Undo', run: useStore.getState().undo });

export async function exportBackup() {
  const { tree, toast } = useStore.getState();
  try {
    await downloadTreeJson(tree);
    toast('Backup downloaded');
  } catch {
    toast("Couldn't create the backup", { tone: 'error' });
  }
}

export async function exportImage() {
  const { toast, mode, setMode } = useStore.getState();
  // The image is of the tree, which is hidden behind the timeline: show it first.
  if (mode !== 'tree') {
    setMode('tree');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  if (!canvasHandle.exportPng) return;
  try {
    await canvasHandle.exportPng();
    toast('Image downloaded');
  } catch {
    toast("Couldn't create the image", { tone: 'error' });
  }
}

export function exportGedcom() {
  const { tree, toast } = useStore.getState();
  try {
    const blob = new Blob([toGedcom(tree)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    download(url, `${slug(tree.name)}.ged`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('GEDCOM file downloaded — photos aren’t included, so keep a backup too');
  } catch {
    toast("Couldn't create the GEDCOM file", { tone: 'error' });
  }
}

const isGedcomFile = (file: File) => /\.ged$/i.test(file.name);

async function importGedcom(file: File) {
  const { commit, toast, fitView, tree: current } = useStore.getState();
  try {
    const { tree, count } = parseGedcom(decodeGedcom(await file.arrayBuffer()), nameFromFile(file.name));
    const hadPeople = Object.keys(current.people).length > 0;
    commit(tree);
    fitView();
    toast(`Imported ${count} ${count === 1 ? 'person' : 'people'} from GEDCOM`, hadPeople ? { action: undoAction() } : undefined);
  } catch {
    toast("That file couldn't be read as GEDCOM", { tone: 'error' });
  }
}

/** Imports a Kindred backup (.json) or a GEDCOM file (.ged), replacing the current tree. */
export async function importBackup(file: File) {
  if (isGedcomFile(file)) return importGedcom(file);
  const { commit, toast, fitView, tree: current } = useStore.getState();
  try {
    const raw: unknown = JSON.parse(await file.text());
    const tree = sanitizeTree(raw);
    const count = Object.keys(tree.people).length;
    if (count === 0) throw new Error('empty');
    // Full-size photos travel in the backup next to the tree.
    await importOriginals((raw as { originals?: unknown }).originals, originalIds(tree));
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

/** Opens the system file picker for a backup or GEDCOM file. */
export function pickBackupFile() {
  pickFile('application/json,.json,.ged', (file) => void importBackup(file));
}

/** Opens the cropper for a photo file, without going through the edit dialog. */
export async function setPhotoFromFile(personId: string, file: File) {
  const { toast } = useStore.getState();
  try {
    const source = await loadPhoto(file);
    // Check again: the person may be gone, or another dialog opened, while the image was loading.
    const { tree, dialog, openDialog } = useStore.getState();
    if (!tree.people[personId] || dialog) {
      releasePhoto(source);
      return;
    }
    openDialog({ type: 'photo', personId, source });
  } catch (err) {
    toast(err instanceof Error ? err.message : "That image couldn't be read", { tone: 'error' });
  }
}

/** Saves a cropped photo chosen in the cropper, keeping the original it was cut from. */
export function savePhoto(personId: string, photo: string, source: PhotoSource, view: CropView) {
  const { tree, commit, toast } = useStore.getState();
  const person = tree.people[personId];
  if (!person) return;
  commit(updatePerson(tree, personId, { photo, photoOriginal: keepOriginal(source), photoCrop: view }));
  toast(`Photo updated for ${shortName(person)}`, { action: undoAction() });
}

/** Shows someone's photo full size. */
export function viewPhoto(personId: string) {
  const { tree, openDialog } = useStore.getState();
  if (tree.people[personId]?.photo) openDialog({ type: 'viewPhoto', personId });
}

/** Opens the cropper on someone's stored original, at the crop they have now. */
export async function adjustPhoto(personId: string) {
  const { tree, toast } = useStore.getState();
  const person = tree.people[personId];
  if (!person?.photoOriginal) return;
  try {
    const source = await loadStoredPhoto(person.photoOriginal);
    const { tree: now, openDialog } = useStore.getState();
    if (now.people[personId]?.photoOriginal !== person.photoOriginal) {
      releasePhoto(source);
      return;
    }
    openDialog({ type: 'photo', personId, source, view: person.photoCrop ?? undefined });
  } catch (err) {
    toast(err instanceof Error ? err.message : "The full-size photo couldn't be read", { tone: 'error' });
  }
}

const originalIds = (tree: { people: Record<string, { photoOriginal: string }> }) =>
  new Set(
    Object.values(tree.people)
      .map((p) => p.photoOriginal)
      .filter(Boolean),
  );

let warnedAboutOriginals = false;
onStoreFailure(() => {
  if (warnedAboutOriginals) return;
  warnedAboutOriginals = true;
  useStore
    .getState()
    .toast("Couldn't keep the full-size photo in this browser — only the cropped version will be saved", {
      tone: 'error',
    });
});

/** Clears out full-size photos nobody uses any more. Undo history doesn't survive a reload, so this runs once at startup. */
export function tidyPhotoStore() {
  void pruneOriginals(originalIds(useStore.getState().tree));
}

export function pickPhotoFor(personId: string) {
  pickFile('image/*', (file) => void setPhotoFromFile(personId, file));
}

export const isBackupFile = (file: File) =>
  file.type === 'application/json' || /\.json$/i.test(file.name) || isGedcomFile(file);

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
