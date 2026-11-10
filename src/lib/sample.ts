import type { Gender, PersonInput, Tree, UnionStatus } from '../types';
import { blankInput, createPerson, emptyTree, linkChild, linkPartner } from './tree';

type Extra = Partial<Pick<PersonInput, 'birthName' | 'birthPlace' | 'deathDate' | 'deceased' | 'notes' | 'photo'>>;

/** A simple silhouette portrait, stored inline as an SVG data URL. */
function portrait(background: string, figure: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${background}"/>` +
    `<circle cx="50" cy="40" r="18" fill="${figure}"/>` +
    `<path d="M18 100c0-22 14-36 32-36s32 14 32 36z" fill="${figure}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A fictional family for trying the app out. It covers most of what Kindred does: four
 * generations, a divorce, unmarried partners, half-siblings, a relative who is neither
 * male nor female, cousins (and a cousin once removed), partial dates, photos and notes.
 */
export function sampleTree(): Tree {
  let tree: Tree = { ...emptyTree(), name: 'The Morgan Family' };

  const add = (firstName: string, lastName: string, gender: Gender, birthDate: string, extra: Extra = {}) => {
    const res = createPerson(
      tree,
      blankInput({
        firstName,
        lastName,
        gender,
        birthDate,
        ...extra,
        deceased: extra.deceased ?? Boolean(extra.deathDate),
      }),
    );
    tree = res.tree;
    return res.id;
  };
  const marry = (a: string, b: string, status: UnionStatus = 'married') => {
    tree = linkPartner(tree, a, b, status);
  };
  // Make a union before its children, so the couple gets the status given above.
  const child = (id: string, p1: string, p2: string | null) => {
    tree = linkChild(tree, p1, p2, id);
  };

  // ---- Alex and their children -------------------------------------------
  // The first person created becomes "me".
  const alex = add('Alex', 'Morgan', 'male', '1990-04-12', {
    birthPlace: 'Bristol',
    notes: 'Keeper of the family tree.',
    photo: portrait('#c7d9ea', '#2f5d7c'),
  });
  const maya = add('Maya', 'Morgan', 'female', '1991-09-03', {
    birthPlace: 'Leicester',
    birthName: 'Patel',
    photo: portrait('#f3d9c4', '#8a4b2a'),
  });
  marry(alex, maya);
  const leo = add('Leo', 'Morgan', 'male', '2018-06-21');
  const isla = add('Isla', 'Morgan', 'female', '2021-11-02');
  child(leo, alex, maya);
  child(isla, alex, maya);

  // ---- Alex's parents: a first marriage, a half-sister, and siblings -----
  const robert = add('Robert', 'Morgan', 'male', '1960-02-17', {
    birthPlace: 'Cardiff',
    notes: 'Civil engineer. Married Helen ABT 1986.',
  });
  const helen = add('Helen', 'Morgan', 'female', '1962-07-30', { birthPlace: 'Bath', birthName: 'Bennett' });
  const carol = add('Carol', 'Ashby', 'female', '1963'); // only the year is known
  marry(robert, carol, 'divorced');
  const chloe = add('Chloe', 'Morgan', 'female', '1985-09-14', { birthPlace: 'Cardiff' });
  child(chloe, robert, carol);

  marry(robert, helen);
  child(alex, robert, helen);
  const daniel = add('Daniel', 'Morgan', 'male', '1987-01-08');
  const emma = add('Emma', 'Morgan', 'female', '1994-12-19');
  child(daniel, robert, helen);
  child(emma, robert, helen);

  // Daniel and Sofia have separated.
  const sofia = add('Sofia', 'Morgan', 'female', '1988-05-25');
  marry(daniel, sofia, 'divorced');
  const noah = add('Noah', 'Morgan', 'male', '2015-03-14');
  child(noah, daniel, sofia);

  // Emma and Tom are unmarried partners. Tom also has a son from an earlier relationship.
  const tom = add('Tom', 'Reid', 'male', '1987-05-19', { birthPlace: 'Leeds' });
  marry(emma, tom, 'partner');
  const ellie = add('Ellie', 'Reid', 'female', '2020-01-30', {
    notes: 'Born during a snowstorm.',
    photo: portrait('#fde2e4', '#b5525c'),
  });
  child(ellie, emma, tom);

  const laura = add('Laura', 'Hughes', 'female', '1989-02'); // month known, day not
  marry(tom, laura, 'divorced');
  const finn = add('Finn', 'Reid', 'male', '2010-08-03');
  child(finn, tom, laura);

  // ---- Maya's family -------------------------------------------------------
  const raj = add('Raj', 'Patel', 'male', '1958-11-14', { birthPlace: 'Ahmedabad' });
  const anita = add('Anita', 'Patel', 'female', '1961-04-06');
  marry(raj, anita);
  child(maya, raj, anita);
  const kiran = add('Kiran', 'Patel', 'male', '1988-02-28');
  child(kiran, raj, anita);
  const sam = add('Sam', 'Patel', 'other', '1996-06-30', {
    birthPlace: 'Leicester',
    notes: 'Runs the bakery on Market Street.',
  });
  child(sam, raj, anita);

  // ---- Alex's paternal grandparents and their children ---------------------
  const arthur = add('Arthur', 'Morgan', 'male', '1932-10-05', {
    deathDate: '2010-01-22',
    birthPlace: 'Cardiff',
    notes: 'Worked on the railways for forty years.',
    photo: portrait('#d9d2c5', '#6b5d4f'),
  });
  const margaret = add('Margaret', 'Morgan', 'female', '1935-03-11', { deathDate: '2018-08-09' });
  marry(arthur, margaret);
  child(robert, arthur, margaret);
  const susan = add('Susan', 'Clarke', 'female', '1964-06-02', { birthName: 'Morgan' });
  child(susan, arthur, margaret);

  // Susan's family: Alex's cousins.
  const david = add('David', 'Clarke', 'male', '1961-10-12');
  marry(susan, david);
  const owen = add('Owen', 'Clarke', 'male', '1990-03-20');
  child(owen, susan, david);
  const priya = add('Priya', 'Shah', 'female', '1992-01-15');
  marry(owen, priya);
  const ava = add('Ava', 'Clarke', 'female', '2019-07-04');
  child(ava, owen, priya);

  // ---- Alex's maternal grandparents, and Helen's half-brother --------------
  const george = add('George', 'Bennett', 'male', '1934-12-01', {
    deathDate: '2005-04-18',
    notes: 'Served in the Royal Navy, about 1952 to 1955.',
  });
  const dorothy = add('Dorothy', 'Bennett', 'female', '1936', {
    birthName: 'Hale',
    deceased: true, // died, but the date is not known
    notes: 'Little is known about her yet.',
  });
  marry(george, dorothy, 'divorced');
  const peter = add('Peter', 'Bennett', 'male', '1956-05-09', { birthPlace: 'Bath' });
  child(peter, george, dorothy);

  const ruth = add('Ruth', 'Bennett', 'female', '1938-08-27', {
    birthPlace: 'Bath',
    notes: 'Taught piano to half the street.',
    photo: portrait('#e6d5e8', '#6d4a75'),
  });
  marry(george, ruth);
  child(helen, george, ruth);

  return tree;
}
