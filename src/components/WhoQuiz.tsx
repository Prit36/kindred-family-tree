import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Check, Flame, Layers, Play, RotateCcw, Trophy, X } from 'lucide-react';
import { useStore } from '../store';
import { cardStats, meaningFor } from '../lib/cards';
import { confetti, confettiFrom } from '../lib/confetti';
import { relationLabels, type Naming } from '../lib/naming';
import { ROUND, clueFor, makeRound, rng, verdict, type Question } from '../lib/quiz';
import { pathBetween, shortName } from '../lib/tree';
import { Avatar } from './Avatar';
import { useCountUp } from './CountUp';
import { CardBackPattern, FamilyCard } from './FamilyCard';

type Phase = 'intro' | 'play' | 'done';

/** How much a right answer is worth: more the longer the streak runs. */
const multiplier = (streak: number) => (streak >= 6 ? 3 : streak >= 3 ? 2 : 1);

function question(name: string, naming: Naming) {
  if (naming === 'gu') return <>{name} <span className="quiz-q-soft">તમારા શું થાય?</span></>;
  if (naming === 'gu-latn') return <>{name} <span className="quiz-q-soft">tamara shu thay?</span></>;
  return <><span className="quiz-q-soft">Who is</span> {name} <span className="quiz-q-soft">to you?</span></>;
}

/** You → Father → Uncle → Cousin: how the answer is reached, a step at a time. */
function Chain({ id }: { id: string }) {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const labels = relationLabels(tree, naming);
  const path = tree.homeId ? pathBetween(tree, tree.homeId, id) : null;
  if (!path || path.length < 2) return null;
  return (
    <ol className="quiz-chain">
      {path.map((pid, i) => {
        const p = tree.people[pid];
        return (
          <li key={pid} style={{ '--i': i } as CSSProperties}>
            {i > 0 && <ArrowRight size={12} className="quiz-chain-arrow" />}
            <Avatar person={p} size={22} />
            <span className="quiz-chain-text">
              <span className="quiz-chain-name">{shortName(p)}</span>
              <span className="quiz-chain-kin">{labels.get(pid) ?? ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Score({ value }: { value: number }) {
  const n = useCountUp(value, 500);
  return <span className="quiz-score-n">{n.toLocaleString()}</span>;
}

export function WhoQuiz({
  pool,
  known,
  best,
  onKnown,
  onRoundEnd,
  onCollection,
}: {
  pool: string[];
  known: ReadonlySet<string>;
  best: number;
  onKnown: (ids: string[]) => void;
  onRoundEnd: (bestStreak: number) => void;
  onCollection: () => void;
}) {
  const tree = useStore((s) => s.tree);
  const naming = useStore((s) => s.naming);
  const labels = relationLabels(tree, naming);
  const meaning = useMemo(() => meaningFor(tree, naming), [tree, naming]);
  const stats = cardStats(tree);

  const [phase, setPhase] = useState<Phase>('intro');
  const [qs, setQs] = useState<Question[]>([]);
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [topStreak, setTopStreak] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [gain, setGain] = useState<{ n: number; key: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const askable = useMemo(
    () => pool.filter((id) => id !== tree.homeId && labels.get(id) && stats.get(id)?.dist != null).length,
    [pool, tree, labels, stats],
  );

  const start = useCallback(() => {
    // Words in every language, so no two choices read the same whichever is on.
    const wordings = [labels, relationLabels(tree, 'en'), relationLabels(tree, 'gu')];
    const round = makeRound(tree, pool, wordings, known, rng());
    setQs(round);
    setAt(0);
    setPicked(null);
    setScore(0);
    setStreak(0);
    setTopStreak(0);
    setResults([]);
    setGain(null);
    setPhase(round.length ? 'play' : 'intro');
  }, [tree, pool, labels, known]);

  const q = phase === 'play' ? qs[at] : undefined;

  const choose = useCallback(
    (choice: string) => {
      if (!q || picked) return;
      setPicked(choice);
      const right = choice === q.id;
      setResults((r) => [...r, right]);
      if (right) {
        const s = streak + 1;
        const points = 100 * multiplier(s);
        setStreak(s);
        setTopStreak((t) => Math.max(t, s));
        setScore((v) => v + points);
        setGain({ n: points, key: Date.now() });
        onKnown([q.id]);
        confettiFrom(cardRef.current, { count: s >= 3 ? 120 : 70 });
      } else {
        setStreak(0);
        const el = cardRef.current;
        el?.classList.remove('is-shaking');
        void el?.offsetWidth;
        el?.classList.add('is-shaking');
      }
      // The next button takes the keyboard, so Enter moves on.
      requestAnimationFrame(() => nextRef.current?.focus({ preventScroll: true }));
    },
    [q, picked, streak, onKnown],
  );

  const next = useCallback(() => {
    if (!picked) return;
    if (at + 1 >= qs.length) {
      setPhase('done');
      onRoundEnd(topStreak);
      const right = results.filter(Boolean).length;
      if (right === qs.length) {
        // A perfect round: paper from both sides of the screen.
        confetti(window.innerWidth * 0.2, window.innerHeight * 0.75, { count: 160, power: 1.3 });
        confetti(window.innerWidth * 0.8, window.innerHeight * 0.75, { count: 160, power: 1.3 });
      }
      return;
    }
    setAt((i) => i + 1);
    setPicked(null);
  }, [picked, at, qs.length, onRoundEnd, topStreak, results]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (useStore.getState().dialog || el.closest('input, textarea, select')) return;
      if (phase === 'play' && q && !picked && /^[1-4]$/.test(e.key)) {
        const c = q.choices[Number(e.key) - 1];
        if (c) choose(c);
      } else if (phase === 'play' && picked && (e.key === 'Enter' || e.key === ' ') && !el.closest('button')) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, q, picked, choose, next]);

  if (!tree.homeId || !tree.people[tree.homeId]) {
    return (
      <div className="quiz">
        <div className="quiz-intro">
          <h2 className="quiz-title">Who's who?</h2>
          <p className="quiz-lead">Mark someone as “This is me” in their details first: the questions are about how everyone is related to you.</p>
        </div>
      </div>
    );
  }

  if (phase === 'intro') {
    const knownHere = pool.filter((id) => known.has(id)).length;
    return (
      <div className="quiz">
        <div className="quiz-intro">
          <div className="quiz-stack" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="quiz-stack-card" style={{ '--i': i } as CSSProperties}>
                <CardBackPattern title={i === 3 ? tree.name : undefined} />
              </div>
            ))}
          </div>
          <h2 className="quiz-title">Who's who?</h2>
          <p className="quiz-lead">
            {Math.min(ROUND, askable)} relatives, one question each: what are they to you?
          </p>
          <div className="quiz-meta">
            <span>
              <Layers size={14} />
              {knownHere} of {pool.length} known
            </span>
            {best > 0 && (
              <span>
                <Flame size={14} />
                Best streak {best}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-primary quiz-start" onClick={start} disabled={askable === 0} autoFocus>
            <Play size={15} />
            Deal the cards
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const right = results.filter(Boolean).length;
    const won = qs.filter((_, i) => results[i]);
    return (
      <div className="quiz">
        <div className="quiz-done">
          <Trophy size={34} className="quiz-trophy" />
          <div className="quiz-final">
            <Score value={right} />
            <span className="quiz-final-of">/ {qs.length}</span>
          </div>
          <p className="quiz-lead">{verdict(right, qs.length)}</p>
          <div className="quiz-meta">
            <span>
              <Trophy size={14} />
              {score.toLocaleString()} points
            </span>
            <span>
              <Flame size={14} />
              Longest streak {topStreak}
            </span>
          </div>
          {won.length > 0 && (
            <div className="quiz-won" aria-label="Cards you named">
              {won.map((w, i) => (
                <FamilyCard
                  key={w.id}
                  person={tree.people[w.id]}
                  stats={stats.get(w.id)!}
                  kin={labels.get(w.id) ?? ''}
                  known
                  className="quiz-won-card"
                  style={
                    {
                      '--i': i,
                      '--rot': `${(i - (won.length - 1) / 2) * 6}deg`,
                      '--dy': `${Math.abs(i - (won.length - 1) / 2) ** 1.6 * 4}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          )}
          <div className="quiz-actions">
            <button type="button" className="btn btn-primary" onClick={start} autoFocus>
              <RotateCcw size={15} />
              Play again
            </button>
            <button type="button" className="btn" onClick={onCollection}>
              <Layers size={15} />
              See the collection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!q) return null;
  const person = tree.people[q.id];
  const right = picked === q.id;
  const answer = labels.get(q.id) ?? '';
  const qMeaning = meaning(q.id);
  const clue = clueFor(tree, person);

  return (
    <div className="quiz">
      <div className="quiz-top">
        <ol className="quiz-dots" aria-label={`Question ${at + 1} of ${qs.length}`}>
          {qs.map((_, i) => (
            <li
              key={i}
              className={i === at ? 'is-now' : results[i] === true ? 'is-right' : results[i] === false ? 'is-wrong' : ''}
            />
          ))}
        </ol>
        <span className={`quiz-streak${streak >= 3 ? ' is-hot' : ''}`} key={`s${streak}`} data-tip="Streak">
          <Flame size={16} />
          {streak}
          {multiplier(streak) > 1 && <span className="quiz-mult">×{multiplier(streak)}</span>}
        </span>
        <span className="quiz-score">
          <Score value={score} />
          {gain && (
            <span className="quiz-gain" key={gain.key}>
              +{gain.n}
            </span>
          )}
        </span>
      </div>

      <div className="quiz-stage">
        <div className="quiz-card-slot">
          <div className="quiz-deck" aria-hidden="true">
            {Array.from({ length: Math.min(4, qs.length - at - 1) }, (_, i) => (
              <div key={i} className="quiz-deck-card" style={{ '--i': i } as CSSProperties}>
                <CardBackPattern />
              </div>
            ))}
          </div>
          <FamilyCard
            key={q.id}
            ref={cardRef}
            person={person}
            stats={stats.get(q.id)!}
            kin={answer}
            meaning={picked ? qMeaning : undefined}
            hideKin={!picked}
            known={picked ? right : known.has(q.id)}
            tilt
            className={`quiz-card${picked ? (right ? ' is-right' : ' is-wrong') : ''}`}
          />
        </div>

        <div className="quiz-ask" key={`a${q.id}`}>
          <h2 className="quiz-q">{question(shortName(person), naming)}</h2>
          {clue && <p className="quiz-clue">{clue}</p>}
          <div className="quiz-choices" role="group" aria-label="Answers">
            {q.choices.map((c, i) => {
              const state = !picked ? '' : c === q.id ? ' is-answer' : c === picked ? ' is-picked' : ' is-out';
              return (
                <button
                  key={c}
                  type="button"
                  className={`quiz-choice${state}`}
                  style={{ '--i': i } as CSSProperties}
                  disabled={Boolean(picked)}
                  onClick={() => choose(c)}
                  data-tip={picked ? undefined : `Answer ${i + 1}`}
                >
                  <span className="quiz-choice-key" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="quiz-choice-text">{labels.get(c) ?? ''}</span>
                  {picked && c === q.id && <Check size={16} className="quiz-choice-mark" />}
                  {picked && c === picked && c !== q.id && <X size={16} className="quiz-choice-mark" />}
                </button>
              );
            })}
          </div>

          {picked && (
            <div className={`quiz-reveal${right ? ' is-right' : ' is-wrong'}`}>
              <p className="quiz-verdict">
                {right ? (streak >= 3 ? `${streak} in a row!` : 'Right!') : <>They're your <strong>{answer}</strong></>}
                {qMeaning && <span className="quiz-meaning">{qMeaning}</span>}
              </p>
              <Chain id={q.id} />
              <button type="button" className="btn btn-primary quiz-next" onClick={next} ref={nextRef}>
                {at + 1 >= qs.length ? 'See how you did' : 'Next card'}
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
