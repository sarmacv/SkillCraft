// The component catalog: every block a user can drop on the canvas.
// Each entry is a manifest — the UI form, how it compiles into the skill,
// and how well each target tool supports it. New connectors are new entries,
// not new code paths. Browser-safe: shared with the webview.

import type { Category, TargetId } from './types';

export type FieldType = 'text' | 'textarea' | 'select' | 'env' | 'number' | 'boolean';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  help?: string;
}

/** How a component lands in the built skill. */
export type CompileKind = 'script' | 'instruction' | 'reference' | 'asset' | 'trigger';

export type Support = 'yes' | 'setup' | 'no';

export interface ComponentDef {
  id: string;
  category: Category;
  label: string;
  /** Codicon name. */
  icon: string;
  summary: string;
  compile: CompileKind;
  fields: FieldDef[];
  support: Record<TargetId, Support>;
  supportNote?: string;
}

const everywhere: Record<TargetId, Support> = { claude: 'yes', codex: 'yes', copilot: 'yes' };
const mcpSupport: Record<TargetId, Support> = { claude: 'setup', codex: 'setup', copilot: 'setup' };

const authFields: FieldDef[] = [
  { key: 'auth', label: 'Authentication', type: 'select', options: ['none', 'bearer token', 'api key header', 'basic'], required: true },
  { key: 'tokenEnv', label: 'Credential env var', type: 'env', placeholder: 'JIRA_API_TOKEN', help: 'Never paste secrets — reference an environment variable.' },
];

export const CATALOG: ComponentDef[] = [
  // Entry
  {
    id: 'entry.trigger', category: 'entry', label: 'Skill trigger', icon: 'zap', compile: 'trigger',
    summary: 'When the agent should use this skill',
    fields: [
      { key: 'does', label: 'What the skill does', type: 'textarea', required: true, placeholder: 'Builds a weekly status report from Jira tickets and Slack threads.' },
      { key: 'whenToUse', label: 'Use this skill when…', type: 'textarea', required: true, placeholder: 'the user asks for a weekly status report for their team' },
      { key: 'examples', label: 'Example requests (one per line)', type: 'textarea', placeholder: 'Write my weekly status update' },
    ],
    support: everywhere,
  },
  {
    id: 'entry.input', category: 'entry', label: 'Inputs', icon: 'symbol-parameter', compile: 'instruction',
    summary: 'Parameters the skill needs',
    fields: [
      { key: 'params', label: 'Parameters (name: description, one per line)', type: 'textarea', required: true, placeholder: 'team: Team key, e.g. PLAT\nsince: Start date (YYYY-MM-DD)' },
    ],
    support: everywhere,
  },
  {
    id: 'entry.files', category: 'entry', label: 'Attached files', icon: 'file-add', compile: 'instruction',
    summary: 'Files the user provides',
    fields: [{ key: 'accepts', label: 'Accepted file types', type: 'text', placeholder: '.pdf, .csv' }],
    support: everywhere,
  },

  // Sources
  {
    id: 'source.rest', category: 'source', label: 'REST API', icon: 'globe', compile: 'script',
    summary: 'Call an HTTP endpoint',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, placeholder: 'https://your-org.atlassian.net' },
      { key: 'path', label: 'Path', type: 'text', required: true, placeholder: '/rest/api/3/search' },
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'], required: true },
      { key: 'query', label: 'Query / body (JSON)', type: 'textarea', placeholder: '{"jql": "project = PLAT"}' },
      ...authFields,
    ],
    support: everywhere,
  },
  {
    id: 'source.graphql', category: 'source', label: 'GraphQL API', icon: 'graph', compile: 'script',
    summary: 'Run a GraphQL query',
    fields: [
      { key: 'endpoint', label: 'Endpoint', type: 'text', required: true, placeholder: 'https://api.github.com/graphql' },
      { key: 'query', label: 'Query', type: 'textarea', required: true },
      ...authFields,
    ],
    support: everywhere,
  },
  {
    id: 'source.mcp', category: 'source', label: 'MCP tool', icon: 'plug', compile: 'instruction',
    summary: 'Use a tool from an MCP server',
    fields: [
      { key: 'server', label: 'MCP server name', type: 'text', required: true, placeholder: 'slack' },
      { key: 'tool', label: 'Tool name', type: 'text', required: true, placeholder: 'search_messages' },
      { key: 'url', label: 'Server URL (for setup docs)', type: 'text', placeholder: 'https://mcp.slack.com/mcp' },
      { key: 'usage', label: 'How to use it', type: 'textarea', placeholder: 'Search the team channel for messages from the last 7 days' },
    ],
    support: mcpSupport,
    supportNote: 'Each tool configures MCP servers differently; SETUP.md includes the snippet for each.',
  },
  {
    id: 'source.reference', category: 'source', label: 'Local reference', icon: 'book', compile: 'reference',
    summary: 'Docs the agent reads when needed',
    fields: [
      { key: 'file', label: 'Reference file', type: 'text', required: true, placeholder: 'references/style-guide.md' },
      { key: 'readWhen', label: 'Read it when…', type: 'text', required: true, placeholder: 'formatting the final report' },
    ],
    support: everywhere,
  },
  {
    id: 'source.knowledge', category: 'source', label: 'Knowledge base', icon: 'database', compile: 'script',
    summary: 'Query a vector store or RAG endpoint',
    fields: [
      { key: 'endpoint', label: 'Search endpoint', type: 'text', required: true, placeholder: 'https://kb.example.com/search' },
      { key: 'topK', label: 'Results to return', type: 'number', placeholder: '5' },
      ...authFields,
    ],
    support: everywhere,
  },
  {
    id: 'source.database', category: 'source', label: 'Database', icon: 'server', compile: 'script',
    summary: 'Run a read-only SQL query',
    fields: [
      { key: 'driver', label: 'Database', type: 'select', options: ['postgres', 'mysql', 'sqlite'], required: true },
      { key: 'connectionEnv', label: 'Connection string env var', type: 'env', required: true, placeholder: 'DATABASE_URL' },
      { key: 'sql', label: 'Query', type: 'textarea', required: true },
    ],
    support: everywhere,
  },
  {
    id: 'source.files', category: 'source', label: 'Files and folders', icon: 'folder', compile: 'script',
    summary: 'Read local files',
    fields: [{ key: 'glob', label: 'File pattern', type: 'text', required: true, placeholder: 'data/**/*.csv' }],
    support: everywhere,
  },
  {
    id: 'source.web', category: 'source', label: 'Web page', icon: 'link', compile: 'script',
    summary: 'Fetch a page',
    fields: [{ key: 'url', label: 'URL', type: 'text', required: true }],
    support: everywhere,
  },
  {
    id: 'source.cli', category: 'source', label: 'CLI tool', icon: 'terminal', compile: 'script',
    summary: 'Run a command-line tool',
    fields: [
      { key: 'command', label: 'Command', type: 'text', required: true, placeholder: 'gh pr list --json title,url' },
      { key: 'requires', label: 'Requires (for setup docs)', type: 'text', placeholder: 'GitHub CLI (gh)' },
    ],
    support: everywhere,
  },

  // Modules
  {
    id: 'module.script', category: 'module', label: 'Script', icon: 'code', compile: 'script',
    summary: 'Deterministic code in your language',
    fields: [
      { key: 'purpose', label: 'What it does', type: 'textarea', required: true, placeholder: 'Merge tickets and messages into one list sorted by date' },
    ],
    support: everywhere,
  },
  {
    id: 'module.ai', category: 'module', label: 'AI step', icon: 'sparkle', compile: 'instruction',
    summary: 'Judgment the agent applies',
    fields: [
      { key: 'instructions', label: 'Instructions', type: 'textarea', required: true, placeholder: 'Pick the five most important items and summarize each in one line.' },
    ],
    support: everywhere,
  },
  {
    id: 'module.transform', category: 'module', label: 'Transform', icon: 'filter', compile: 'script',
    summary: 'Filter, map or merge data',
    fields: [
      { key: 'operation', label: 'Operation', type: 'select', options: ['filter', 'map', 'merge', 'sort', 'group'], required: true },
      { key: 'expression', label: 'Rule', type: 'text', placeholder: 'status != "Done"' },
    ],
    support: everywhere,
  },
  {
    id: 'module.condition', category: 'module', label: 'Condition', icon: 'git-compare', compile: 'instruction',
    summary: 'Branch on a rule',
    fields: [{ key: 'rule', label: 'If…', type: 'text', required: true, placeholder: 'no tickets were found' }],
    support: everywhere,
  },
  {
    id: 'module.loop', category: 'module', label: 'Loop', icon: 'sync', compile: 'instruction',
    summary: 'Repeat for each item',
    fields: [{ key: 'over', label: 'For each…', type: 'text', required: true, placeholder: 'repository in the list' }],
    support: everywhere,
  },
  {
    id: 'module.skill', category: 'module', label: 'Call another skill', icon: 'references', compile: 'instruction',
    summary: 'Hand off to a skill',
    fields: [{ key: 'skill', label: 'Skill name', type: 'text', required: true }],
    support: everywhere,
  },
  {
    id: 'module.approval', category: 'module', label: 'Human approval', icon: 'person', compile: 'instruction',
    summary: 'Ask before continuing',
    fields: [{ key: 'question', label: 'Ask the user', type: 'text', required: true, placeholder: 'Post this summary to Slack?' }],
    support: everywhere,
  },

  // Outputs
  {
    id: 'output.file', category: 'output', label: 'File or report', icon: 'file', compile: 'instruction',
    summary: 'Write a file',
    fields: [
      { key: 'path', label: 'File name', type: 'text', required: true, placeholder: 'status-report.md' },
      { key: 'template', label: 'Template (assets/)', type: 'text', placeholder: 'assets/report-template.md' },
    ],
    support: everywhere,
  },
  {
    id: 'output.message', category: 'output', label: 'Send a message', icon: 'mail', compile: 'script',
    summary: 'Slack, Teams or email via webhook',
    fields: [
      { key: 'channel', label: 'Channel', type: 'select', options: ['slack webhook', 'teams webhook', 'email (SMTP)'], required: true },
      { key: 'targetEnv', label: 'Webhook / SMTP env var', type: 'env', required: true, placeholder: 'SLACK_WEBHOOK_URL' },
    ],
    support: everywhere,
  },
  {
    id: 'output.api', category: 'output', label: 'API write-back', icon: 'cloud-upload', compile: 'script',
    summary: 'POST results to an API',
    fields: [
      { key: 'url', label: 'URL', type: 'text', required: true },
      ...authFields,
    ],
    support: everywhere,
  },
  {
    id: 'output.mcp', category: 'output', label: 'MCP action', icon: 'plug', compile: 'instruction',
    summary: 'Act through an MCP tool',
    fields: [
      { key: 'server', label: 'MCP server name', type: 'text', required: true },
      { key: 'tool', label: 'Tool name', type: 'text', required: true },
      { key: 'url', label: 'Server URL (for setup docs)', type: 'text' },
    ],
    support: mcpSupport,
    supportNote: 'Each tool configures MCP servers differently; SETUP.md includes the snippet for each.',
  },
  {
    id: 'output.return', category: 'output', label: 'Reply in chat', icon: 'comment', compile: 'instruction',
    summary: 'Return the result to the user',
    fields: [{ key: 'format', label: 'Format', type: 'text', placeholder: 'A bulleted list grouped by project' }],
    support: everywhere,
  },
];

export const CATEGORY_META: Record<Category, { label: string; color: string; hint: string }> = {
  entry: { label: 'Entry', color: 'gray', hint: 'How the skill starts' },
  source: { label: 'Sources', color: 'teal', hint: 'Where information comes from' },
  module: { label: 'Modules', color: 'purple', hint: 'What happens to it' },
  output: { label: 'Outputs', color: 'coral', hint: 'Where results go' },
};

const byId = new Map(CATALOG.map((c) => [c.id, c]));

export function getComponent(type: string): ComponentDef | undefined {
  return byId.get(type);
}

export function isPlaceholder(type: string): boolean {
  return type.startsWith('placeholder.');
}

export function categoryOf(type: string): Category {
  if (isPlaceholder(type)) return type.slice('placeholder.'.length) as Category;
  return byId.get(type)?.category ?? 'module';
}

/** Env var names referenced by a node's config. */
export function envVarsOf(type: string, config: Record<string, unknown>): string[] {
  const def = byId.get(type);
  if (!def) return [];
  return def.fields
    .filter((f) => f.type === 'env')
    .map((f) => String(config[f.key] ?? '').trim())
    .filter((v) => /^[A-Z_][A-Z0-9_]*$/.test(v));
}

/** Required fields still empty — drives the "Runnable" readiness stage. */
export function missingFields(type: string, config: Record<string, unknown>): FieldDef[] {
  const def = byId.get(type);
  if (!def) return [];
  return def.fields.filter((f) => f.required && String(config[f.key] ?? '').trim() === '');
}
