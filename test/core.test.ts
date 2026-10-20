import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { build } from '../src/core/build';
import { runChecks } from '../src/core/checks';
import { syncProposal } from '../src/core/codegen/generate';
import { detectSkills } from '../src/core/detect';
import { inferWorkflow } from '../src/core/infer';
import { loadWorkspace } from '../src/core/project';
import { adoptProposal, applyChanges, newProjectProposal } from '../src/core/proposals';
import { findReferences, loadSkill, splitFrontmatter } from '../src/core/skill';
import type { Workflow } from '../src/core/types';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skillcraft-test-'));
}

function write(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
}

const MESSY_SKILL = {
  '.claude/skills/Weekly-Report/SKILL.md': `---
name: Weekly Report
description: Does reports
allowed-tools: Bash(python3:*)
---

# Weekly report

## Steps

1. Run \`fetch.py\` to get tickets.
2. Read [the style guide](references/style.md) when formatting.
3. Use mcp__slack__search_messages to find team updates.
4. Summarize and reply to the user.
`,
  '.claude/skills/Weekly-Report/fetch.py': `"""Fetch open Jira tickets for a team."""
import requests
API_TOKEN = "sk-ant-abcdefghijklmnopqrstuvwxyz123456"
r = requests.get("https://acme.atlassian.net/rest/api/3/search", headers={"Authorization": API_TOKEN})
print(r.json())
hook = os.environ["SLACK_WEBHOOK_URL"]
`,
  '.claude/skills/Weekly-Report/README.md': '# My notes\n',
  '.claude/skills/Weekly-Report/references/unused.md': '# Not linked anywhere\n',
};

test('frontmatter parsing and references', () => {
  const p = splitFrontmatter('---\nname: a\ndescription: b\n---\n\nSee [x](references/x.md) and `scripts/run.py`.\n');
  assert.equal(p.frontmatter?.name, 'a');
  const refs = findReferences(p.body);
  assert.deepEqual(refs.map((r) => r.target).sort(), ['references/x.md', 'scripts/run.py']);
});

test('detects a brownfield skill and flags its gaps with proposals', () => {
  const root = tmp();
  write(root, MESSY_SKILL);
  const found = detectSkills(root);
  assert.equal(found.length, 1);
  assert.ok(found[0].formats.includes('claude'));

  const skill = loadSkill(found[0].dir);
  const { report, proposals } = runChecks(skill, { root, config: { name: 'weekly-report', version: '0.1.0', skillPath: found[0].rel, language: 'python', targets: ['claude', 'codex'], buildMode: 'tailored' } });
  const rules = new Set(report.findings.map((f) => f.rule));
  for (const r of ['name-invalid', 'description-vague', 'hardcoded-secret', 'human-docs-in-skill', 'misplaced-file', 'orphan-file', 'python-deps-undeclared', 'env-undocumented', 'frontmatter-portability-codex']) {
    assert.ok(rules.has(r), `expected finding ${r}; got ${[...rules].join(', ')}`);
  }
  assert.equal(report.readiness, 'draft');
  const secretFix = proposals.find((p) => p.key.startsWith('hardcoded-secret'));
  assert.ok(secretFix, 'secret fix proposed');
  const fixed = secretFix!.changes[0];
  assert.ok(fixed.kind === 'modify' && fixed.content.includes('os.environ["API_TOKEN"]') && fixed.content.startsWith('import os'));

  // Applying the misplaced-file proposal moves the script and rewrites the link; undo restores both.
  const move = proposals.find((p) => p.key.startsWith('misplaced-file'))!;
  const undo = applyChanges(root, move.changes);
  assert.ok(fs.existsSync(path.join(root, '.claude/skills/Weekly-Report/scripts/fetch.py')));
  assert.match(fs.readFileSync(path.join(root, '.claude/skills/Weekly-Report/SKILL.md'), 'utf8'), /`scripts\/fetch\.py`/);
  applyChanges(root, undo);
  assert.ok(fs.existsSync(path.join(root, '.claude/skills/Weekly-Report/fetch.py')));
});

test('rejected proposals are not suggested again', () => {
  const root = tmp();
  write(root, MESSY_SKILL);
  const skill = loadSkill(path.join(root, '.claude/skills/Weekly-Report'));
  const first = runChecks(skill, { root }).proposals.find((p) => p.key.startsWith('human-docs'))!;
  const again = runChecks(skill, { root, config: { name: 'x', version: '1', skillPath: '', language: 'python', targets: [], buildMode: 'tailored', rejected: [{ key: first.key }] } });
  assert.ok(!again.proposals.some((p) => p.key === first.key));
});

test('infers an orchestration graph from an existing skill', () => {
  const root = tmp();
  write(root, MESSY_SKILL);
  const wf = inferWorkflow(loadSkill(path.join(root, '.claude/skills/Weekly-Report')));
  const types = wf.nodes.map((n) => `${n.type}:${n.label}`);
  assert.ok(types.includes('entry.trigger:Skill trigger'));
  assert.ok(types.some((t) => t === 'source.rest:Jira'), types.join(' | '));
  assert.ok(types.some((t) => t.startsWith('source.mcp:slack')), types.join(' | '));
  assert.ok(types.some((t) => t.startsWith('source.reference')));
  assert.ok(types.some((t) => t.startsWith('output.message')), types.join(' | '));
  assert.ok(wf.nodes.every((n) => n.inferred && n.inferred.confidence > 0));
  assert.ok(wf.edges.length >= wf.nodes.length - 1);
});

test('adopting keeps the skill in place', () => {
  const root = tmp();
  write(root, MESSY_SKILL);
  const dir = path.join(root, '.claude/skills/Weekly-Report');
  const p = adoptProposal(root, dir, 'weekly-report', inferWorkflow(loadSkill(dir)), ['claude']);
  assert.ok(p.changes.every((c) => c.kind === 'create'));
  assert.ok(!p.changes.some((c) => c.path.startsWith('.claude/')));
});

const GREENFIELD_WORKFLOW: Workflow = {
  version: 1,
  nodes: [
    { id: 't', type: 'entry.trigger', label: 'Skill trigger', config: { does: 'Builds a weekly status report from Jira and Slack', whenToUse: 'the user asks for a weekly status update', examples: 'Write my weekly status' }, position: { x: 0, y: 0 } },
    { id: 'in', type: 'entry.input', label: 'Inputs', config: { params: 'team: Jira project key\nsince: start date' }, position: { x: 0, y: 0 } },
    { id: 'jira', type: 'source.rest', label: 'Jira', config: { baseUrl: 'https://acme.atlassian.net', path: '/rest/api/3/search', method: 'GET', auth: 'bearer token', tokenEnv: 'JIRA_API_TOKEN' }, position: { x: 0, y: 0 } },
    { id: 'slack', type: 'source.mcp', label: 'Slack', config: { server: 'slack', tool: 'search_messages', url: 'https://mcp.slack.com/mcp', usage: 'find team updates' }, position: { x: 0, y: 0 }, targetOverrides: { codex: { type: 'source.web', config: { url: 'https://status.acme.com' } } } },
    { id: 'merge', type: 'module.script', label: 'Fetch and merge', config: { purpose: 'Merge tickets into one list' }, position: { x: 0, y: 0 } },
    { id: 'ai', type: 'module.ai', label: 'Summarize', config: { instructions: 'Pick the five most important items and summarize each in one line.' }, position: { x: 0, y: 0 } },
    { id: 'post', type: 'output.message', label: 'Post to Slack', config: { channel: 'slack webhook', targetEnv: 'SLACK_WEBHOOK_URL' }, position: { x: 0, y: 0 } },
    { id: 'reply', type: 'output.return', label: 'Reply', config: { format: 'a bulleted list' }, position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'in' },
    { id: 'e2', source: 'in', target: 'jira' },
    { id: 'e3', source: 'in', target: 'slack' },
    { id: 'e4', source: 'jira', target: 'merge' },
    { id: 'e5', source: 'merge', target: 'ai' },
    { id: 'e6', source: 'slack', target: 'ai' },
    { id: 'e7', source: 'ai', target: 'post' },
    { id: 'e8', source: 'ai', target: 'reply' },
  ],
};

for (const language of ['python', 'node', 'bash'] as const) {
  test(`greenfield: create, sync and build for every target (${language})`, () => {
    const root = tmp();
    applyChanges(root, newProjectProposal({ name: 'weekly-status', language, targets: ['claude', 'codex', 'copilot'], workflow: GREENFIELD_WORKFLOW, source: 'setup' }).changes);
    let ws = loadWorkspace(root)!;
    const sync = syncProposal(ws)!;
    assert.ok(sync, 'sync proposal');
    applyChanges(root, sync.changes);
    ws = loadWorkspace(root)!;
    assert.equal(syncProposal(ws), undefined, 'second sync is a no-op');

    const skillMd = fs.readFileSync(path.join(root, 'skills/weekly-status/SKILL.md'), 'utf8');
    assert.match(skillMd, /description: Builds a weekly status report from Jira and Slack\. Use when the user asks for a weekly status update\./);
    assert.match(skillMd, /search_messages/);
    const script = fs.readdirSync(path.join(root, 'skills/weekly-status/scripts'));
    assert.equal(script.length, 2, script.join(','));

    const skill = loadSkill(path.join(root, ws.config.skillPath));
    const { report } = runChecks(skill, { root, config: ws.config, workflow: ws.workflow, tests: ws.tests, state: ws.state });
    assert.deepEqual(report.findings.filter((f) => f.severity === 'error'), []);
    assert.equal(report.readiness, 'runnable');

    const result = build(ws);
    assert.ok(result.ok, result.errors.join(';'));
    for (const t of ['claude', 'codex', 'copilot']) {
      assert.ok(fs.existsSync(path.join(root, 'dist', t, 'weekly-status', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(root, 'dist', t, 'SETUP.md')));
      assert.ok(fs.existsSync(path.join(root, 'dist', t, 'install.sh')));
    }
    assert.ok(fs.existsSync(path.join(root, 'dist/codex/weekly-status/agents/openai.yaml')));
    const codexMd = fs.readFileSync(path.join(root, 'dist/codex/weekly-status/SKILL.md'), 'utf8');
    assert.doesNotMatch(codexMd, /search_messages/, 'codex override replaces the MCP node');
    assert.doesNotMatch(codexMd, /skillcraft:begin/, 'markers stripped from builds');
    const readme = fs.readFileSync(path.join(root, 'dist/README.md'), 'utf8');
    assert.match(readme, /```mermaid/);
    assert.match(readme, /JIRA_API_TOKEN/);
    const setupClaude = fs.readFileSync(path.join(root, 'dist/claude/SETUP.md'), 'utf8');
    assert.match(setupClaude, /claude mcp add --transport http slack https:\/\/mcp\.slack\.com\/mcp/);
    assert.match(setupClaude, /\.claude\/skills\/weekly-status/);
  });
}

test('generated node and bash scripts are syntactically valid', async () => {
  const { execFileSync } = await import('node:child_process');
  const { GENERATORS } = await import('../src/core/codegen/templates');
  const nodes = GREENFIELD_WORKFLOW.nodes;
  const sources = nodes.filter((n) => n.type === 'source.rest');
  const outputs = nodes.filter((n) => n.type === 'output.message');
  const dir = tmp();
  for (const [lang, ext, cmd, args] of [['node', '.mjs', 'node', ['--check']], ['bash', '.sh', 'bash', ['-n']]] as const) {
    for (const [srcs, outs] of [[sources, outputs], [[], outputs], [sources, []]] as const) {
      const file = path.join(dir, `s${srcs.length}${outs.length}${ext}`);
      fs.writeFileSync(file, GENERATORS[lang]('Test purpose', [{ name: 'team', description: 'x' }], [...srcs], [...outs]));
      execFileSync(cmd, [...args, file], { stdio: 'pipe' });
    }
  }
});

test('every template creates, syncs and builds without errors', async () => {
  const { TEMPLATES } = await import('../src/core/templates');
  for (const t of TEMPLATES) {
    const root = tmp();
    applyChanges(root, newProjectProposal({ name: t.name, language: 'python', targets: ['claude', 'codex', 'copilot'], workflow: t.workflow, source: 'setup' }).changes);
    applyChanges(root, syncProposal(loadWorkspace(root)!)!.changes);
    const ws = loadWorkspace(root)!;
    const { report } = runChecks(loadSkill(path.join(root, ws.config.skillPath)), { root, config: ws.config, workflow: ws.workflow, tests: ws.tests, state: ws.state });
    assert.deepEqual(report.findings.filter((f) => f.severity === 'error').map((f) => f.message), [], t.id);
    assert.ok(build(ws).ok, t.id);
  }
});

test('the brownfield example triggers the expected findings', () => {
  const root = path.join(__dirname, '..', 'examples', 'brownfield');
  const [found] = detectSkills(root);
  const { report, proposals } = runChecks(loadSkill(found.dir), { root });
  const rules = new Set(report.findings.map((f) => f.rule));
  for (const r of ['name-invalid', 'description-vague', 'hardcoded-secret', 'human-docs-in-skill', 'misplaced-file', 'broken-reference', 'orphan-file', 'python-deps-undeclared']) assert.ok(rules.has(r), `missing ${r}`);
  assert.ok(proposals.length >= 5);
});
