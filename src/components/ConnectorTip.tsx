import { Heart, HeartCrack, HeartHandshake, Users } from 'lucide-react';
import type { Tree, UnionStatus } from '../types';
import { kinshipFor } from '../lib/kinship';
import { displayName, shortName } from '../lib/tree';
import { compareByBirth } from '../lib/dates';

/** What a connector line on the tree stands for. */
export type Connector =
  | { kind: 'union'; a: string; b: string; status: UnionStatus; children: number }
  | { kind: 'family'; parents: string[]; children: string[] };

const STATUS: Record<UnionStatus, { label: string; icon: typeof Heart }> = {
  married: { label: 'Married', icon: Heart },
  partner: { label: 'Partners', icon: HeartHandshake },
  divorced: { label: 'Divorced', icon: HeartCrack },
};

const MAX_CHILDREN = 6;
/** Father before mother, as elsewhere in the app. */
const GENDER_ORDER = { male: 0, female: 1, other: 2 } as const;

/**
 * The card shown while resting on a connector: who the line joins and how they're
 * related to you - "Robert (Father) & Helen (Mother), married, 3 children", or
 * "Children of Robert & Helen: Alex (You), Daniel (Brother), Emma (Sister)".
 */
export function ConnectorTip({ tree, connector }: { tree: Tree; connector: Connector }) {
  const kin = kinshipFor(tree);
  const relation = (id: string) => (id === tree.homeId ? 'You' : (kin.get(id) ?? ''));
  const who = (id: string) => (
    <span className="ctip-person" key={id}>
      <strong>{shortName(tree.people[id])}</strong>
      {relation(id) && <span className="ctip-rel">{relation(id)}</span>}
    </span>
  );

  if (connector.kind === 'union') {
    const { label, icon: Icon } = STATUS[connector.status];
    const n = connector.children;
    return (
      <>
        <div className="ctip-kind">
          <Icon size={13} />
          {label}
          {n > 0 && <span className="ctip-count">· {n === 1 ? '1 child' : `${n} children`}</span>}
        </div>
        <div className="ctip-pair">
          {[connector.a, connector.b]
            .sort((x, y) => GENDER_ORDER[tree.people[x].gender] - GENDER_ORDER[tree.people[y].gender])
            .flatMap((id, i) => (i === 0 ? [who(id)] : [<span className="ctip-amp" key="amp">&amp;</span>, who(id)]))}
        </div>
      </>
    );
  }

  const children = connector.children
    .map((id) => tree.people[id])
    .filter(Boolean)
    .sort(compareByBirth);
  const shown = children.slice(0, MAX_CHILDREN);
  const more = children.length - shown.length;
  const n = children.length;
  return (
    <>
      <div className="ctip-kind">
        <Users size={13} />
        {connector.parents.length > 1 ? 'Parents' : 'Parent'} and {n === 1 ? 'child' : 'children'}
        {n > 1 && <span className="ctip-count">· {n} siblings</span>}
      </div>
      <div className="ctip-pair">
        {[...connector.parents].sort((x, y) => GENDER_ORDER[tree.people[x].gender] - GENDER_ORDER[tree.people[y].gender]).flatMap((id, i) => (i === 0 ? [who(id)] : [<span className="ctip-amp" key={`amp-${id}`}>&amp;</span>, who(id)]))}
      </div>
      <ul className="ctip-list">
        {shown.map((p) => (
          <li key={p.id} title={displayName(p)}>
            {who(p.id)}
          </li>
        ))}
        {more > 0 && <li className="ctip-more">and {more} more</li>}
      </ul>
    </>
  );
}
