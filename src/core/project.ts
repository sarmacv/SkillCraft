// The SkillCraft workspace: project file, workflow graph, tests and local state.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectConfig, ScriptLanguage, TargetId, Workflow } from './types';

export const PROJECT_FILE = 'skillcraft.json';
export const WORKFLOW_FILE = 'workflow.json';
export const TESTS_FILE = 'tests/cases.json';
export const STATE_FILE = '.skillcraft/state.json';
export const DIST_DIR = 'dist';

export interface TestCase {
  id: string;
  prompt: string;
  /** Should the skill trigger for this prompt? */
  shouldTrigger: boolean;
  /** Phrases the answer should mention (checked by the judge). */
  expect?: string[];
}

export interface TestResult {
  caseId: string;
  target: string;
  mode: 'quick' | 'agent';
  passed: boolean;
  detail: string;
  at: string;
}

export interface LocalState {
  testResults?: TestResult[];
  lastBuild?: { at: string; targets: TargetId[]; ok: boolean };
  /** Applied proposals, newest last, with the inverse changes needed to undo them. */
  history?: { key: string; title: string; at: string; undo: import('./types').FileChange[]; workflowBefore?: Workflow }[];
}

export interface Workspace {
  root: string;
  config: ProjectConfig;
  workflow: Workflow;
  tests: TestCase[];
  state: LocalState;
}

export function emptyWorkflow(): Workflow {
  return { version: 1, nodes: [], edges: [] };
}

export function defaultConfig(name: string, language: ScriptLanguage = 'python', targets: TargetId[] = ['claude', 'codex', 'copilot']): ProjectConfig {
  return {
    name,
    version: '0.1.0',
    skillPath: `skills/${name}`,
    language,
    targets,
    buildMode: 'tailored',
  };
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function hasProject(root: string): boolean {
  return fs.existsSync(path.join(root, PROJECT_FILE));
}

export function loadWorkspace(root: string): Workspace | undefined {
  if (!hasProject(root)) return undefined;
  const config = readJson<ProjectConfig | undefined>(path.join(root, PROJECT_FILE), undefined);
  if (!config) return undefined;
  const { $schema: _ignored, ...rest } = config;
  return {
    root,
    config: { ...rest, targets: rest.targets?.length ? rest.targets : ['claude'] },
    workflow: readJson<Workflow>(path.join(root, WORKFLOW_FILE), emptyWorkflow()),
    tests: readJson<TestCase[]>(path.join(root, TESTS_FILE), []),
    state: readJson<LocalState>(path.join(root, STATE_FILE), {}),
  };
}

export function serializeConfig(config: ProjectConfig): string {
  return JSON.stringify(config, null, 2) + '\n';
}

export function serializeWorkflow(workflow: Workflow): string {
  return JSON.stringify(workflow, null, 2) + '\n';
}

export function saveWorkflow(root: string, workflow: Workflow): void {
  fs.writeFileSync(path.join(root, WORKFLOW_FILE), serializeWorkflow(workflow));
}

export function saveState(root: string, state: LocalState): void {
  const file = path.join(root, STATE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

export function skillDir(ws: Workspace): string {
  return path.join(ws.root, ws.config.skillPath);
}
