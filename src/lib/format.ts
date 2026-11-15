/** Counts as shown everywhere in the app: "2,786", so big trees read the same in every corner. */
export const num = (n: number) => n.toLocaleString();

/** "1 person", "2,786 people". */
export const countPeople = (n: number) => `${num(n)} ${n === 1 ? 'person' : 'people'}`;
