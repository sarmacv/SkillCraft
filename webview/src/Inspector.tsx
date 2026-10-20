import { useEffect, useState } from 'react';
import { CATALOG, CATEGORY_META, categoryOf, getComponent, isPlaceholder, type FieldDef } from '../../src/core/catalog';
import type { ViewState } from '../../src/core/messages';
import type { Finding, TargetId, WorkflowNode } from '../../src/core/types';
import type { TargetView } from './App';
import { TARGET_LABEL } from './Header';
import { post } from './vscode';

type Props = {
  state: ViewState;
  node?: WorkflowNode;
  target: TargetView;
  findings: Finding[];
  testResult?: { ok: boolean; detail: string };
  onChange: (id: string, patch: Partial<WorkflowNode>) => void;
  onDelete: (id: string) => void;
};

export function Inspector(props: Props) {
  return props.node ? <NodeInspector {...props} node={props.node} /> : <ProjectPanel state={props.state} />;
}

function Field({ field, value, onChange }: { field: FieldDef; value: unknown; onChange: (v: string | number | boolean) => void }) {
  const [local, setLocal] = useState(String(value ?? ''));
  useEffect(() => setLocal(String(value ?? '')), [value]);
  const id = `f-${field.key}`;
  const commit = () => local !== String(value ?? '') && onChange(field.type === 'number' ? Number(local) : local);
  const envBad = field.type === 'env' && local !== '' && !/^[A-Z_][A-Z0-9_]*$/.test(local);
  return (
    <div className="field">
      <label htmlFor={id}>
        {field.label}
        {field.required && <span className="req" aria-label="required">*</span>}
      </label>
      {field.type === 'textarea' ? (
        <textarea id={id} rows={3} value={local} placeholder={field.placeholder} onChange={(e) => setLocal(e.target.value)} onBlur={commit} />
      ) : field.type === 'select' ? (
        <select id={id} value={local} onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}>
          <option value="">Choose…</option>
          {field.options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : field.type === 'boolean' ? (
        <input id={id} type="checkbox" checked={local === 'true'} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <div className={field.type === 'env' ? 'env-input' : ''}>
          {field.type === 'env' && <span className="env-prefix">$</span>}
          <input
            id={id}
            type={field.type === 'number' ? 'number' : 'text'}
            value={local}
            placeholder={field.placeholder}
            onChange={(e) => setLocal(field.type === 'env' ? e.target.value.toUpperCase() : e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </div>
      )}
      {envBad && <div className="field-error">Use capital letters, digits and underscores, like JIRA_API_TOKEN.</div>}
      {field.help && !envBad && <div className="help">{field.help}</div>}
    </div>
  );
}

function NodeInspector({ state, node, target, findings, testResult, onChange, onDelete }: Props & { node: WorkflowNode }) {
  const cat = categoryOf(node.type);
  const def = getComponent(node.type);
  const placeholder = isPlaceholder(node.type);
  const t = target === 'all' ? undefined : (target as TargetId);
  const sameCategory = CATALOG.filter((c) => c.category === cat);
  const override = t ? node.targetOverrides?.[t] : undefined;
  const overrideDef = override ? getComponent(override.type) : undefined;
  const testable = ['source.rest', 'source.web', 'source.graphql', 'source.knowledge'].includes(node.type);
  const [testing, setTesting] = useState(false);
  useEffect(() => setTesting(false), [testResult]);

  const setConfig = (key: string, v: string | number | boolean) => onChange(node.id, { config: { ...node.config, [key]: v } });

  return (
    <div className="inspector">
      <div className={`insp-head cat-${cat}`}>
        <span className={`codicon codicon-${placeholder ? 'question' : def?.icon ?? 'circle-outline'}`} />
        <div>
          <div className="insp-cat">{CATEGORY_META[cat].label.replace(/s$/, '')}</div>
          <input className="insp-title" aria-label="Name" value={node.label} onChange={(e) => onChange(node.id, { label: e.target.value })} />
        </div>
      </div>

      {node.inferred && !node.inferred.confirmed && (
        <div className="callout info">
          <span className="codicon codicon-search" />
          <div>
            <b>Inferred from your skill</b> ({Math.round(node.inferred.confidence * 100)}% sure) — {node.inferred.evidence}.
            <div className="row">
              <button onClick={() => onChange(node.id, { inferred: { ...node.inferred!, confirmed: true } })}><span className="codicon codicon-check" /> Looks right</button>
              <span className="muted">or correct the details below</span>
            </div>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="type">{placeholder ? 'What kind of component is this?' : 'Component type'}</label>
        <select id="type" value={placeholder ? '' : node.type} onChange={(e) => onChange(node.id, { type: e.target.value, label: node.label === def?.label || /^New \w+$/.test(node.label) ? getComponent(e.target.value)?.label ?? node.label : node.label })}>
          {placeholder && <option value="">Choose…</option>}
          {sameCategory.map((c) => <option key={c.id} value={c.id}>{c.label} — {c.summary}</option>)}
        </select>
      </div>

      {findings.length > 0 && (
        <ul className="finding-list">
          {findings.map((f, i) => (
            <li key={i} className={f.severity}><span className={`codicon codicon-${f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'info'}`} />{f.message}</li>
          ))}
        </ul>
      )}

      {def?.fields.map((f) => <Field key={f.key} field={f} value={node.config[f.key]} onChange={(v) => setConfig(f.key, v)} />)}

      {testable && (
        <div className="test-node">
          <button onClick={() => { setTesting(true); post({ type: 'testNode', nodeId: node.id }); }} disabled={testing}>
            <span className={`codicon codicon-${testing ? 'loading codicon-modifier-spin' : 'play'}`} /> Test this source
          </button>
          {testResult && <pre className={testResult.ok ? 'ok' : 'bad'}>{testResult.detail}</pre>}
        </div>
      )}

      {node.type === 'module.script' && (
        <label className="check">
          <input type="checkbox" checked={!!node.customCode} onChange={(e) => onChange(node.id, { customCode: e.target.checked })} />
          I'll write this code myself (don't regenerate it)
        </label>
      )}

      {def && (
        <div className="support">
          <div className="sec-title">Works in</div>
          {(state.project?.targets ?? []).map((tg) => {
            const s = def.support[tg];
            return (
              <div key={tg} className={`support-row ${s}`}>
                <span className={`codicon codicon-${s === 'yes' ? 'pass' : s === 'setup' ? 'tools' : 'circle-slash'}`} />
                {TARGET_LABEL[tg]} <span className="muted">{s === 'yes' ? 'ready' : s === 'setup' ? 'needs setup — covered in SETUP.md' : 'not supported'}</span>
              </div>
            );
          })}
        </div>
      )}

      {t && !placeholder && (
        <div className="override">
          <div className="sec-title">Only for {TARGET_LABEL[t]}</div>
          <label className="check">
            <input
              type="checkbox"
              checked={!!node.excludeTargets?.includes(t)}
              onChange={(e) => onChange(node.id, { excludeTargets: e.target.checked ? [...(node.excludeTargets ?? []), t] : (node.excludeTargets ?? []).filter((x) => x !== t) })}
            />
            Leave this out of the {TARGET_LABEL[t]} build
          </label>
          <div className="field">
            <label htmlFor="ovr">Use a different component in {TARGET_LABEL[t]}</label>
            <select
              id="ovr"
              value={override?.type ?? ''}
              onChange={(e) => {
                const rest = { ...(node.targetOverrides ?? {}) };
                if (e.target.value) rest[t] = { type: e.target.value, config: {} };
                else delete rest[t];
                onChange(node.id, { targetOverrides: rest });
              }}
            >
              <option value="">Same as everywhere</option>
              {sameCategory.filter((c) => c.id !== node.type).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          {overrideDef?.fields.map((f) => (
            <Field
              key={`o-${f.key}`}
              field={f}
              value={override?.config[f.key]}
              onChange={(v) => onChange(node.id, { targetOverrides: { ...node.targetOverrides, [t]: { type: override!.type, config: { ...override!.config, [f.key]: v } } } })}
            />
          ))}
        </div>
      )}

      <div className="danger-zone">
        <button className="danger" onClick={() => onDelete(node.id)}><span className="codicon codicon-trash" /> Remove from workflow</button>
      </div>
    </div>
  );
}

function ProjectPanel({ state }: { state: ViewState }) {
  const p = state.project;
  if (!p) {
    return (
      <div className="inspector">
        <p className="muted">No SkillCraft project in this folder yet.</p>
        <button className="primary block" onClick={() => post({ type: 'command', command: 'describe' })}><span className="codicon codicon-comment-discussion" /> Describe your skill</button>
        <button className="block" onClick={() => post({ type: 'command', command: 'sketch' })}><span className="codicon codicon-type-hierarchy" /> Sketch a workflow</button>
        <button className="block" onClick={() => post({ type: 'command', command: 'import' })}><span className="codicon codicon-cloud-download" /> Import an existing skill</button>
      </div>
    );
  }
  const b = state.budget;
  const refTotal = b.references.reduce((s, r) => s + r.tokens, 0);
  const max = Math.max(5000, b.instructionTokens, b.metadataTokens * 10);
  const bar = (v: number) => `${Math.min(100, Math.round((v / max) * 100))}%`;
  const toggleTarget = (t: TargetId) => {
    const next = p.targets.includes(t) ? p.targets.filter((x) => x !== t) : [...p.targets, t];
    if (next.length) post({ type: 'config', patch: { targets: next } });
  };

  return (
    <div className="inspector">
      <div className="sec-title">Description</div>
      <p className={p.description ? 'desc' : 'muted'}>{p.description || 'No description yet. Fill in the Skill trigger, or ask the coach to draft one.'}</p>

      <div className="sec-title">Next step</div>
      <ul className="checklist">
        {state.readinessChecklist.map((c) => (
          <li key={c.label} className={c.done ? 'done' : ''}><span className={`codicon codicon-${c.done ? 'pass-filled' : 'circle-large-outline'}`} />{c.label}</li>
        ))}
      </ul>

      <div className="sec-title">Efficiency <span className={`score s${Math.floor(state.efficiencyScore / 34)}`}>{state.efficiencyScore}/100</span></div>
      <div className="budget" title="Estimated tokens the skill costs at each stage">
        <div className="brow"><span>Always loaded</span><div className="track"><div style={{ width: bar(b.metadataTokens) }} /></div><span>~{b.metadataTokens}</span></div>
        <div className="brow"><span>When triggered</span><div className="track"><div className={b.instructionTokens > 5000 ? 'over' : ''} style={{ width: bar(b.instructionTokens) }} /></div><span>~{b.instructionTokens.toLocaleString()}</span></div>
        <div className="brow"><span>On demand</span><div className="track"><div className="soft" style={{ width: bar(refTotal) }} /></div><span>~{refTotal.toLocaleString()}</span></div>
      </div>

      <div className="sec-title">Build for</div>
      {(['claude', 'codex', 'copilot'] as TargetId[]).map((t) => (
        <label key={t} className="check">
          <input type="checkbox" checked={p.targets.includes(t)} onChange={() => toggleTarget(t)} />
          {TARGET_LABEL[t]}
          {p.targets.includes(t) && <span className={`pill ${state.portability[t]}`}>{state.portability[t] === 'ok' ? 'compatible' : state.portability[t] === 'warn' ? 'check warnings' : 'needs fixes'}</span>}
        </label>
      ))}

      <div className="field">
        <label htmlFor="mode">Build mode</label>
        <select id="mode" value={p.buildMode} onChange={(e) => post({ type: 'config', patch: { buildMode: e.target.value as 'universal' | 'tailored' } })}>
          <option value="tailored">Tailored — one optimized build per tool</option>
          <option value="universal">Universal — one build that works everywhere</option>
        </select>
      </div>

      {state.modelName && <p className="muted small"><span className="codicon codicon-sparkle" /> AI: {state.modelName}</p>}
    </div>
  );
}
