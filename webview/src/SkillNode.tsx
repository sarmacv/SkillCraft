import { Handle, type NodeProps, Position, type Node } from '@xyflow/react';
import { memo } from 'react';
import { CATEGORY_META, categoryOf, getComponent, isPlaceholder } from '../../src/core/catalog';
import type { Finding, WorkflowNode } from '../../src/core/types';
import type { TargetView } from './App';
import { TARGET_LABEL } from './Header';
import { post } from './vscode';

export type SkillNodeData = {
  node: WorkflowNode;
  findings: Finding[];
  target: TargetView;
  ghost?: 'add' | 'remove' | 'modify';
  proposalKey?: string;
};

function subtitle(n: WorkflowNode): string {
  const c = n.config;
  const pick = (k: string) => String(c[k] ?? '').trim();
  switch (n.type) {
    case 'source.rest': return pick('baseUrl').replace(/^https?:\/\//, '') || 'REST API';
    case 'source.mcp': return pick('server') ? `MCP · ${pick('server')}` : 'MCP tool';
    case 'source.reference': return pick('file') || 'Reference doc';
    case 'module.script': return `Script${pick('language') ? ' · ' + pick('language') : ''}`;
    case 'module.ai': return 'AI step · judgment';
    case 'output.message': return pick('channel') || 'Message';
    case 'output.file': return pick('path') || 'File';
    default: return getComponent(n.type)?.label ?? 'Choose a type';
  }
}

export const SkillNode = memo(function SkillNode({ data, selected }: NodeProps<Node<SkillNodeData>>) {
  const { node, findings, target, ghost, proposalKey } = data;
  const cat = categoryOf(node.type);
  const def = getComponent(node.type);
  const placeholder = isPlaceholder(node.type);
  const effectiveType = target !== 'all' ? node.targetOverrides?.[target]?.type ?? node.type : node.type;
  const excluded = target !== 'all' && node.excludeTargets?.includes(target);
  const support = target !== 'all' ? getComponent(effectiveType)?.support[target] : undefined;
  const overridden = target !== 'all' ? !!node.targetOverrides?.[target] : !!Object.keys(node.targetOverrides ?? {}).length;
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const inferred = node.inferred && !node.inferred.confirmed;

  const classes = ['sk-node', `cat-${cat}`, selected && 'selected', placeholder && 'placeholder', excluded && 'excluded', support === 'no' && 'unsupported', ghost && `ghost-${ghost}`]
    .filter(Boolean)
    .join(' ');

  const icon = placeholder ? 'question' : getComponent(effectiveType)?.icon ?? 'circle-outline';
  const tooltip = [
    `${CATEGORY_META[cat].label}: ${def?.label ?? 'not chosen yet'}`,
    excluded ? `Left out of the ${TARGET_LABEL[target as keyof typeof TARGET_LABEL]} build` : '',
    overridden && target !== 'all' ? `Uses ${getComponent(effectiveType)?.label} for ${TARGET_LABEL[target as keyof typeof TARGET_LABEL]}` : '',
    ...findings.map((f) => `• ${f.message}`),
  ].filter(Boolean).join('\n');

  return (
    <div className={classes} title={tooltip}>
      {node.type !== 'entry.trigger' && <Handle type="target" position={Position.Left} />}
      <span className={`codicon codicon-${icon} sk-icon`} />
      <div className="sk-text">
        <div className="sk-label">{node.label}</div>
        <div className="sk-sub">{placeholder ? 'Choose a type →' : subtitle(effectiveType === node.type ? node : { ...node, type: effectiveType })}</div>
      </div>
      <div className="sk-badges">
        {errors > 0 && <span className="badge err" aria-label={`${errors} errors`}><span className="codicon codicon-error" />{errors}</span>}
        {warnings > 0 && <span className="badge warn" aria-label={`${warnings} warnings`}><span className="codicon codicon-warning" />{warnings}</span>}
        {inferred && <span className="badge info" title={`Inferred from ${node.inferred!.evidence}. Confirm or correct it.`}>{Math.round(node.inferred!.confidence * 100)}%</span>}
        {overridden && <span className="badge override" title="Customized for a specific tool" />}
        {node.customCode && <span className="codicon codicon-lock sk-lock" title="You own this code — SkillCraft won't regenerate it" />}
      </div>
      {ghost && proposalKey && (
        <div className="ghost-tag">
          {ghost === 'add' ? 'Proposed' : ghost === 'remove' ? 'Proposed removal' : 'Proposed change'}
          <button className="link" onClick={(e) => { e.stopPropagation(); post({ type: 'proposal', key: proposalKey, action: 'accept' }); }}>Accept</button>
        </div>
      )}
      {cat !== 'output' && <Handle type="source" position={Position.Right} />}
    </div>
  );
});
