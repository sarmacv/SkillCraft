// Applying and undoing proposals, plus the proposals that set up a project.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultConfig, PROJECT_FILE, serializeConfig, serializeWorkflow, TESTS_FILE, WORKFLOW_FILE } from './project';
import { joinFrontmatter } from './skill';
import type { FileChange, ProjectConfig, Proposal, ProposalPriority, ScriptLanguage, TargetId, Workflow } from './types';
import { connect } from './workflow';

export const PRIORITY_ORDER: ProposalPriority[] = ['critical', 'recommended', 'optional'];
export const PRIORITY_LABEL: Record<ProposalPriority, string> = { critical: 'Critical', recommended: 'Recommended', optional: 'Optional' };

/** Apply file changes under `root`. Returns the inverse changes, newest-first, for undo. */
export function applyChanges(root: string, changes: FileChange[]): FileChange[] {
  const undo: FileChange[] = [];
  for (const c of changes) {
    const abs = path.join(root, c.path);
    switch (c.kind) {
      case 'create':
      case 'modify': {
        const existed = fs.existsSync(abs);
        undo.unshift(existed ? { kind: 'modify', path: c.path, content: fs.readFileSync(abs, 'utf8') } : { kind: 'delete', path: c.path });
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, c.content);
        break;
      }
      case 'delete': {
        if (!fs.existsSync(abs)) break;
        undo.unshift({ kind: 'create', path: c.path, content: fs.readFileSync(abs, 'utf8') });
        fs.rmSync(abs);
        break;
      }
      case 'rename': {
        const dest = path.join(root, c.newPath);
        if (fs.existsSync(dest)) throw new Error(`${c.newPath} already exists`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(abs, dest);
        undo.unshift({ kind: 'rename', path: c.newPath, newPath: c.path });
        break;
      }
    }
  }
  return undo;
}

/** The text a file will have after the proposal, or undefined if it is deleted. Used for diff previews. */
export function contentAfter(root: string, proposal: Proposal, file: string): string | undefined {
  let content: string | undefined = readOrUndefined(path.join(root, file));
  for (const c of proposal.changes) {
    if (c.path !== file && !(c.kind === 'rename' && c.newPath === file)) continue;
    if (c.kind === 'create' || c.kind === 'modify') content = c.content;
    else if (c.kind === 'delete') content = undefined;
    else if (c.kind === 'rename') content = c.newPath === file ? readOrUndefined(path.join(root, c.path)) : undefined;
  }
  return content;
}

function readOrUndefined(abs: string): string | undefined {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
}

export function touchedFiles(p: Proposal): string[] {
  return [...new Set(p.changes.flatMap((c) => (c.kind === 'rename' ? [c.path, c.newPath] : [c.path])))];
}

const GITIGNORE = 'dist/\n.skillcraft/\nnode_modules/\n__pycache__/\n';

function starterSkillMd(name: string, description: string): string {
  return joinFrontmatter(
    { name, description },
    `# ${name.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}\n\n<!-- skillcraft:begin workflow -->\n<!-- skillcraft:end workflow -->\n`,
  );
}

/** Greenfield: the files a new SkillCraft project starts with. */
export function newProjectProposal(opts: { name: string; description?: string; language: ScriptLanguage; targets: TargetId[]; workflow?: Workflow; source: Proposal['source'] }): Proposal {
  const config = defaultConfig(opts.name, opts.language, opts.targets);
  const workflow: Workflow = opts.workflow ?? {
    version: 1,
    nodes: [{ id: 'trigger', type: 'entry.trigger', label: 'Skill trigger', config: { whenToUse: opts.description ?? '' }, position: { x: 0, y: 120 } }],
    edges: [],
  };
  return {
    key: `new-project:${opts.name}`,
    title: `Create skill project "${opts.name}"`,
    why: 'Sets up the standard layout: the skill source, its workflow, tests and docs, kept separate from build output.',
    impact: `Targets: ${opts.targets.join(', ')} · scripts in ${opts.language}`,
    priority: 'critical',
    source: opts.source,
    changes: [
      { kind: 'create', path: PROJECT_FILE, content: serializeConfig(config) },
      { kind: 'create', path: WORKFLOW_FILE, content: serializeWorkflow(workflow) },
      { kind: 'create', path: `${config.skillPath}/SKILL.md`, content: starterSkillMd(opts.name, opts.description ?? '') },
      { kind: 'create', path: TESTS_FILE, content: JSON.stringify(starterTests(opts.name), null, 2) + '\n' },
      { kind: 'create', path: 'docs/notes.md', content: `# Notes for ${opts.name}\n\nAnything you write here is added to the generated README.md.\n` },
      { kind: 'create', path: '.gitignore', content: GITIGNORE },
    ],
  };
}

function starterTests(name: string) {
  return [
    { id: 'triggers-on-main-request', prompt: `TODO: a request that should use ${name}`, shouldTrigger: true, expect: [] },
    { id: 'ignores-unrelated-request', prompt: 'What is the capital of France?', shouldTrigger: false },
  ];
}

/** Brownfield: adopt an existing skill in place. Nothing is moved. */
export function adoptProposal(root: string, skillDirAbs: string, name: string, workflow: Workflow, formats: TargetId[]): Proposal {
  const skillPath = path.relative(root, skillDirAbs).split(path.sep).join('/');
  const targets: TargetId[] = formats.length ? formats : ['claude', 'codex', 'copilot'];
  const config: ProjectConfig = { ...defaultConfig(name, 'python', targets), skillPath };
  const changes: FileChange[] = [
    { kind: 'create', path: PROJECT_FILE, content: serializeConfig(config) },
    { kind: 'create', path: WORKFLOW_FILE, content: serializeWorkflow(workflow) },
  ];
  if (!fs.existsSync(path.join(root, TESTS_FILE))) changes.push({ kind: 'create', path: TESTS_FILE, content: JSON.stringify(starterTests(name), null, 2) + '\n' });
  const gi = path.join(root, '.gitignore');
  const existing = readOrUndefined(gi);
  if (existing === undefined) changes.push({ kind: 'create', path: '.gitignore', content: GITIGNORE });
  else if (!existing.includes('.skillcraft/')) changes.push({ kind: 'modify', path: '.gitignore', content: `${existing.trimEnd()}\n${GITIGNORE}` });
  return {
    key: `adopt:${skillPath}`,
    title: `Adopt "${name}" into SkillCraft`,
    why: 'Adds a project file and the reconstructed workflow next to your skill so you can orchestrate, test and build it. Your skill files stay exactly where they are.',
    impact: `${workflow.nodes.length} components inferred — review them on the canvas.`,
    priority: 'critical',
    source: 'import',
    changes,
  };
}

export function skeletonFromAnswers(a: { name: string; whenToUse: string; sources: string[]; outputs: string[] }): Workflow {
  const nodes: Workflow['nodes'] = [{ id: 'trigger', type: 'entry.trigger', label: 'Skill trigger', config: { whenToUse: a.whenToUse }, position: { x: 0, y: 0 } }];
  const edges: Workflow['edges'] = [];
  const ai = { id: 'ai', type: 'module.ai', label: 'Decide and summarize', config: { instructions: '' }, position: { x: 0, y: 0 } };
  nodes.push(ai);
  a.sources.forEach((s, i) => {
    const id = `src_${i}`;
    nodes.push({ id, type: 'placeholder.source', label: s, config: {}, position: { x: 0, y: 0 } });
    edges.push(connect('trigger', id), connect(id, 'ai'));
  });
  if (!a.sources.length) edges.push(connect('trigger', 'ai'));
  (a.outputs.length ? a.outputs : ['Reply in chat']).forEach((o, i) => {
    const id = `out_${i}`;
    nodes.push({ id, type: o === 'Reply in chat' ? 'output.return' : 'placeholder.output', label: o, config: {}, position: { x: 0, y: 0 } });
    edges.push(connect('ai', id));
  });
  return { version: 1, nodes, edges };
}
