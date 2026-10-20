// Turning the workflow graph into skill files: scripts plus the managed
// workflow section of SKILL.md. Output is a Proposal — never written directly.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { categoryOf, getComponent, isPlaceholder } from '../catalog';
import type { Workspace } from '../project';
import { joinFrontmatter, slugify, splitFrontmatter } from '../skill';
import type { FileChange, Proposal, ScriptLanguage, TargetId, Workflow, WorkflowNode } from '../types';
import { topoOrder } from '../workflow';
import { EXT, GENERATORS, isManaged, type Param, RUNNER } from './templates';

export const BEGIN = '<!-- skillcraft:begin workflow -->';
export const END = '<!-- skillcraft:end workflow -->';

const str = (v: unknown) => String(v ?? '').trim();

/** The workflow as one target sees it: excluded nodes removed, substitutions applied. */
export function workflowFor(wf: Workflow, target?: TargetId): Workflow {
  if (!target) return wf;
  const nodes = wf.nodes
    .filter((n) => !n.excludeTargets?.includes(target))
    .map((n) => (n.targetOverrides?.[target] ? { ...n, type: n.targetOverrides[target]!.type, config: { ...n.config, ...n.targetOverrides[target]!.config } } : n));
  const ids = new Set(nodes.map((n) => n.id));
  return { ...wf, nodes, edges: wf.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

export function paramsOf(wf: Workflow): Param[] {
  const input = wf.nodes.find((n) => n.type === 'entry.input');
  return str(input?.config.params)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, ...rest] = l.split(':');
      return { name: slugify(name) || 'arg', description: rest.join(':').trim() };
    });
}

interface ScriptPlan {
  file: string;
  node: WorkflowNode;
  purpose: string;
  sources: WorkflowNode[];
  outputs: WorkflowNode[];
  transform?: string;
}

/** Which script files the workflow produces and what goes in each. */
export function planScripts(wf: Workflow, language: ScriptLanguage): ScriptPlan[] {
  const ext = EXT[language];
  const isScript = (n: WorkflowNode) => !isPlaceholder(n.type) && getComponent(n.type)?.compile === 'script';
  const parents = (id: string) => wf.edges.filter((e) => e.target === id).map((e) => wf.nodes.find((n) => n.id === e.source)!).filter(Boolean);
  const children = (id: string) => wf.edges.filter((e) => e.source === id).map((e) => wf.nodes.find((n) => n.id === e.target)!).filter(Boolean);
  const absorbed = new Set<string>();
  const plans: ScriptPlan[] = [];

  for (const n of topoOrder(wf).filter((x) => x.type === 'module.script' || x.type === 'module.transform')) {
    const sources = parents(n.id).filter((p) => categoryOf(p.type) === 'source' && isScript(p));
    const outputs = children(n.id).filter((c) => categoryOf(c.type) === 'output' && isScript(c));
    [...sources, ...outputs].forEach((x) => absorbed.add(x.id));
    const file = str(n.config.file) || `scripts/${slugify(n.label).replace(/-/g, '_') || 'step'}${ext}`;
    plans.push({
      file,
      node: n,
      purpose: str(n.config.purpose) || (n.type === 'module.transform' ? `${str(n.config.operation)} the data` : n.label),
      sources,
      outputs,
      transform: n.type === 'module.transform' ? `${str(n.config.operation)} ${str(n.config.expression)}`.trim() : undefined,
    });
  }
  for (const n of wf.nodes.filter((x) => isScript(x) && !absorbed.has(x.id) && x.type !== 'module.script' && x.type !== 'module.transform')) {
    const cat = categoryOf(n.type);
    const verb = cat === 'source' ? 'fetch' : 'send';
    plans.push({
      file: `scripts/${verb}_${slugify(n.label).replace(/-/g, '_') || 'step'}${ext}`,
      node: n,
      purpose: `${cat === 'source' ? 'Fetch data from' : 'Send results to'} ${n.label}`,
      sources: cat === 'source' ? [n] : [],
      outputs: cat === 'output' ? [n] : [],
    });
  }
  return plans;
}

/** Markdown for the managed workflow section of SKILL.md. */
export function renderWorkflowSection(wf: Workflow, language: ScriptLanguage): string {
  const plans = planScripts(wf, language);
  const scriptFor = new Map<string, ScriptPlan>();
  for (const p of plans) {
    scriptFor.set(p.node.id, p);
    [...p.sources, ...p.outputs].forEach((n) => scriptFor.set(n.id, p));
  }
  const params = paramsOf(wf);
  const argList = params.map((p) => `--${p.name} <${p.name}>`).join(' ');
  const lines: string[] = [];
  const done = new Set<string>();
  let step = 0;
  const add = (text: string) => lines.push(`${++step}. ${text}`);

  if (params.length) {
    lines.push('## Inputs\n');
    for (const p of params) lines.push(`- \`${p.name}\`${p.description ? ` — ${p.description}` : ''}`);
    lines.push('\nIf an input is missing, ask the user for it before starting.\n');
  }
  lines.push('## Workflow\n');

  for (const n of topoOrder(wf)) {
    if (done.has(n.id) || n.type.startsWith('entry.')) continue;
    const c = n.config;
    const plan = scriptFor.get(n.id);
    if (plan) {
      if (done.has(plan.node.id)) continue;
      [plan.node, ...plan.sources, ...plan.outputs].forEach((x) => done.add(x.id));
      const what = [plan.purpose, plan.sources.length ? `pulls from ${plan.sources.map((x) => x.label).join(', ')}` : '', plan.outputs.length ? `sends to ${plan.outputs.map((x) => x.label).join(', ')}` : ''].filter(Boolean).join('; ');
      if (!plan.sources.length && plan.outputs.length && plan.node.type !== 'module.script') {
        add(`Pipe the final result into \`${RUNNER[language]} ${plan.file}\` (for example \`echo "$RESULT" | ${RUNNER[language]} ${plan.file}\`) — ${what}. If it exits with an error, tell the user what failed.`);
      } else {
        add(`Run \`${RUNNER[language]} ${plan.file}${argList ? ' ' + argList : ''}\` — ${what}. It prints JSON; if it exits with an error, tell the user what failed and stop.`);
      }
      continue;
    }
    done.add(n.id);
    switch (n.type) {
      case 'source.mcp':
        add(`Use the \`${str(c.tool)}\` tool from the \`${str(c.server)}\` MCP server${str(c.usage) ? ` to ${str(c.usage).replace(/^to\s+/i, '')}` : ''}. If the server isn't available, tell the user it needs to be connected.`);
        break;
      case 'source.reference':
        add(`Read [${str(c.file)}](${str(c.file)}) when ${str(c.readWhen) || 'you need its details'}.`);
        break;
      case 'module.ai':
        add(str(c.instructions) || n.label);
        break;
      case 'module.condition':
        add(`If ${str(c.rule)}, tell the user and stop.`);
        break;
      case 'module.loop':
        add(`Repeat the next steps for each ${str(c.over)}.`);
        break;
      case 'module.skill':
        add(`Use the \`${str(c.skill)}\` skill for this part.`);
        break;
      case 'module.approval':
        add(`Ask the user: "${str(c.question)}" Continue only if they agree.`);
        break;
      case 'output.file':
        add(`Write the result to \`${str(c.path)}\`${str(c.template) ? ` using [${str(c.template)}](${str(c.template)}) as the template` : ''}.`);
        break;
      case 'output.mcp':
        add(`Use the \`${str(c.tool)}\` tool from the \`${str(c.server)}\` MCP server to deliver the result.`);
        break;
      case 'output.return':
        add(`Reply to the user${str(c.format) ? ` with ${str(c.format)}` : ' with the result'}.`);
        break;
      default:
        if (isPlaceholder(n.type)) add(`${n.label} (not configured yet).`);
    }
  }
  return lines.join('\n');
}

export function descriptionFromTrigger(wf: Workflow): string | undefined {
  const t = wf.nodes.find((n) => n.type === 'entry.trigger');
  const does = str(t?.config.does).replace(/\.?$/, '.');
  const when = str(t?.config.whenToUse).replace(/^use (this skill )?when\s+/i, '').replace(/\.$/, '');
  if (!str(t?.config.does) || !when) return undefined;
  return `${does} Use when ${when}.`.slice(0, 1024);
}

export function replaceManagedSection(body: string, section: string): string {
  const block = `${BEGIN}\n${section.trim()}\n${END}`;
  const start = body.indexOf(BEGIN);
  const end = body.indexOf(END);
  if (start !== -1 && end > start) return body.slice(0, start) + block + body.slice(end + END.length);
  return `${body.trimEnd()}\n\n${block}\n`;
}

/** Everything the workflow implies, compared with the files on disk, as one reviewable proposal. */
export function syncProposal(ws: Workspace): Proposal | undefined {
  const skillRel = ws.config.skillPath;
  const skillAbs = path.join(ws.root, skillRel);
  const changes: FileChange[] = [];
  const notes: string[] = [];
  const read = (rel: string) => {
    try {
      return fs.readFileSync(path.join(skillAbs, rel), 'utf8');
    } catch {
      return undefined;
    }
  };

  const plans = planScripts(ws.workflow, ws.config.language);
  const params = paramsOf(ws.workflow);
  for (const p of plans) {
    if (p.node.customCode) continue;
    const content = GENERATORS[ws.config.language](p.purpose, params, p.sources, p.outputs, p.transform);
    const existing = read(p.file);
    if (existing !== undefined && !isManaged(existing)) {
      notes.push(`${p.file} is yours (no managed marker), so it was left alone.`);
      continue;
    }
    if (existing !== content) changes.push({ kind: existing === undefined ? 'create' : 'modify', path: `${skillRel}/${p.file}`, content });
  }

  // Remove generated scripts the workflow no longer produces.
  const scriptsDir = path.join(skillAbs, 'scripts');
  const wanted = new Set(plans.map((p) => p.file));
  if (fs.existsSync(scriptsDir)) {
    for (const f of fs.readdirSync(scriptsDir)) {
      const rel = `scripts/${f}`;
      const text = read(rel);
      if (!wanted.has(rel) && text !== undefined && isManaged(text)) changes.push({ kind: 'delete', path: `${skillRel}/${rel}` });
    }
  }

  // Reference nodes pointing at files that don't exist yet get a starter file to fill in.
  for (const n of ws.workflow.nodes.filter((x) => x.type === 'source.reference')) {
    const file = str(n.config.file);
    if (!/^references\/[\w./-]+\.md$/.test(file) || read(file) !== undefined) continue;
    changes.push({ kind: 'create', path: `${skillRel}/${file}`, content: `# ${n.label}\n\nTODO: write what the agent should know here. It reads this file when ${str(n.config.readWhen) || 'it needs these details'}.\n` });
  }

  const needsPgDriver =plans.some((p) => p.sources.some((s) => s.type === 'source.database'));
  if (needsPgDriver && ws.config.language === 'python') {
    const drivers = new Set(plans.flatMap((p) => p.sources.filter((s) => s.type === 'source.database').map((s) => (s.config.driver === 'mysql' ? 'pymysql' : s.config.driver === 'sqlite' ? '' : 'psycopg2-binary'))).filter(Boolean));
    const reqs = read('scripts/requirements.txt') ?? '';
    const missing = [...drivers].filter((d) => !reqs.includes(d));
    if (missing.length) changes.push({ kind: reqs ? 'modify' : 'create', path: `${skillRel}/scripts/requirements.txt`, content: `${reqs.trimEnd()}${reqs ? '\n' : ''}${missing.join('\n')}\n` });
  }

  // SKILL.md: managed section + description from the trigger.
  const raw = read('SKILL.md') ?? joinFrontmatter({ name: ws.config.name, description: '' }, '');
  const parsed = splitFrontmatter(raw);
  const fm = { ...(parsed.frontmatter ?? { name: ws.config.name }) };
  const desc = descriptionFromTrigger(ws.workflow);
  if (desc && desc !== fm.description) fm.description = desc;
  const hasWorkflow = ws.workflow.nodes.some((n) => !n.type.startsWith('entry.'));
  const body = hasWorkflow ? replaceManagedSection(parsed.body, renderWorkflowSection(ws.workflow, ws.config.language)) : parsed.body;
  const next = joinFrontmatter(fm, body);
  if (next !== raw) changes.push({ kind: read('SKILL.md') === undefined ? 'create' : 'modify', path: `${skillRel}/SKILL.md`, content: next });

  if (!changes.length) return undefined;
  return {
    key: `sync:${hashChanges(changes)}`,
    title: `Sync ${changes.length} file${changes.length > 1 ? 's' : ''} with the workflow`,
    why: 'Generates scripts for deterministic steps and writes the workflow into SKILL.md, so the files match what you see on the canvas.',
    impact: [`Scripts in ${ws.config.language}.`, ...notes].join(' '),
    priority: 'recommended',
    source: 'sync',
    changes,
  };
}

function hashChanges(changes: FileChange[]): string {
  let h = 0;
  const text = JSON.stringify(changes);
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
