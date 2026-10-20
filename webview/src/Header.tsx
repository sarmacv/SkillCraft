import type { ViewState } from '../../src/core/messages';
import type { Readiness, ScriptLanguage, TargetId } from '../../src/core/types';
import type { TargetView } from './App';
import { post } from './vscode';

const STAGES: { id: Readiness; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'runnable', label: 'Runnable' },
  { id: 'tested', label: 'Tested' },
  { id: 'ready', label: 'Ready to ship' },
];

export const TARGET_LABEL: Record<TargetId, string> = { claude: 'Claude', codex: 'Codex', copilot: 'Copilot' };

export function Header({ state, target, onTarget, onLayout }: { state: ViewState; target: TargetView; onTarget: (t: TargetView) => void; onLayout: () => void }) {
  const p = state.project;
  const stage = STAGES.findIndex((s) => s.id === state.readiness);
  const next = state.readinessChecklist.find((c) => !c.done);

  return (
    <header className="header">
      <div className="title">
        <span className="gem" aria-hidden="true" />
        <div>
          <div className="name">{p?.name ?? 'New skill'}</div>
          <div className="sub">{p ? `${p.targets.map((t) => TARGET_LABEL[t]).join(' · ')} · ${p.buildMode}` : 'No project yet'}</div>
        </div>
      </div>

      <ol className="stepper" aria-label="Readiness" title={next ? `Next: ${next.label}` : 'Ready to ship'}>
        {STAGES.map((s, i) => (
          <li key={s.id} className={i < stage ? 'done' : i === stage ? 'current' : ''}>
            <span className="dot">{i < stage ? <span className="codicon codicon-check" /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>

      <div className="controls">
        <div className="segmented" role="radiogroup" aria-label="View the skill as a target tool sees it">
          <button role="radio" aria-checked={target === 'all'} className={target === 'all' ? 'on' : ''} onClick={() => onTarget('all')}>All</button>
          {(p?.targets ?? []).map((t) => (
            <button key={t} role="radio" aria-checked={target === t} className={`${target === t ? 'on' : ''} port-${state.portability[t]}`} onClick={() => onTarget(t)} title={`See the skill as ${TARGET_LABEL[t]} will (${state.portability[t]})`}>
              {TARGET_LABEL[t]}
              {state.portability[t] !== 'ok' && <span className={`pdot ${state.portability[t]}`} />}
            </button>
          ))}
        </div>
        {p && (
          <select
            value={p.language}
            aria-label="Script language"
            title="Language for generated scripts"
            onChange={(e) => post({ type: 'config', patch: { language: e.target.value as ScriptLanguage } })}
          >
            <option value="python">Python</option>
            <option value="node">Node.js</option>
            <option value="bash">Bash</option>
          </select>
        )}
        <button className="icon" title="Tidy the layout" aria-label="Tidy the layout" onClick={onLayout}><span className="codicon codicon-layout" /></button>
        <button className="icon" title="Preview the generated SKILL.md" aria-label="Preview SKILL.md" onClick={() => post({ type: 'command', command: 'preview' })}><span className="codicon codicon-open-preview" /></button>
        <button title="Turn the workflow into files (you'll review the changes first)" onClick={() => post({ type: 'command', command: 'sync' })}><span className="codicon codicon-sync" /> Sync files</button>
        <button title="Run test cases" onClick={() => post({ type: 'command', command: 'runTests' })}><span className="codicon codicon-beaker" /> Test</button>
        <button className="primary" title="Build for every target tool" onClick={() => post({ type: 'command', command: 'build' })}><span className="codicon codicon-package" /> Build</button>
      </div>
    </header>
  );
}
