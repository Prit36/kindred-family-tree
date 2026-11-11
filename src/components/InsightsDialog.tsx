import { useMemo, useState } from 'react';
import { CalendarHeart, CircleAlert, CircleCheck, Flower2, Info, TriangleAlert, X } from 'lucide-react';
import { useStore, type InsightsTab } from '../store';
import {
  checkTree,
  loadDismissed,
  saveDismissed,
  upcomingDates,
  type Issue,
  type Upcoming,
} from '../lib/insights';
import { displayName } from '../lib/tree';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

function dayLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  return `In ${Math.round(days / 7) === 1 ? 'a week' : `${Math.round(days / 7)} weeks`}`;
}

function describe(u: Upcoming): string {
  if (u.kind === 'birthday') {
    if (u.years === null) return 'Birthday';
    return `Turns ${u.years}`;
  }
  if (u.years === null) return 'Anniversary of their death';
  return u.years === 0 ? 'Died this day' : `Died ${u.years} year${u.years === 1 ? '' : 's'} ago`;
}

/** Birthdays that end in 0 (and 18 and 21) are worth calling out. */
const milestone = (u: Upcoming) => u.kind === 'birthday' && u.years !== null && (u.years % 10 === 0 || u.years === 18 || u.years === 21);

const SEVERITY_ICON = {
  problem: <CircleAlert size={16} />,
  warning: <TriangleAlert size={16} />,
  tip: <Info size={16} />,
};

export function InsightsDialog({ tab: initialTab }: { tab: InsightsTab }) {
  const tree = useStore((s) => s.tree);
  const { closeDialog, select, compare } = useStore.getState();
  const [tab, setTab] = useState<InsightsTab>(initialTab);
  const [dismissed, setDismissed] = useState(loadDismissed);

  const upcoming = useMemo(() => upcomingDates(tree), [tree]);
  const allIssues = useMemo(() => checkTree(tree), [tree]);
  const issues = allIssues.filter((i) => !dismissed.has(i.key));
  const hidden = allIssues.length - issues.length;

  const show = (ids: string[]) => {
    closeDialog();
    select(ids[0], true);
    if (ids[1]) compare(ids[1]);
  };

  const dismiss = (issue: Issue) => {
    // Only keep keys for issues that still exist, so the list doesn't grow forever.
    const next = new Set([...dismissed].filter((k) => allIssues.some((i) => i.key === k)));
    next.add(issue.key);
    saveDismissed(next);
    setDismissed(next);
  };

  const restore = () => {
    saveDismissed(new Set());
    setDismissed(new Set());
  };

  return (
    <Modal title="Family calendar & checks" onClose={closeDialog} width={520}>
      <div className="insights">
        <div className="insights-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upcoming'}
            className={`insights-tab${tab === 'upcoming' ? ' is-active' : ''}`}
            onClick={() => setTab('upcoming')}
          >
            <CalendarHeart size={15} /> Coming up
            {upcoming.length > 0 && <span className="insights-count">{upcoming.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'checks'}
            className={`insights-tab${tab === 'checks' ? ' is-active' : ''}`}
            onClick={() => setTab('checks')}
          >
            <CircleCheck size={15} /> Checks
            {issues.length > 0 && <span className="insights-count">{issues.length}</span>}
          </button>
        </div>

        {tab === 'upcoming' ? (
          <div className="insights-body" role="tabpanel">
            {upcoming.length === 0 ? (
              <p className="insights-empty">No birthdays or anniversaries in the next 30 days.</p>
            ) : (
              <ul className="insights-list">
                {upcoming.map((u) => (
                  <li key={`${u.kind}-${u.person.id}`}>
                    <button
                      type="button"
                      className={`insights-row${u.daysAway === 0 ? ' is-today' : ''}`}
                      onClick={() => show([u.person.id])}
                    >
                      <Avatar person={u.person} size={36} />
                      <span className="insights-main">
                        <span className="insights-name">{displayName(u.person)}</span>
                        <span className="insights-sub">
                          {u.kind === 'remembrance' && <Flower2 size={12} aria-label="In memory" />}
                          {describe(u)}
                          {milestone(u) && <span className="insights-milestone">Milestone</span>}
                        </span>
                      </span>
                      <span className="insights-when">
                        <strong>{dayLabel(u.daysAway)}</strong>
                        <span>{u.when}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="insights-body" role="tabpanel">
            {issues.length === 0 ? (
              <p className="insights-empty insights-ok">
                <CircleCheck size={18} /> Nothing looks wrong - dates and relationships are consistent.
              </p>
            ) : (
              <ul className="insights-list">
                {issues.map((issue) => (
                  <li key={issue.key} className="insights-issue">
                    <button type="button" className={`insights-row sev-${issue.severity}`} onClick={() => show(issue.personIds)}>
                      <span className="insights-sev" aria-label={issue.severity}>
                        {SEVERITY_ICON[issue.severity]}
                      </span>
                      <span className="insights-main">
                        <span className="insights-msg">{issue.message}</span>
                      </span>
                    </button>
                    {issue.severity !== 'problem' && (
                      <button
                        type="button"
                        className="icon-btn insights-dismiss"
                        aria-label="Not a problem - hide this"
                        data-tip="Not a problem"
                        onClick={() => dismiss(issue)}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {hidden > 0 && (
              <p className="insights-note">
                {hidden} hidden as not a problem.{' '}
                <button type="button" className="link-btn" onClick={restore}>
                  Show them again
                </button>
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
