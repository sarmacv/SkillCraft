import { useState } from 'react';
import type { CoachQuestion, ViewState } from '../../src/core/messages';
import { post } from './vscode';

function Question({ q }: { q: CoachQuestion }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const send = (text: string) => {
    if (!text.trim()) {
      setError('Type an answer, pick an option, or let the coach decide.');
      return;
    }
    post({ type: 'coachAnswer', id: q.id, answer: text.trim() });
  };
  return (
    <li className="question">
      <div className="q-area">{q.area}</div>
      <div className="q-text">{q.question}</div>
      {q.why && <div className="q-why">{q.why}</div>}
      {q.options && q.options.length > 0 && (
        <div className="chips">
          {q.options.map((o) => <button key={o} className="chip" onClick={() => send(o)}>{o}</button>)}
        </div>
      )}
      <textarea
        rows={2}
        value={answer}
        aria-label="Your answer"
        placeholder="Your answer…"
        onChange={(e) => { setAnswer(e.target.value); setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(answer); }}
      />
      {error && <div className="field-error">{error}</div>}
      <div className="row">
        <button className="primary" onClick={() => send(answer)}>Answer</button>
        <button onClick={() => post({ type: 'coachAnswer', id: q.id, decide: true })} title={q.suggestion ? `Proposes: ${q.suggestion}` : 'The coach proposes a sensible default for you to review'}>
          <span className="codicon codicon-sparkle" /> Decide for me
        </button>
        <button className="link" onClick={() => post({ type: 'coachAnswer', id: q.id, skip: true })}>Skip</button>
      </div>
    </li>
  );
}

export function Coach({ state }: { state: ViewState }) {
  return (
    <div className="coach">
      <p className="muted">The coach reviews your skill and asks questions to make it better. Answers turn into proposals — nothing changes until you accept.</p>
      <button className="block" disabled={state.coachBusy} onClick={() => post({ type: 'command', command: 'coach' })}>
        <span className={`codicon codicon-${state.coachBusy ? 'loading codicon-modifier-spin' : 'sparkle'}`} />
        {state.coachBusy ? 'Reviewing…' : 'Review my skill'}
      </button>
      {state.coach.length === 0 && !state.coachBusy && <p className="empty-note">No open questions. Ask for a review any time — the coach also checks in at milestones.</p>}
      <ul className="questions">
        {state.coach.map((q) => <Question key={q.id} q={q} />)}
      </ul>
    </div>
  );
}
