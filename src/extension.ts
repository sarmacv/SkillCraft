import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { build } from './core/build';
import { renderWorkflowSection, replaceManagedSection, syncProposal } from './core/codegen/generate';
import { inferWorkflow } from './core/infer';
import type { WebviewMessage } from './core/messages';
import { PROFILES } from './core/profiles';
import { loadWorkspace, saveState } from './core/project';
import { adoptProposal, newProjectProposal } from './core/proposals';
import { joinFrontmatter, loadSkill, slugify, splitFrontmatter } from './core/skill';
import { TEMPLATES } from './core/templates';
import type { ScriptLanguage, TargetId } from './core/types';
import { chooseModel, describeAi, initAi, setApiKey } from './vscode/ai';
import { registerChat } from './vscode/chat';
import { coachAnswer, coachReview } from './vscode/coach';
import { Controller } from './vscode/controller';
import { Orchestrator } from './vscode/orchestrator';
import { acceptProposal, previewProposal, registerReview, rejectProposal } from './vscode/review';
import { runTests } from './vscode/tests';
import { registerTools } from './vscode/tools';
import { HealthTree, ProposalsTree, SkillsTree } from './vscode/views';

const PREVIEW_SCHEME = 'skillcraft-preview';

/** Tree-view commands receive a TreeItem; palette and webview callers pass the key. */
const keyOf = (arg: unknown): string | undefined => (typeof arg === 'string' ? arg : (arg as vscode.TreeItem | undefined)?.id);

export function activate(context: vscode.ExtensionContext): void {
  initAi(context);
  const controller = new Controller();
  context.subscriptions.push(controller);
  registerReview(context, controller);
  registerChat(context, controller);
  registerTools(context, controller);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('skillcraft.skills', new SkillsTree(controller)),
    vscode.window.registerTreeDataProvider('skillcraft.health', new HealthTree(controller)),
    vscode.window.registerTreeDataProvider('skillcraft.proposals', new ProposalsTree(controller)),
  );

  const previewEmitter = new vscode.EventEmitter<vscode.Uri>();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
      onDidChange: previewEmitter.event,
      provideTextDocumentContent: () => {
        const ws = controller.ws;
        const raw = controller.skill?.rawSkillMd;
        if (!ws || !raw) return '# No skill yet';
        const parsed = splitFrontmatter(raw);
        return joinFrontmatter(parsed.frontmatter ?? {}, replaceManagedSection(parsed.body, renderWorkflowSection(ws.workflow, ws.config.language)));
      },
    }),
  );
  controller.onDidChange(() => previewEmitter.fire(vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: '/SKILL.md' })));

  const requireRoot = (): string | undefined => {
    if (!controller.root) void vscode.window.showWarningMessage('Open a folder first (File → Open Folder). SkillCraft works inside a workspace folder.');
    return controller.root;
  };

  const openOrchestrator = (nodeId?: string) => Orchestrator.show(context, controller, (m) => void handleWebview(m), nodeId);

  async function chooseTargets(): Promise<TargetId[] | undefined> {
    const picked = await vscode.window.showQuickPick(
      (Object.keys(PROFILES) as TargetId[]).map((t) => ({ label: PROFILES[t].displayName, id: t, picked: true })),
      { title: 'Which tools is this skill for?', canPickMany: true },
    );
    return picked?.length ? picked.map((p) => p.id) : undefined;
  }

  async function chooseLanguage(): Promise<ScriptLanguage | undefined> {
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Python', description: 'Best default — runs almost everywhere', id: 'python' as const },
        { label: 'Node.js', description: 'Great for JSON-heavy APIs', id: 'node' as const },
        { label: 'Bash', description: 'Simplest — curl and shell tools', id: 'bash' as const },
      ],
      { title: 'Language for generated scripts' },
    );
    return picked?.id;
  }

  async function startProject(kind: 'sketch' | 'template'): Promise<void> {
    const root = requireRoot();
    if (!root) return;
    if (controller.ws) return openOrchestrator();
    let template = undefined as (typeof TEMPLATES)[number] | undefined;
    if (kind === 'template') {
      const pick = await vscode.window.showQuickPick(TEMPLATES.map((t) => ({ label: t.title, detail: t.detail, t })), { title: 'Start from a template' });
      if (!pick) return;
      template = pick.t;
    }
    const name = await vscode.window.showInputBox({
      title: 'Name your skill',
      value: template?.name ?? slugify(path.basename(root)),
      prompt: 'Lowercase letters, numbers and hyphens — this becomes the skill folder name.',
      validateInput: (v) => (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) && v.length <= 64 ? undefined : 'Use lowercase letters, numbers and single hyphens, like weekly-report'),
    });
    if (!name) return;
    const targets = await chooseTargets();
    if (!targets) return;
    const language = await chooseLanguage();
    if (!language) return;
    const trigger = template?.workflow.nodes.find((n) => n.type === 'entry.trigger');
    const p = newProjectProposal({ name, language, targets, workflow: template?.workflow, description: trigger ? `${trigger.config.does} Use when ${trigger.config.whenToUse}.` : '', source: 'setup' });
    controller.addProposal(p);
    await previewProposal(controller, p.key);
    if (controller.ws) {
      openOrchestrator();
      if (template) {
        const sync = syncProposal(controller.ws);
        if (sync) {
          controller.addProposal(sync);
          void vscode.window.showInformationMessage('The template is on the canvas. Generate its scripts and SKILL.md now?', 'Review files').then((c) => c && previewProposal(controller, sync.key));
        }
      }
    }
  }

  async function importSkill(dirArg?: string): Promise<void> {
    const root = requireRoot();
    if (!root) return;
    controller.refresh();
    let dir = dirArg;
    if (!dir) {
      if (!controller.detected.length) {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri: vscode.Uri.file(root), openLabel: 'Analyze this skill folder' });
        dir = picked?.[0]?.fsPath;
        if (dir && !dir.startsWith(root)) {
          void vscode.window.showWarningMessage('Pick a folder inside the open workspace, or open the skill\'s folder in VS Code first.');
          return;
        }
      } else if (controller.detected.length === 1) {
        dir = controller.detected[0].dir;
      } else {
        const pick = await vscode.window.showQuickPick(controller.detected.map((d) => ({ label: d.name, description: d.rel, detail: d.description, d })), { title: 'Which skill should SkillCraft analyze?' });
        dir = pick?.d.dir;
      }
    }
    if (!dir) return;
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
      void vscode.window.showWarningMessage('That folder has no SKILL.md, so it isn\'t a skill yet. Use "Sketch a workflow" to start one.');
      return;
    }
    controller.analyzedDir = dir;
    controller.refresh();
    const skill = loadSkill(dir);
    const detected = controller.detected.find((d) => d.dir === dir);
    const name = slugify(String(skill.skillMd?.frontmatter?.name ?? skill.folderName)) || slugify(skill.folderName);
    const workflow = inferWorkflow(skill);
    const r = controller.report;
    const errors = r?.findings.filter((f) => f.severity === 'error').length ?? 0;
    const warnings = r?.findings.filter((f) => f.severity === 'warning').length ?? 0;
    const adopt = adoptProposal(root, dir, skill.folderName === name ? name : skill.folderName, workflow, detected?.formats ?? []);
    controller.addProposal(adopt);
    void vscode.commands.executeCommand('skillcraft.health.focus');
    const choice = await vscode.window.showInformationMessage(
      `Analyzed "${name}": ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${controller.proposals.length - 1} suggested fixes. ${workflow.nodes.length} workflow components inferred.`,
      { detail: 'Review the Health and Proposals views. Adopting adds a project file and the inferred workflow next to your skill — your files stay where they are.' },
      'Adopt and open orchestrator',
      'Just show the findings',
    );
    if (choice === 'Adopt and open orchestrator') {
      await previewProposal(controller, adopt.key);
      if (controller.ws) openOrchestrator();
    }
  }

  async function runBuild(): Promise<boolean> {
    const root = requireRoot();
    const ws = root ? loadWorkspace(root) : undefined;
    if (!root || !ws) {
      void vscode.window.showInformationMessage('Build needs a SkillCraft project. Create or adopt one first.');
      return false;
    }
    const pending = syncProposal(ws);
    if (pending) {
      const c = await vscode.window.showWarningMessage('Your files are behind the workflow on the canvas. Sync them before building?', { modal: true }, 'Review sync first', 'Build anyway');
      if (!c) return false;
      if (c === 'Review sync first') {
        controller.addProposal(pending);
        await previewProposal(controller, pending.key);
        return false;
      }
    }
    const errors = controller.report?.findings.filter((f) => f.severity === 'error') ?? [];
    if (errors.length) {
      const c = await vscode.window.showWarningMessage(`${errors.length} error${errors.length === 1 ? '' : 's'} found: ${errors[0].message}`, { modal: true }, 'Build anyway');
      if (!c) return false;
    }
    const result = build(loadWorkspace(root)!);
    const fresh = loadWorkspace(root)!;
    saveState(root, { ...fresh.state, lastBuild: { at: new Date().toISOString(), targets: fresh.config.targets, ok: result.ok } });
    controller.refresh();
    if (!result.ok) {
      void vscode.window.showErrorMessage(`Build failed: ${result.errors.join(' ')}`);
      return false;
    }
    const warnings = result.builds.flatMap((b) => b.warnings.map((w) => `${b.target}: ${w}`));
    const action = await vscode.window.showInformationMessage(
      `Built for ${result.builds.map((b) => (b.target === 'universal' ? 'all tools (universal)' : PROFILES[b.target as TargetId].displayName)).join(', ')}.${warnings.length ? ` ${warnings.length} note${warnings.length === 1 ? '' : 's'}.` : ''}`,
      { detail: warnings.join('\n') || undefined },
      'Open README',
      'Install…',
    );
    if (action === 'Open README') void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(result.outDir, 'README.md')));
    if (action === 'Install…') void vscode.commands.executeCommand('skillcraft.install');
    return true;
  }

  async function install(): Promise<void> {
    const root = requireRoot();
    const ws = root ? loadWorkspace(root) : undefined;
    if (!root || !ws) return;
    const items = ws.config.targets.flatMap((t) => [
      { label: `${PROFILES[t].displayName} — this project`, description: `${PROFILES[t].install.project}/${ws.config.name}`, t, user: false },
      { label: `${PROFILES[t].displayName} — just me, all projects`, description: `${PROFILES[t].install.user}/${ws.config.name}`, t, user: true },
    ]);
    const pick = await vscode.window.showQuickPick(items, { title: 'Install the built skill', placeHolder: 'Where should it go?' });
    if (!pick) return;
    const folder = ws.config.buildMode === 'universal' ? 'universal' : pick.t;
    const src = path.join(root, 'dist', folder, ws.config.name);
    if (!fs.existsSync(src)) {
      const c = await vscode.window.showWarningMessage('Build the skill first.', 'Build now');
      if (c && (await runBuild())) return install();
      return;
    }
    const base = pick.user ? PROFILES[pick.t].install.user.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? '~') : path.join(root, PROFILES[pick.t].install.project);
    const dest = path.join(base, ws.config.name);
    const ok = await vscode.window.showInformationMessage(`Install ${ws.config.name} to ${dest}?`, { modal: true, detail: fs.existsSync(dest) ? 'An existing copy there will be replaced.' : undefined }, 'Install');
    if (!ok) return;
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(base, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    void vscode.window.showInformationMessage(`Installed for ${PROFILES[pick.t].displayName}. Start a new agent session to pick it up — see dist/${folder}/SETUP.md for credentials and MCP setup.`, 'Open SETUP.md').then((c) => c && vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(root, 'dist', folder, 'SETUP.md'))));
  }

  async function sync(): Promise<void> {
    if (!controller.ws) return void vscode.window.showInformationMessage('Create or adopt a skill project first.');
    const p = syncProposal(controller.ws);
    if (!p) return void vscode.window.showInformationMessage('Files already match the workflow.');
    controller.addProposal(p);
    await previewProposal(controller, p.key);
  }

  async function describe(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', { query: controller.ws ? '@skillcraft ' : '@skillcraft /new ', isPartialQuery: true });
    } catch {
      void vscode.window.showInformationMessage('Open the Chat view and type "@skillcraft /new" to describe your skill.');
    }
  }

  async function handleWebview(m: WebviewMessage): Promise<void> {
    switch (m.type) {
      case 'workflow':
        return controller.saveWorkflow(m.workflow);
      case 'config':
        return controller.updateConfig(m.patch);
      case 'proposal':
        if (m.action === 'accept') await acceptProposal(controller, m.key);
        else if (m.action === 'reject') await rejectProposal(controller, m.key);
        else await previewProposal(controller, m.key);
        return;
      case 'coachAnswer':
        return coachAnswer(controller, m.id, { text: m.answer, decide: m.decide, skip: m.skip });
      case 'openFinding': {
        if (!controller.root || !m.finding.file) return;
        const line = Math.max(0, (m.finding.line ?? 1) - 1);
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(controller.root, m.finding.file)), { viewColumn: vscode.ViewColumn.Beside, selection: new vscode.Range(line, 0, line, 0) });
        return;
      }
      case 'command': {
        const map = { sync: 'skillcraft.syncFiles', build: 'skillcraft.build', coach: 'skillcraft.coachReview', preview: 'skillcraft.previewSkillMd', runTests: 'skillcraft.runTests', describe: 'skillcraft.describe', import: 'skillcraft.importSkill', sketch: 'skillcraft.sketch', template: 'skillcraft.fromTemplate' } as const;
        await vscode.commands.executeCommand(map[m.command]);
      }
    }
  }

  const reg = (id: string, fn: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('skillcraft.describe', describe);
  reg('skillcraft.sketch', () => startProject('sketch'));
  reg('skillcraft.fromTemplate', () => startProject('template'));
  reg('skillcraft.importSkill', (dir?: string) => importSkill(typeof dir === 'string' ? dir : undefined));
  reg('skillcraft.openOrchestrator', (nodeId?: string) => {
    if (!controller.ws) return void vscode.window.showInformationMessage('Create or adopt a skill project first — use the SkillCraft sidebar to get started.');
    openOrchestrator(typeof nodeId === 'string' ? nodeId : undefined);
  });
  reg('skillcraft.analyze', () => {
    controller.refresh();
    void vscode.commands.executeCommand('skillcraft.health.focus');
  });
  reg('skillcraft.coachReview', () => coachReview(controller));
  reg('skillcraft.syncFiles', sync);
  reg('skillcraft.build', runBuild);
  reg('skillcraft.install', install);
  reg('skillcraft.runTests', () => runTests(controller));
  reg('skillcraft.previewSkillMd', () => vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: '/SKILL.md' })));
  reg('skillcraft.chooseModel', async () => {
    await chooseModel();
    controller.modelName = await describeAi();
    controller.refresh();
  });
  reg('skillcraft.setApiKey', setApiKey);
  reg('skillcraft.proposal.preview', (arg) => {
    const key = keyOf(arg);
    return key ? previewProposal(controller, key) : undefined;
  });
  reg('skillcraft.proposal.accept', (arg) => {
    const key = keyOf(arg);
    return key ? acceptProposal(controller, key) : undefined;
  });
  reg('skillcraft.proposal.reject', (arg) => {
    const key = keyOf(arg);
    return key ? rejectProposal(controller, key) : undefined;
  });
  reg('skillcraft.proposal.why', (arg) => {
    const p = controller.getProposal(keyOf(arg) ?? '');
    if (p) void vscode.window.showInformationMessage(p.title, { modal: true, detail: [p.why, p.impact].filter(Boolean).join('\n\n') });
  });
  reg('skillcraft.proposal.acceptGroup', async (arg) => {
    const priority = keyOf(arg)?.replace('group:', '');
    const group = controller.proposals.filter((p) => p.priority === priority);
    if (!group.length) return;
    const ok = await vscode.window.showWarningMessage(`Accept all ${group.length} ${priority} proposals?`, { modal: true, detail: group.map((p) => `• ${p.title}`).join('\n') }, 'Accept all');
    if (!ok) return;
    let applied = 0;
    for (const p of group) {
      // Earlier changes can make later ones stale (e.g. two edits to SKILL.md), so re-check each.
      if (controller.getProposal(p.key) && controller.accept(p.key)) applied++;
    }
    void vscode.window.showInformationMessage(`Applied ${applied} proposal${applied === 1 ? '' : 's'}. Run Analyze again to see what's left.`);
  });
  reg('skillcraft.undo', () => {
    const title = controller.undo();
    void vscode.window.showInformationMessage(title ? `Undid: ${title}` : 'Nothing to undo.');
  });

  // Keep the health report fresh.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  let timer: NodeJS.Timeout | undefined;
  const schedule = (uri: vscode.Uri) => {
    if (/[\\/](dist|node_modules|\.git|\.skillcraft)[\\/]/.test(uri.fsPath)) return;
    if (!vscode.workspace.getConfiguration('skillcraft').get('analyzeOnSave', true)) return;
    clearTimeout(timer);
    timer = setTimeout(() => controller.refresh(), 400);
  };
  context.subscriptions.push(watcher, watcher.onDidChange(schedule), watcher.onDidCreate(schedule), watcher.onDidDelete(schedule), { dispose: () => clearTimeout(timer) });

  controller.refresh();
  void describeAi().then((name) => {
    controller.modelName = name;
  });

  // Brownfield: offer analysis when a folder already contains skills.
  if (!controller.ws && controller.detected.length) {
    const n = controller.detected.length;
    void vscode.window
      .showInformationMessage(`SkillCraft found ${n} existing skill${n > 1 ? 's' : ''} in this folder. Check ${n > 1 ? 'them' : 'it'} for gaps?`, 'Analyze', 'Not now')
      .then((c) => {
        if (c === 'Analyze') void importSkill(n === 1 ? controller.detected[0].dir : undefined);
      });
  }
}

export function deactivate(): void {}
