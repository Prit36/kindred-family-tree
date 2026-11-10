import type { Gender, Tree } from '../types';
import { blankInput, createPerson, emptyTree, linkChild, linkPartner } from './tree';

/** A fictional four-generation family for trying the app out. */
export function sampleTree(): Tree {
  let tree: Tree = { ...emptyTree(), name: 'The Morgan Family' };

  const add = (
    firstName: string,
    lastName: string,
    gender: Gender,
    birthDate: string,
    extra: { deathDate?: string; birthPlace?: string; notes?: string; birthName?: string } = {},
  ) => {
    const res = createPerson(
      tree,
      blankInput({ firstName, lastName, gender, birthDate, ...extra, deceased: Boolean(extra.deathDate) }),
    );
    tree = res.tree;
    return res.id;
  };
  const marry = (a: string, b: string) => {
    tree = linkPartner(tree, a, b, 'married');
  };
  const child = (id: string, p1: string, p2: string | null) => {
    tree = linkChild(tree, p1, p2, id);
  };

  // The first person created becomes "me".
  const alex = add('Alex', 'Morgan', 'male', '1990-04-12', {
    birthPlace: 'Bristol',
    notes: 'Keeper of the family tree.',
  });
  const maya = add('Maya', 'Morgan', 'female', '1991-09-03', { birthPlace: 'Leicester', birthName: 'Patel' });
  marry(alex, maya);
  const leo = add('Leo', 'Morgan', 'male', '2018-06-21');
  const isla = add('Isla', 'Morgan', 'female', '2021-11-02');
  child(leo, alex, maya);
  child(isla, alex, maya);

  const robert = add('Robert', 'Morgan', 'male', '1960-02-17', { birthPlace: 'Cardiff' });
  const helen = add('Helen', 'Morgan', 'female', '1962-07-30', { birthPlace: 'Bath', birthName: 'Bennett' });
  marry(robert, helen);
  child(alex, robert, helen);
  const daniel = add('Daniel', 'Morgan', 'male', '1987-01-08');
  const emma = add('Emma', 'Morgan', 'female', '1994-12-19');
  child(daniel, robert, helen);
  child(emma, robert, helen);
  const sofia = add('Sofia', 'Morgan', 'female', '1988-05-25');
  marry(daniel, sofia);
  const noah = add('Noah', 'Morgan', 'male', '2015-03-14');
  child(noah, daniel, sofia);

  const arthur = add('Arthur', 'Morgan', 'male', '1932-10-05', {
    deathDate: '2010-01-22',
    birthPlace: 'Cardiff',
    notes: 'Worked on the railways for forty years.',
  });
  const margaret = add('Margaret', 'Morgan', 'female', '1935-03-11', { deathDate: '2018-08-09' });
  marry(arthur, margaret);
  child(robert, arthur, margaret);
  const susan = add('Susan', 'Clarke', 'female', '1964-06-02', { birthName: 'Morgan' });
  child(susan, arthur, margaret);

  const george = add('George', 'Bennett', 'male', '1934-12-01', { deathDate: '2005-04-18' });
  const ruth = add('Ruth', 'Bennett', 'female', '1938-08-27', {
    birthPlace: 'Bath',
    notes: 'Taught piano to half the street.',
  });
  marry(george, ruth);
  child(helen, george, ruth);

  const raj = add('Raj', 'Patel', 'male', '1958-11-14', { birthPlace: 'Ahmedabad' });
  const anita = add('Anita', 'Patel', 'female', '1961-04-06');
  marry(raj, anita);
  child(maya, raj, anita);
  const kiran = add('Kiran', 'Patel', 'male', '1988-02-28');
  child(kiran, raj, anita);

  return tree;
}
