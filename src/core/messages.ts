// Messages between the extension host and the orchestrator webview (browser-safe).

import type { BuildMode, ContextBudget, Finding, Readiness, ScriptLanguage, TargetId, Workflow, WorkflowChange } from './types';

export interface CoachQuestion {
  id: string;
  area: string;
  question: string;
  why?: string;
  /** Quick answers shown as chips. */
  options?: string[];
  /** What "Decide for me" will propose. */
  suggestion?: string;
}

export interface GhostChange {
  proposalKey: string;
  title: string;
  change: WorkflowChange;
}

export interface ViewState {
  hasProject: boolean;
  project?: {
    name: string;
    language: ScriptLanguage;
    targets: TargetId[];
    buildMode: BuildMode;
    description: string;
  };
  workflow: Workflow;
  findings: Finding[];
  readiness: Readiness;
  readinessChecklist: { label: string; done: boolean }[];
  efficiencyScore: number;
  budget: ContextBudget;
  portability: Record<TargetId, 'ok' | 'warn' | 'fail'>;
  ghosts: GhostChange[];
  coach: CoachQuestion[];
  coachBusy: boolean;
  modelName?: string;
}

export type HostMessage =
  | { type: 'state'; state: ViewState }
  | { type: 'nodeTestResult'; nodeId: string; ok: boolean; detail: string }
  | { type: 'select'; nodeId: string };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'workflow'; workflow: Workflow }
  | { type: 'config'; patch: { language?: ScriptLanguage; targets?: TargetId[]; buildMode?: BuildMode } }
  | { type: 'command'; command: 'sync' | 'build' | 'coach' | 'preview' | 'runTests' | 'describe' | 'import' | 'sketch' | 'template' }
  | { type: 'testNode'; nodeId: string }
  | { type: 'proposal'; key: string; action: 'accept' | 'reject' | 'preview' }
  | { type: 'coachAnswer'; id: string; answer?: string; decide?: boolean; skip?: boolean }
  | { type: 'openFinding'; finding: Finding };
