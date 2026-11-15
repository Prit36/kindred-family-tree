import type { CropView } from './lib/crop';

export type Gender = 'male' | 'female' | 'other';
export type UnionStatus = 'married' | 'partner' | 'divorced';

/** Dates are partial ISO strings: '', 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
export interface Person {
  id: string;
  /** The given name alone: "Prit" */
  firstName: string;
  /**
   * Father's (a wife's: husband's) name, written in only where the tree can't say it -
   * see lib/names.ts. Otherwise ''.
   */
  middleName: string;
  lastName: string;
  /** Surname at birth when it differs from `lastName` (maiden name), or '' */
  birthName: string;
  gender: Gender;
  birthDate: string;
  deathDate: string;
  deceased: boolean;
  birthPlace: string;
  /** Small square JPEG data URL, or '' */
  photo: string;
  /** Id of the full-size photo `photo` was cropped from (see lib/photoStore.ts), or '' */
  photoOriginal: string;
  /** Where in that original the crop was taken, so it can be adjusted later */
  photoCrop: CropView | null;
  notes: string;
  /** Up to two parents */
  parentIds: string[];
}

export type PersonInput = Omit<Person, 'id' | 'parentIds'>;

/** A couple. Invariant: two people who share a child always have a union. */
export interface Union {
  id: string;
  a: string;
  b: string;
  status: UnionStatus;
}

export interface Tree {
  version: 1;
  name: string;
  people: Record<string, Person>;
  unions: Union[];
  /** The person relationships are described relative to ("me") */
  homeId: string | null;
  /**
   * How this family writes names in Gujarati where it differs from the automatic spelling:
   * a lowercase name ("katudiya") or whole name ("ramesh d.") → its Gujarati ("કટુડિયા").
   */
  spellings?: Record<string, string>;
  /**
   * Names follow the Gujarati custom (given name, father's or husband's name, surname):
   * the middle name is worked out from the tree. See lib/names.ts.
   */
  patronymic?: boolean;
}

export type Relation = 'parent' | 'partner' | 'child' | 'sibling';
