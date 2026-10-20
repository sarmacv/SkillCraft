// Single source of truth for the extension: the open project (or the existing
// skill being analyzed), its health report, pending proposals and coach questions.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runChecks } from '../core/checks';
import { syncProposal } from '../core/codegen/generate';
import { type DetectedSkill, detectSkills } from '../core/detect';
import type { CoachQuestion, ViewState } from '../core/messages';
import { loadWorkspace, PROJECT_FILE, saveState, saveWorkflow, serializeConfig, type Workspace } from '../core/project';
import { applyChanges } from '../core/proposals';
import { loadSkill, type Skill } from '../core/skill';
import type { HealthReport, ProjectConfig, Proposal, Workflow } from '../core/types';
import { applyWorkflowChange } from '../core/workflow';

export class Controller implements vscode.Disposable {
  root?: string;
  ws?: Workspace;
  skill?: Skill;
  detected: DetectedSkill[] = [];
  /** Existing skill picked for analysis when there is no project yet. */
  analyzedDir?: string;
  report?: HealthReport;
  coach: CoachQuestion[] = [];
  coachBusy = false;
  modelName?: string;

  private checkProposals = new Map<string, Proposal>();
  private otherProposals = new Map<string, Proposal>();
  /** Rejections recorded before a project file exists. */
  private sessionRejected = new Set<string>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  readonly diagnostics = vscode.languages.createDiagnosticCollection('skillcraft');

  constructor() {
    this.root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  dispose(): void {
    this.changed.dispose();
    this.diagnostics.dispose();
  }

  get hasProject(): boolean {
    return !!this.ws;
  }

  get proposals(): Proposal[] {
    return [...this.otherProposals.values(), ...this.checkProposals.values()];
  }

  getProposal(key: string): Proposal | undefined {
    return this.otherProposals.get(key) ?? this.checkProposals.get(key);
  }

  addProposal(p: Proposal): void {
    this.otherProposals.set(p.key, p);
    this.changed.fire();
  }

  refresh(): void {
    if (!this.root) return;
    this.ws = loadWorkspace(this.root);
    void vscode.commands.executeCommand('setContext', 'skillcraft.hasProject', !!this.ws);
    this.detected = this.ws ? [] : detectSkills(this.root);
    const dir = this.ws ? path.join(this.root, this.ws.config.skillPath) : this.analyzedDir ?? (this.detected.length === 1 ? this.detected[0].dir : undefined);
    this.skill = dir && fs.existsSync(dir) ? loadSkill(dir) : undefined;

    const cfg = vscode.workspace.getConfiguration('skillcraft');
    const thresholds = { skillMdLines: cfg.get('thresholds.skillMdLines', 500), skillMdTokens: cfg.get('thresholds.skillMdTokens', 5000) };
    this.checkProposals.clear();
    if (this.skill) {
      const config = this.ws?.config ?? ({ rejected: [...this.sessionRejected].map((key) => ({ key })) } as Partial<ProjectConfig> as ProjectConfig);
      const { report, proposals } = runChecks(this.skill, { root: this.root, config: this.ws ? this.ws.config : { ...config, targets: [] }, workflow: this.ws?.workflow, tests: this.ws?.tests, state: this.ws?.state, thresholds });
      this.report = report;
      for (const p of proposals) this.checkProposals.set(p.key, p);
    } else {
      this.report = undefined;
    }
    // Drop stale sync proposals; the canvas regenerates them on demand.
    for (const [k, p] of this.otherProposals) if (p.source === 'sync' && this.ws && syncProposal(this.ws)?.key !== k) this.otherProposals.delete(k);
    this.publishDiagnostics();
    this.changed.fire();
  }

  private publishDiagnostics(): void {
    this.diagnostics.clear();
    if (!this.root || !this.report) return;
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of this.report.findings) {
      if (!f.file) continue;
      const abs = path.join(this.root, f.file);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
      const line = Math.max(0, (f.line ?? 1) - 1);
      const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 200), f.message, f.severity === 'error' ? vscode.DiagnosticSeverity.Error : f.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      d.source = 'SkillCraft';
      d.code = f.rule;
      byFile.set(abs, [...(byFile.get(abs) ?? []), d]);
    }
    for (const [file, diags] of byFile) this.diagnostics.set(vscode.Uri.file(file), diags);
  }

  /** Apply a proposal the user accepted. Records undo information. */
  accept(key: string): boolean {
    const p = this.getProposal(key);
    if (!p || !this.root) return false;
    try {
      const undo = applyChanges(this.root, p.changes);
      let workflowBefore: Workflow | undefined;
      const ws = loadWorkspace(this.root);
      if (p.workflow && ws) {
        workflowBefore = ws.workflow;
        saveWorkflow(this.root, applyWorkflowChange(ws.workflow, p.workflow));
      }
      const fresh = loadWorkspace(this.root);
      if (fresh) {
        const history = [...(fresh.state.history ?? []), { key: p.key, title: p.title, at: new Date().toISOString(), undo, workflowBefore }].slice(-50);
        saveState(this.root, { ...fresh.state, history });
      }
      this.otherProposals.delete(key);
      this.checkProposals.delete(key);
      this.refresh();
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage(`Couldn't apply "${p.title}": ${(e as Error).message}`);
      return false;
    }
  }

  reject(key: string, reason?: string): void {
    const p = this.getProposal(key);
    this.otherProposals.delete(key);
    this.checkProposals.delete(key);
    if (p && this.ws && this.root && p.source !== 'sync') {
      const config: ProjectConfig = { ...this.ws.config, rejected: [...(this.ws.config.rejected ?? []).filter((r) => r.key !== key), { key, ...(reason ? { reason } : {}) }] };
      fs.writeFileSync(path.join(this.root, PROJECT_FILE), serializeConfig(config));
    } else {
      this.sessionRejected.add(key);
    }
    this.refresh();
  }

  undo(): string | undefined {
    if (!this.root) return undefined;
    const ws = loadWorkspace(this.root);
    const last = ws?.state.history?.at(-1);
    if (!ws || !last) return undefined;
    applyChanges(this.root, last.undo);
    if (last.workflowBefore) saveWorkflow(this.root, last.workflowBefore);
    const after = loadWorkspace(this.root);
    if (after) saveState(this.root, { ...after.state, history: (after.state.history ?? []).slice(0, -1) });
    this.refresh();
    return last.title;
  }

  /** The user edited the canvas — their own change, saved directly. */
  saveWorkflow(workflow: Workflow): void {
    if (!this.root || !this.ws) return;
    saveWorkflow(this.root, workflow);
    this.refresh();
  }

  /** The user changed a project setting in the UI — their own change, saved directly. */
  updateConfig(patch: Partial<ProjectConfig>): void {
    if (!this.root || !this.ws) return;
    fs.writeFileSync(path.join(this.root, PROJECT_FILE), serializeConfig({ ...this.ws.config, ...patch }));
    this.refresh();
  }

  viewState(): ViewState {
    const fm = this.skill?.skillMd?.frontmatter;
    const r = this.report;
    return {
      hasProject: !!this.ws,
      project: this.ws
        ? { name: this.ws.config.name, language: this.ws.config.language, targets: this.ws.config.targets, buildMode: this.ws.config.buildMode, description: String(fm?.description ?? '') }
        : undefined,
      workflow: this.ws?.workflow ?? { version: 1, nodes: [], edges: [] },
      findings: r?.findings ?? [],
      readiness: r?.readiness ?? 'draft',
      readinessChecklist: r?.readinessChecklist ?? [],
      efficiencyScore: r?.efficiencyScore ?? 100,
      budget: r?.budget ?? { metadataTokens: 0, instructionTokens: 0, references: [] },
      portability: r?.portability ?? { claude: 'ok', codex: 'ok', copilot: 'ok' },
      ghosts: this.proposals.filter((p) => p.workflow).map((p) => ({ proposalKey: p.key, title: p.title, change: p.workflow! })),
      coach: this.coach,
      coachBusy: this.coachBusy,
      modelName: this.modelName,
    };
  }
}
