// Shared data model. Imported by both the extension host and the webview,
// so this file must stay free of Node and VS Code imports.

export type TargetId = 'claude' | 'codex' | 'copilot';
export const ALL_TARGETS: TargetId[] = ['claude', 'codex', 'copilot'];

export type ScriptLanguage = 'python' | 'node' | 'bash';
export type BuildMode = 'universal' | 'tailored';

export type Category = 'entry' | 'source' | 'module' | 'output';

/** skillcraft.json — the project file at the workspace root. */
export interface ProjectConfig {
  $schema?: string;
  name: string;
  version: string;
  /** Folder holding the skill source, relative to the workspace root. Its basename must equal `name`. */
  skillPath: string;
  language: ScriptLanguage;
  targets: TargetId[];
  buildMode: BuildMode;
  /** Per-target customizations. */
  overrides?: Partial<Record<TargetId, TargetOverride>>;
  /** Proposal keys the user rejected; never suggested again. */
  rejected?: { key: string; reason?: string }[];
}

export interface TargetOverride {
  description?: string;
  /** Extra Markdown appended to SKILL.md for this target only. */
  extraInstructions?: string;
  /** Extra frontmatter fields for this target (validated against the target profile). */
  frontmatter?: Record<string, unknown>;
}

/** workflow.json — the orchestration graph shown on the canvas. */
export interface Workflow {
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  /** Component id from the catalog, e.g. "source.rest". Placeholders use "placeholder.<category>". */
  type: string;
  label: string;
  config: Record<string, string | number | boolean>;
  position: { x: number; y: number };
  /** Set when the node was reverse-engineered from an existing skill. */
  inferred?: { confidence: number; evidence: string; confirmed?: boolean };
  /** Targets this node is left out of. */
  excludeTargets?: TargetId[];
  /** Per-target component substitution, e.g. MCP in Claude but a REST script in Codex. */
  targetOverrides?: Partial<Record<TargetId, { type: string; config: Record<string, string | number | boolean> }>>;
  /** User took ownership of the generated file; SkillCraft will not regenerate it. */
  customCode?: boolean;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  rule: string;
  severity: Severity;
  area: 'structure' | 'integrity' | 'efficiency' | 'portability' | 'workflow' | 'docs';
  message: string;
  /** Workspace-relative path. */
  file?: string;
  line?: number;
  nodeId?: string;
  /** Key of a proposal that fixes this finding. */
  proposalKey?: string;
}

export type FileChange =
  | { kind: 'create'; path: string; content: string }
  | { kind: 'modify'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'rename'; path: string; newPath: string };

export interface WorkflowChange {
  addNodes?: WorkflowNode[];
  removeNodeIds?: string[];
  updateNodes?: (Partial<WorkflowNode> & { id: string })[];
  addEdges?: WorkflowEdge[];
  removeEdgeIds?: string[];
}

export type ProposalPriority = 'critical' | 'recommended' | 'optional';

export interface Proposal {
  /** Stable key: the same suggestion always has the same key, so rejections stick. */
  key: string;
  title: string;
  why: string;
  impact?: string;
  priority: ProposalPriority;
  source: 'checks' | 'coach' | 'chat' | 'sync' | 'import' | 'setup';
  changes: FileChange[];
  workflow?: WorkflowChange;
}

export type Readiness = 'draft' | 'runnable' | 'tested' | 'ready';

export interface ContextBudget {
  metadataTokens: number;
  instructionTokens: number;
  references: { path: string; tokens: number }[];
}

export interface HealthReport {
  skillName: string;
  findings: Finding[];
  budget: ContextBudget;
  efficiencyScore: number;
  readiness: Readiness;
  readinessChecklist: { label: string; done: boolean }[];
  portability: Record<TargetId, 'ok' | 'warn' | 'fail'>;
}
