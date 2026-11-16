import { useMemo, useState, type ReactNode } from 'react';
import { CalendarHeart, CircleCheck, Sprout, X } from 'lucide-react';
import { useStore, type InsightsTab } from '../store';
import { addDays, birthdayBook, onDay, today } from '../lib/almanac';
import { checkTree, loadDismissed, saveDismissed, type Issue, type Severity } from '../lib/insights';
import { num } from '../lib/format';
import { isPlaceholder } from '../lib/tree';
import { AHEAD, ComingUp, FamilyNumbers } from './Almanac';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

const GROUPS: { severity: Severity; title: string }[] = [
  { severity: 'problem', title: "Can't both be true" },
  { severity: 'warning', title: 'Worth a second look' },
  { severity: 'tip', title: 'Still to fill in' },
];

function Checks({ onShow }: { onShow: (ids: string[]) => void }) {
  const tree = useStore((s) => s.tree);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const allIssues = useMemo(() => checkTree(tree), [tree]);
  const issues = allIssues.filter((i) => !dismissed.has(i.key));
  const hidden = allIssues.length - issues.length;

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

  // How much of the family the checks touch: one strip, a slice for each kind.
  const people = Object.values(tree.people).filter((p) => !isPlaceholder(p)).length;
  const flagged = (severity: Severity) =>
    new Set(issues.filter((i) => i.severity === severity).flatMap((i) => i.personIds)).size;
  const touched = new Set(issues.flatMap((i) => i.personIds)).size;
  const clear = Math.max(0, people - touched);

  return (
    <div className="almanac-pane checks" role="tabpanel">
      {issues.length === 0 ? (
        <p className="insights-empty insights-ok">
          <CircleCheck size={18} /> Nothing looks wrong - dates and relationships are consistent.
        </p>
      ) : (
        <>
          <div className="checks-health">
            <div className="checks-meter" aria-hidden="true">
              {GROUPS.map(({ severity }) => {
                const count = flagged(severity);
                return count > 0 && <i key={severity} className={`sev-${severity}`} style={{ flexGrow: count }} />;
              })}
              <i className="is-clear" style={{ flexGrow: clear }} />
            </div>
            <p>
              <b>{num(clear)}</b> of {num(people)} people have nothing flagged
            </p>
          </div>

          {GROUPS.map(({ severity, title }) => {
            const group = issues.filter((i) => i.severity === severity);
            if (group.length === 0) return null;
            return (
              <section key={severity} className={`checks-group sev-${severity}`}>
                <h3 className="alm-h">
                  <span className="checks-dot" aria-hidden="true" />
                  {title} <span className="alm-more">{group.length}</span>
                </h3>
                <ul className="insights-list">
                  {group.map((issue) => (
                    <li key={issue.key} className="insights-issue">
                      <button type="button" className="insights-row" onClick={() => onShow(issue.personIds)}>
                        <span className="checks-who">
                          {issue.personIds.slice(0, 2).map((id) => tree.people[id] && <Avatar key={id} person={tree.people[id]} size={26} />)}
                        </span>
                        <span className="insights-msg">{issue.message}</span>
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
              </section>
            );
          })}
        </>
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
  );
}

export function InsightsDialog({ tab: initialTab }: { tab: InsightsTab }) {
  const tree = useStore((s) => s.tree);
  const { closeDialog, select, compare } = useStore.getState();
  const [tab, setTab] = useState<InsightsTab>(initialTab);

  const upcoming = useMemo(() => {
    const book = birthdayBook(tree);
    const from = today();
    let count = 0;
    for (let i = 0; i <= AHEAD; i++) count += onDay(book, addDays(from, i)).length;
    return count;
  }, [tree]);
  const issueCount = useMemo(() => {
    const dismissed = loadDismissed();
    return checkTree(tree).filter((i) => !dismissed.has(i.key)).length;
  }, [tree]);

  const show = (ids: string[]) => {
    closeDialog();
    select(ids[0], true);
    if (ids[1]) compare(ids[1]);
  };

  const tabButton = (value: InsightsTab, label: string, icon: ReactNode, count?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      className={`insights-tab${tab === value ? ' is-active' : ''}`}
      onClick={() => setTab(value)}
    >
      {icon} {label}
      {count !== undefined && count > 0 && <span className="insights-count">{num(count)}</span>}
    </button>
  );

  return (
    <Modal title="Family almanac" onClose={closeDialog} width={780}>
      <div className="insights">
        <div className="insights-tabs" role="tablist">
          {tabButton('upcoming', 'Coming up', <CalendarHeart size={15} />, upcoming)}
          {tabButton('family', 'In numbers', <Sprout size={15} />)}
          {tabButton('checks', 'Checks', <CircleCheck size={15} />, tab === 'checks' ? undefined : issueCount)}
        </div>

        {tab === 'upcoming' ? <ComingUp onShow={show} /> : tab === 'family' ? <FamilyNumbers onShow={show} /> : <Checks onShow={show} />}
      </div>
    </Modal>
  );
}
