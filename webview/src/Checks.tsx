import type { ViewState } from '../../src/core/messages';
import type { Finding } from '../../src/core/types';
import { post } from './vscode';

const AREAS: { id: Finding['area']; label: string }[] = [
  { id: 'structure', label: 'Structure' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'efficiency', label: 'Efficiency' },
  { id: 'portability', label: 'Portability' },
  { id: 'docs', label: 'Docs' },
];

export function Checks({ state, onSelectNode }: { state: ViewState; onSelectNode: (id: string) => void }) {
  if (!state.findings.length) {
    return (
      <div className="all-clear">
        <span className="codicon codicon-pass" />
        <div>All checks pass.</div>
      </div>
    );
  }
  return (
    <div className="checks">
      {AREAS.map(({ id, label }) => {
        const items = state.findings.filter((f) => f.area === id);
        if (!items.length) return null;
        return (
          <section key={id}>
            <div className="sec-title">{label} <span className="muted">{items.length}</span></div>
            <ul className="finding-list">
              {items.map((f, i) => (
                <li key={i} className={f.severity}>
                  <span className={`codicon codicon-${f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'info'}`} />
                  <div>
                    <div>{f.message}</div>
                    <div className="row">
                      {f.nodeId && <button className="link" onClick={() => onSelectNode(f.nodeId!)}>Show on canvas</button>}
                      {f.file && <button className="link" onClick={() => post({ type: 'openFinding', finding: f })}>Open {f.file.split('/').pop()}</button>}
                      {f.proposalKey && <button className="link" onClick={() => post({ type: 'proposal', key: f.proposalKey!, action: 'preview' })}>Review fix</button>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
