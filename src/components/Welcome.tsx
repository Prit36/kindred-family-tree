import { Sparkles, UserPlus } from 'lucide-react';
import { useStore } from '../store';
import { loadSample, pickBackupFile } from '../lib/actions';

export function Welcome() {
  const openDialog = useStore((s) => s.openDialog);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <svg className="welcome-art" viewBox="0 0 220 120" aria-hidden="true">
          <g fill="none" stroke="var(--link)" strokeWidth="2" strokeLinecap="round">
            <path d="M82 28h56" />
            <path d="M110 28v28M110 56H50a8 8 0 0 0-8 8v16M110 56h60a8 8 0 0 1 8 8v16M110 56v24" />
          </g>
          <circle cx="68" cy="28" r="15" fill="var(--male-soft)" stroke="var(--male)" strokeWidth="2" />
          <circle cx="152" cy="28" r="15" fill="var(--female-soft)" stroke="var(--female)" strokeWidth="2" />
          <circle cx="110" cy="28" r="4" fill="var(--link)" />
          <circle cx="42" cy="96" r="15" fill="var(--female-soft)" stroke="var(--female)" strokeWidth="2" />
          <circle cx="110" cy="96" r="17" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2.5" />
          <circle cx="178" cy="96" r="15" fill="var(--male-soft)" stroke="var(--male)" strokeWidth="2" />
        </svg>
        <h1>Start your family tree</h1>
        <p>
          Add yourself first, then grow the tree outward - parents, siblings, your partner and their family, children.
          Everything is saved on this device.
        </p>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => openDialog({ type: 'first' })}>
            <UserPlus size={17} /> Add yourself
          </button>
          <button type="button" className="btn btn-lg" onClick={loadSample}>
            <Sparkles size={16} /> Explore a sample family
          </button>
        </div>
        <button type="button" className="link-btn" onClick={pickBackupFile}>
          Import a backup or GEDCOM file
        </button>
      </div>
    </div>
  );
}
