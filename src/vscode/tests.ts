// Live testing. Quick mode uses the configured model to check triggering and
// behavior; agent mode installs the built skill into a scratch project and runs
// each tool's real CLI headlessly.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { build } from '../core/build';
import { PROFILES } from '../core/profiles';
import { loadWorkspace, saveState, type TestCase, type TestResult } from '../core/project';
import type { TargetId } from '../core/types';
import { extractJson, getAi, NO_MODEL_MESSAGE } from './ai';
import type { Controller } from './controller';

const DISTRACTORS = [
  { name: 'pdf-tools', description: 'Extract text and tables from PDF files and fill PDF forms. Use when the user works with PDFs.' },
  { name: 'git-helper', description: 'Explain git history, write commit messages and resolve merge conflicts. Use for git questions.' },
  { name: 'calendar-planner', description: 'Plan meetings and find free time in calendars. Use when scheduling meetings.' },
  { name: 'web-research', description: 'Research a topic on the web and cite sources. Use for open-ended research questions.' },
];

const CLI: Record<TargetId, { bin: string; args: (prompt: string) => string[] }> = {
  claude: { bin: 'claude', args: (p) => ['-p', p, '--output-format', 'text'] },
  codex: { bin: 'codex', args: (p) => ['exec', '--skip-git-repo-check', p] },
  copilot: { bin: 'copilot', args: (p) => ['-p', p] },
};

function run(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException).code === 'ENOENT' ? -2 : 1) : 0, out: `${stdout}${stderr ? `\n${stderr}` : ''}` });
    });
  });
}

async function hasCli(bin: string): Promise<boolean> {
  const r = await run(process.platform === 'win32' ? 'where' : 'which', [bin], os.homedir(), 5000);
  return r.code === 0;
}

async function judge(ai: NonNullable<Awaited<ReturnType<typeof getAi>>>, output: string, expect: string[]): Promise<{ pass: boolean; reason: string }> {
  const lower = output.toLowerCase();
  if (expect.every((e) => lower.includes(e.toLowerCase()))) return { pass: true, reason: 'Mentions every expected point.' };
  const text = await ai.ask('You grade agent outputs strictly but fairly.', [
    { role: 'user', content: `Expected points:\n${expect.map((e) => `- ${e}`).join('\n')}\n\nOutput:\n${output.slice(0, 8000)}\n\nDoes the output cover every expected point (paraphrase is fine)? Reply ONLY JSON: {"pass": true|false, "reason": "one sentence"}` },
  ]);
  return extractJson<{ pass: boolean; reason: string }>(text) ?? { pass: false, reason: 'Could not grade the output.' };
}

async function quickTests(controller: Controller, cases: TestCase[], progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<TestResult[]> {
  const ai = await getAi();
  if (!ai) throw new Error(NO_MODEL_MESSAGE);
  const fm = controller.skill?.skillMd?.frontmatter ?? {};
  const name = String(fm.name ?? controller.ws?.config.name);
  const catalog = [...DISTRACTORS, { name, description: String(fm.description ?? '') }].sort((a, b) => a.name.localeCompare(b.name));
  const results: TestResult[] = [];
  for (const [i, c] of cases.entries()) {
    if (token.isCancellationRequested) break;
    progress.report({ message: `${i + 1}/${cases.length}: ${c.prompt.slice(0, 50)}`, increment: 100 / cases.length });
    const pickText = await ai.ask(
      'You are an AI agent deciding which skill (if any) to load for a request. Only load a skill whose description clearly fits.',
      [{ role: 'user', content: `Available skills:\n${catalog.map((s) => `- ${s.name}: ${s.description}`).join('\n')}\n\nRequest: "${c.prompt}"\n\nReply ONLY JSON: {"skill": "<name or none>"}` }],
      token,
    );
    const picked = extractJson<{ skill: string }>(pickText)?.skill ?? 'none';
    const triggered = picked === name;
    let passed = triggered === c.shouldTrigger;
    let detail = c.shouldTrigger ? (triggered ? 'Triggered as expected.' : `Did not trigger (picked: ${picked}). Make the description mention this kind of request.`) : triggered ? 'Triggered when it should not. Narrow the description.' : 'Correctly ignored.';
    if (passed && c.shouldTrigger && c.expect?.length) {
      const answer = await ai.ask(
        `Follow this skill to handle the request. You cannot run scripts here: say exactly which commands you would run, assume they succeed with plausible data, and give the final answer.\n\n${controller.skill?.rawSkillMd ?? ''}`,
        [{ role: 'user', content: c.prompt }],
        token,
      );
      const verdict = await judge(ai, answer, c.expect);
      passed = verdict.pass;
      detail = `Triggered. ${verdict.reason}`;
    }
    results.push({ caseId: c.id, target: 'all', mode: 'quick', passed, detail, at: new Date().toISOString() });
  }
  return results;
}

async function agentTests(controller: Controller, cases: TestCase[], targets: TargetId[], progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<TestResult[]> {
  const ws = controller.ws!;
  const built = build(ws, { targets });
  if (!built.ok) throw new Error(built.errors.join(' '));
  const ai = await getAi();
  const results: TestResult[] = [];
  const steps = targets.length * cases.length;
  for (const t of targets) {
    if (!(await hasCli(CLI[t].bin))) {
      for (const c of cases) results.push({ caseId: c.id, target: t, mode: 'agent', passed: false, detail: `The ${CLI[t].bin} CLI isn't installed, so ${PROFILES[t].displayName} couldn't be tested.`, at: new Date().toISOString() });
      progress.report({ increment: (100 * cases.length) / steps });
      continue;
    }
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `skillcraft-${t}-`));
    const src = path.join(built.outDir, ws.config.buildMode === 'universal' ? 'universal' : t, ws.config.name);
    const dest = path.join(scratch, PROFILES[t].install.project, ws.config.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    for (const c of cases) {
      if (token.isCancellationRequested) break;
      progress.report({ message: `${PROFILES[t].displayName}: ${c.prompt.slice(0, 40)}`, increment: 100 / steps });
      const r = await run(CLI[t].bin, CLI[t].args(c.prompt), scratch, 240000);
      const mentioned = r.out.includes(ws.config.name);
      let passed = r.code === 0 && (c.shouldTrigger ? mentioned || !!c.expect?.length : !mentioned);
      let detail = r.code !== 0 ? `The CLI exited with an error:\n${r.out.slice(-600)}` : passed ? 'Behaved as expected.' : c.shouldTrigger ? 'The skill did not appear to load.' : 'The skill loaded when it should not.';
      if (r.code === 0 && c.shouldTrigger && c.expect?.length && ai) {
        const v = await judge(ai, r.out, c.expect);
        passed = v.pass;
        detail = v.reason;
      }
      results.push({ caseId: c.id, target: t, mode: 'agent', passed, detail, at: new Date().toISOString() });
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return results;
}

export async function runTests(controller: Controller): Promise<void> {
  const ws = controller.ws;
  if (!ws || !controller.root) {
    void vscode.window.showInformationMessage('Tests need a SkillCraft project. Create or adopt one first.');
    return;
  }
  const cases = ws.tests.filter((c) => !c.prompt.startsWith('TODO'));
  if (!cases.length) {
    const open = await vscode.window.showWarningMessage('Add real prompts to tests/cases.json first (the starter cases still say TODO), or ask the coach to write some.', 'Open tests', 'Ask the coach');
    if (open === 'Open tests') void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(controller.root, 'tests/cases.json')));
    if (open === 'Ask the coach') void vscode.commands.executeCommand('skillcraft.coachReview');
    return;
  }
  const mode = await vscode.window.showQuickPick(
    [
      { label: '$(zap) Quick test', description: 'Uses your AI model — checks triggering and behavior in seconds', id: 'quick' },
      { label: '$(terminal) Real agent test', description: `Runs ${ws.config.targets.map((t) => CLI[t].bin).join(', ')} headlessly with the built skill — slower, most faithful`, id: 'agent' },
    ],
    { title: `Run ${cases.length} test case${cases.length === 1 ? '' : 's'}` },
  );
  if (!mode) return;
  if (mode.id === 'agent') {
    const ok = await vscode.window.showWarningMessage('Agent tests run each tool\'s CLI in a temporary folder with the built skill. The agents may run the skill\'s scripts, which can call your APIs. Continue?', { modal: true }, 'Run agent tests');
    if (!ok) return;
  }
  try {
    const results = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Testing skill', cancellable: true }, (progress, token) =>
      mode.id === 'quick' ? quickTests(controller, cases, progress, token) : agentTests(controller, cases, ws.config.targets, progress, token),
    );
    const fresh = loadWorkspace(controller.root)!;
    const keep = (fresh.state.testResults ?? []).filter((r) => !results.some((n) => n.caseId === r.caseId && n.target === r.target));
    saveState(controller.root, { ...fresh.state, testResults: [...keep, ...results] });
    controller.refresh();
    showResults(results, cases);
  } catch (e) {
    void vscode.window.showErrorMessage(`Tests couldn't run: ${(e as Error).message}`);
  }
}

const output = vscode.window.createOutputChannel('SkillCraft Tests');

function showResults(results: TestResult[], cases: TestCase[]): void {
  const passed = results.filter((r) => r.passed).length;
  output.clear();
  output.appendLine(`SkillCraft tests — ${passed}/${results.length} passed\n`);
  for (const r of results) {
    const c = cases.find((x) => x.id === r.caseId);
    output.appendLine(`${r.passed ? '✓' : '✗'} [${r.target}] ${c?.prompt ?? r.caseId}`);
    output.appendLine(`    ${r.detail.replace(/\n/g, '\n    ')}`);
  }
  output.show(true);
  const msg = `${passed}/${results.length} tests passed.`;
  if (passed === results.length) void vscode.window.showInformationMessage(msg);
  else void vscode.window.showWarningMessage(`${msg} See the SkillCraft Tests output for details.`);
}
