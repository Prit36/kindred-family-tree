import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Camera, ChevronDown, Crop, Expand, Info } from 'lucide-react';
import type { Gender, Person, PersonInput, Relation, Tree, UnionStatus } from '../types';
import { useStore, type Dialog } from '../store';
import { isBefore, lifespan } from '../lib/dates';
import type { CropView } from '../lib/crop';
import { keepOriginal, loadPhoto, loadStoredPhoto, releasePhoto, type PhotoSource } from '../lib/files';
import {
  blankInput,
  childCandidates,
  childrenOf,
  createPerson,
  displayName,
  familyName,
  isPlaceholder,
  linkChild,
  linkParent,
  linkPartner,
  linkSibling,
  parentCandidates,
  parentsOf,
  partnerCandidates,
  partnersOf,
  shortName,
  siblingCandidates,
  singleParentSiblings,
  updatePerson,
} from '../lib/tree';
import { Avatar } from './Avatar';
import { DateInput } from './DateInput';
import { Modal } from './Modal';
import { PhotoCropper } from './PhotoCropper';
import { PhotoViewer } from './PhotoViewer';

type PersonDialogSpec = Extract<Dialog, { type: 'first' | 'add' | 'edit' }>;

const RELATION_WORD: Record<Relation, string> = {
  parent: 'parent',
  partner: 'partner',
  child: 'child',
  sibling: 'sibling',
};

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const opposite = (g: Gender): Gender => (g === 'male' ? 'female' : g === 'female' ? 'male' : 'other');

/** "Ben", "Ben and Cara", "Ben, Cara and 2 others" */
function listNames(people: Person[]): string {
  const names = people.map((p) => shortName(p));
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}

/** Sensible starting values so adding a relative takes as little typing as possible. */
function initialDraft(tree: Tree, spec: PersonDialogSpec): PersonInput {
  if (spec.type === 'edit') {
    const person = tree.people[spec.personId];
    const { id: _id, parentIds: _parents, ...rest } = person;
    // A blank placeholder father most likely shares his children's surname.
    if (isPlaceholder(person) && person.gender === 'male') {
      return { ...rest, lastName: familyName(childrenOf(tree, person.id)[0]) };
    }
    return rest;
  }
  if (spec.type === 'first') return blankInput();
  const anchor = tree.people[spec.anchorId];
  switch (spec.relation) {
    case 'parent': {
      const existing = parentsOf(tree, anchor.id)[0];
      return blankInput({
        gender: existing ? opposite(existing.gender) : 'other',
        // Parents share the surname their child was born with, not a married name.
        lastName: existing?.gender === 'male' ? '' : familyName(anchor),
      });
    }
    case 'partner':
      return blankInput({ gender: opposite(anchor.gender) });
    case 'child': {
      const partner = partnersOf(tree, anchor.id)[0]?.person;
      const father = anchor.gender === 'male' ? anchor : partner?.gender === 'male' ? partner : anchor;
      return blankInput({ lastName: father.lastName });
    }
    case 'sibling':
      return blankInput({ lastName: familyName(anchor) });
  }
}

function candidatesFor(tree: Tree, spec: PersonDialogSpec): Person[] {
  if (spec.type !== 'add') return [];
  const list =
    spec.relation === 'parent'
      ? parentCandidates(tree, spec.anchorId)
      : spec.relation === 'partner'
        ? partnerCandidates(tree, spec.anchorId)
        : spec.relation === 'child'
          ? childCandidates(tree, spec.anchorId)
          : siblingCandidates(tree, spec.anchorId);
  return list.sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

export function PersonDialog({ spec }: { spec: PersonDialogSpec }) {
  const tree = useStore((s) => s.tree);
  const { commit, closeDialog, select, toast } = useStore.getState();

  const anchor = spec.type === 'add' ? tree.people[spec.anchorId] : undefined;
  const relation = spec.type === 'add' ? spec.relation : undefined;

  const [draft, setDraft] = useState<PersonInput>(() => initialDraft(tree, spec));
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [showMore, setShowMore] = useState(spec.type === 'edit');
  const [status, setStatus] = useState<UnionStatus>('married');
  const [photoError, setPhotoError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // The photo being cropped. Every photo loaded while the dialog is open is freed when it closes.
  const [cropping, setCropping] = useState<{ source: PhotoSource; view?: CropView } | null>(null);
  const [viewing, setViewing] = useState(false);
  const sources = useRef(new Set<PhotoSource>());
  useEffect(
    () => () => {
      for (const s of sources.current) releasePhoto(s);
    },
    [],
  );

  const candidates = useMemo(() => candidatesFor(tree, spec), [tree, spec]);
  const [existingId, setExistingId] = useState('');

  const anchorPartners = anchor ? partnersOf(tree, anchor.id) : [];
  const [otherParentId, setOtherParentId] = useState(() => {
    const current = anchorPartners.find((p) => p.union.status !== 'divorced') ?? anchorPartners[0];
    return current?.person.id ?? '';
  });

  // A second parent usually belongs to the siblings who share the first one too.
  const soloSiblings = useMemo(
    () => (relation === 'parent' && anchor ? singleParentSiblings(tree, anchor.id) : []),
    [tree, relation, anchor],
  );
  const [shareParent, setShareParent] = useState(true);

  const editingPlaceholder = spec.type === 'edit' && isPlaceholder(tree.people[spec.personId]);
  const placeholderChildren = editingPlaceholder && spec.type === 'edit' ? childrenOf(tree, spec.personId) : [];

  const deathError =
    draft.deceased && isBefore(draft.deathDate, draft.birthDate) ? "That's before they were born" : '';

  const set = (patch: Partial<PersonInput>) => setDraft((d) => ({ ...d, ...patch }));

  const needsPlaceholders =
    relation === 'sibling' &&
    anchor !== undefined &&
    anchor.parentIds.length === 0 &&
    (mode === 'new' || (tree.people[existingId]?.parentIds.length ?? 0) === 0);

  const title =
    spec.type === 'first'
      ? 'Start with yourself'
      : spec.type === 'edit'
        ? editingPlaceholder
          ? 'Fill in the details'
          : 'Edit details'
        : `Add ${shortName(anchor)}'s ${RELATION_WORD[spec.relation]}`;
  const subtitle =
    spec.type === 'first'
      ? 'You can add parents, siblings, a partner and children from here.'
      : placeholderChildren.length > 0
        ? `Parent of ${listNames(placeholderChildren)}. Add whatever you know - even just a name.`
        : undefined;

  const onPhoto = async (file: File | undefined) => {
    if (!file || cropping) return;
    try {
      const source = await loadPhoto(file);
      sources.current.add(source);
      setCropping({ source });
      setPhotoError('');
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "That image couldn't be read");
    }
  };

  const removePhoto = () => set({ photo: '', photoOriginal: '', photoCrop: null });

  /** Re-crops the current photo from its full-size original, loading that if needed. */
  const adjustPhoto = async () => {
    const id = draft.photoOriginal;
    if (!id || cropping) return;
    let source = [...sources.current].find((s) => s.originalId === id);
    if (!source) {
      try {
        source = await loadStoredPhoto(id);
        sources.current.add(source);
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : "The full-size photo couldn't be read");
        return;
      }
    }
    setPhotoError('');
    setCropping({ source, view: draft.photoCrop ?? undefined });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'new' && deathError) return;
    const lastName = draft.lastName.trim();
    const birthName = draft.birthName.trim();
    const clean: PersonInput = {
      ...draft,
      firstName: draft.firstName.trim(),
      lastName,
      // Only worth keeping when it says something the surname doesn't.
      birthName: birthName.toLowerCase() === lastName.toLowerCase() ? '' : birthName,
      birthPlace: draft.birthPlace.trim(),
      notes: draft.notes.trim(),
      deathDate: draft.deceased ? draft.deathDate : '',
    };

    if (spec.type === 'edit') {
      commit(updatePerson(tree, spec.personId, clean));
      closeDialog();
      return;
    }

    if (spec.type === 'first') {
      const created = createPerson(tree, clean);
      commit(created.tree);
      closeDialog();
      select(created.id, true);
      return;
    }

    let next = tree;
    let targetId = existingId;
    if (mode === 'new') {
      const created = createPerson(tree, clean);
      next = created.tree;
      targetId = created.id;
    }
    if (!next.people[targetId]) return;

    switch (spec.relation) {
      case 'parent':
        next = linkParent(next, spec.anchorId, targetId, shareParent ? soloSiblings.map((s) => s.id) : []);
        break;
      case 'partner':
        next = linkPartner(next, spec.anchorId, targetId, status);
        break;
      case 'child':
        next = linkChild(next, spec.anchorId, otherParentId || null, targetId);
        break;
      case 'sibling': {
        const res = linkSibling(next, spec.anchorId, targetId);
        next = res.tree;
        if (res.placeholders) toast('Added placeholder parents - select them to fill in their details');
        break;
      }
    }
    commit(next);
    closeDialog();
    select(targetId);
  };

  return (
    <Modal title={title} subtitle={subtitle} onClose={closeDialog} width={600}>
      <form
        onSubmit={submit}
        className="form"
        // A photo can be dropped anywhere on the form.
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (mode === 'new') void onPhoto(e.dataTransfer.files[0]);
        }}
      >
        {spec.type === 'add' && candidates.length > 0 && (
          <div className="segmented" role="tablist" aria-label="Who to add">
            <button type="button" role="tab" aria-selected={mode === 'new'} onClick={() => setMode('new')}>
              New person
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'existing'}
              onClick={() => {
                setMode('existing');
                if (!existingId) setExistingId(candidates[0].id);
              }}
            >
              Already in the tree
            </button>
          </div>
        )}

        {mode === 'existing' ? (
          <label className="field">
            <span className="field-label">Person</span>
            <select
              className="input"
              value={existingId}
              autoFocus
              onChange={(e) => setExistingId(e.target.value)}
            >
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {displayName(p)}
                  {lifespan(p) ? ` (${lifespan(p)})` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <div className="name-row">
              <button
                type="button"
                className="photo-btn"
                onClick={() => fileRef.current?.click()}
                aria-label={draft.photo ? 'Change photo' : 'Add photo'}
                data-tip={draft.photo ? 'Change photo' : 'Add photo'}
              >
                <Avatar person={draft} size={72} />
                <span className="photo-badge">
                  <Camera size={13} />
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void onPhoto(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <div className="name-fields">
                <label className="field">
                  <span className="field-label">First name</span>
                  <input
                    className="input"
                    value={draft.firstName}
                    autoFocus
                    autoComplete="off"
                    onChange={(e) => set({ firstName: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Last name</span>
                  <input
                    className="input"
                    value={draft.lastName}
                    autoComplete="off"
                    onChange={(e) => set({ lastName: e.target.value })}
                  />
                </label>
              </div>
            </div>
            {(draft.photo || photoError) && (
              <div className="photo-meta">
                {photoError && <span className="error-text">{photoError}</span>}
                {draft.photo && (
                  <button type="button" className="link-btn" onClick={() => setViewing(true)}>
                    <Expand size={14} /> View
                  </button>
                )}
                {draft.photo && draft.photoOriginal && (
                  <button type="button" className="link-btn" onClick={() => void adjustPhoto()}>
                    <Crop size={14} /> Adjust
                  </button>
                )}
                {draft.photo && (
                  <button type="button" className="link-btn" onClick={removePhoto}>
                    Remove photo
                  </button>
                )}
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <span className="field-label">Gender</span>
                <div className="segmented" role="radiogroup" aria-label="Gender">
                  {GENDERS.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      role="radio"
                      aria-checked={draft.gender === g.value}
                      onClick={() => set({ gender: g.value })}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field-label">
                  Born <small>- just the year is fine</small>
                </span>
                <DateInput label="Born" value={draft.birthDate} onChange={(v) => set({ birthDate: v })} />
              </div>
            </div>

            {!showMore && (
              <button type="button" className="link-btn more-btn" onClick={() => setShowMore(true)}>
                <ChevronDown size={15} /> More details
              </button>
            )}

            {showMore && (
              <>
                <div className="field-row">
                  <label className="field">
                    <span className="field-label">
                      Surname at birth <small>- if it changed</small>
                    </span>
                    <input
                      className="input"
                      value={draft.birthName}
                      autoComplete="off"
                      onChange={(e) => set({ birthName: e.target.value })}
                    />
                  </label>

                  <label className="field">
                    <span className="field-label">Birthplace</span>
                    <input
                      className="input"
                      value={draft.birthPlace}
                      autoComplete="off"
                      onChange={(e) => set({ birthPlace: e.target.value })}
                    />
                  </label>
                </div>

                <div className="field-row is-death">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.deceased}
                      onChange={(e) => set({ deceased: e.target.checked })}
                    />
                    <span>Has passed away</span>
                  </label>
                  {draft.deceased && (
                    <div className="field">
                      <span className="field-label">Died</span>
                      <DateInput label="Died" value={draft.deathDate} onChange={(v) => set({ deathDate: v })} />
                      {deathError && (
                        <span className="field-note is-error" role="alert">
                          {deathError}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <label className="field">
                  <span className="field-label">Notes</span>
                  <textarea
                    className="input"
                    rows={3}
                    value={draft.notes}
                    placeholder="Stories, occupation, anything worth remembering"
                    onChange={(e) => set({ notes: e.target.value })}
                  />
                </label>
              </>
            )}
          </>
        )}

        {relation === 'partner' && (
          <label className="field">
            <span className="field-label">Relationship</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as UnionStatus)}>
              <option value="married">Married</option>
              <option value="partner">Partner</option>
              <option value="divorced">Divorced</option>
            </select>
          </label>
        )}

        {relation === 'child' && anchorPartners.length > 0 && (
          <label className="field">
            <span className="field-label">Other parent</span>
            <select className="input" value={otherParentId} onChange={(e) => setOtherParentId(e.target.value)}>
              {anchorPartners.map(({ person }) => (
                <option key={person.id} value={person.id}>
                  {displayName(person)}
                </option>
              ))}
              <option value="">Not in the tree</option>
            </select>
          </label>
        )}

        {soloSiblings.length > 0 && anchor && (
          <label className="check">
            <input type="checkbox" checked={shareParent} onChange={(e) => setShareParent(e.target.checked)} />
            <span>
              Also {listNames(soloSiblings)}'s parent
              <small> - keeps {shortName(anchor)} and {soloSiblings.length === 1 ? 'them' : 'the others'} full siblings</small>
            </span>
          </label>
        )}

        {needsPlaceholders && (
          <p className="hint">
            <Info size={15} />
            <span>
              Siblings are linked through their parents. {shortName(anchor)} has none yet, so two placeholder parents
              will be added - you can fill them in later.
            </span>
          </p>
        )}

        {cropping && (
          <PhotoCropper
            source={cropping.source}
            view={cropping.view}
            onCancel={() => setCropping(null)}
            onSave={(photo, source, view) => {
              sources.current.add(source);
              // Stored now; if the dialog is cancelled instead, it's tidied away on a later visit.
              set({ photo, photoOriginal: keepOriginal(source), photoCrop: view });
              setCropping(null);
            }}
          />
        )}

        {viewing && draft.photo && (
          <PhotoViewer
            person={draft}
            onClose={() => setViewing(false)}
            onAdjust={
              draft.photoOriginal
                ? () => {
                    setViewing(false);
                    void adjustPhoto();
                  }
                : undefined
            }
            onChange={() => {
              setViewing(false);
              fileRef.current?.click();
            }}
          />
        )}

        <footer className="modal-foot">
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={mode === 'new' && Boolean(deathError)}>
            {spec.type === 'edit' ? 'Save' : spec.type === 'first' ? 'Start my tree' : 'Add to tree'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
