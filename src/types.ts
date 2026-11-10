export type Gender = 'male' | 'female' | 'other';
export type UnionStatus = 'married' | 'partner' | 'divorced';

/** Dates are partial ISO strings: '', 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. */
export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  birthDate: string;
  deathDate: string;
  deceased: boolean;
  birthPlace: string;
  /** Small square JPEG data URL, or '' */
  photo: string;
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
}

export type Relation = 'parent' | 'partner' | 'child' | 'sibling';
