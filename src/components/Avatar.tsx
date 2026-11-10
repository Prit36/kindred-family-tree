import type { Person } from '../types';
import { initials } from '../lib/tree';

interface Props {
  person: Pick<Person, 'firstName' | 'lastName' | 'gender' | 'photo' | 'deceased'>;
  size?: number;
}

export function Avatar({ person, size = 48 }: Props) {
  return (
    <span
      className={`avatar g-${person.gender}${person.deceased ? ' is-deceased' : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {person.photo ? <img src={person.photo} alt="" draggable={false} /> : initials(person)}
    </span>
  );
}
