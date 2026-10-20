// Reverse-engineer an orchestration graph from an existing skill.
// Static analysis only — every node carries its evidence and a confidence,
// and the user confirms or corrects it on the canvas. The AI coach can refine further.

import * as path from 'node:path';
import { scriptEnvVars } from './checks';
import type { Skill } from './skill';
import type { Workflow, WorkflowEdge, WorkflowNode } from './types';
import { autoLayout, connect } from './workflow';

const LANG: Record<string, string> = { '.py': 'python', '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.ts': 'node', '.sh': 'bash', '.bash': 'bash' };

const KNOWN_HOSTS: [RegExp, string][] = [
  [/atlassian\.net|jira/i, 'Jira'],
  [/slack\.com/i, 'Slack'],
  [/api\.github\.com|github/i, 'GitHub'],
  [/googleapis\.com/i, 'Google API'],
  [/graph\.microsoft\.com/i, 'Microsoft Graph'],
  [/notion\.(so|com)/i, 'Notion'],
  [/salesforce\.com/i, 'Salesforce'],
  [/linear\.app/i, 'Linear'],
  [/api\.openai\.com/i, 'OpenAI API'],
  [/api\.anthropic\.com/i, 'Anthropic API'],
];

const HTTP_LIB = /\b(requests|httpx|urllib\.request|aiohttp|axios|fetch\(|got\(|curl\s)/;
const DB_LIB = /\b(psycopg2?|pg\b|mysql|sqlite3|sqlalchemy|pymongo|mongodb|better-sqlite3|knex|prisma)\b/;
const SDK_SOURCES: [RegExp, string, string][] = [
  [/\bjira\b|from jira import/i, 'Jira', 'source.rest'],
  [/slack_sdk|@slack\/web-api/, 'Slack', 'source.rest'],
  [/\bgithub\b.*import|PyGithub|@octokit/, 'GitHub', 'source.rest'],
  [/boto3|@aws-sdk/, 'AWS', 'source.rest'],
];

function humanize(file: string): string {
  const base = path.basename(file).replace(/\.\w+$/, '').replace(/[_-]+/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function firstComment(text: string): string {
  const doc = text.match(/^\s*(?:#!.*\n)?\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|\/\*\*?([\s\S]*?)\*\/|((?:\s*(?:#|\/\/)(?!!).*\n)+))/);
  const raw = (doc?.[1] ?? doc?.[2] ?? doc?.[3] ?? doc?.[4] ?? '').replace(/^\s*(#|\/\/|\*)\s?/gm, '').trim();
  return raw.split('\n')[0].slice(0, 160);
}

export function inferWorkflow(skill: Skill): Workflow {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const fm = skill.skillMd?.frontmatter ?? {};
  const body = skill.skillMd?.body ?? '';
  const mk = (n: Omit<WorkflowNode, 'position'>): WorkflowNode => {
    const node = { ...n, position: { x: 0, y: 0 } };
    nodes.push(node);
    return node;
  };
  const link = (a: WorkflowNode, b: WorkflowNode) => {
    if (!edges.some((e) => e.source === a.id && e.target === b.id)) edges.push(connect(a.id, b.id));
  };

  const trigger = mk({
    id: 'trigger', type: 'entry.trigger', label: 'Skill trigger',
    config: { whenToUse: String(fm.description ?? '') },
    inferred: { confidence: 0.95, evidence: 'from the description in SKILL.md frontmatter' },
  });

  let entry = trigger;
  const hint = typeof fm['argument-hint'] === 'string' ? fm['argument-hint'] : '';
  const inputSection = body.match(/^##+\s*(inputs?|parameters|arguments)\s*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/im);
  if (hint || /\$ARGUMENTS|\$\d/.test(body) || inputSection) {
    const params = inputSection
      ? inputSection[2].split('\n').filter((l) => /^\s*[-*]\s/.test(l)).map((l) => l.replace(/^\s*[-*]\s*/, '').replace(/\*\*|`/g, '')).join('\n')
      : hint || 'arguments: passed by the user';
    entry = mk({ id: 'inputs', type: 'entry.input', label: 'Inputs', config: { params }, inferred: { confidence: inputSection ? 0.85 : 0.6, evidence: inputSection ? 'from the Inputs section' : 'skill uses $ARGUMENTS / argument-hint' } });
    link(trigger, entry);
  }

  const ai = mk({
    id: 'instructions', type: 'module.ai', label: 'Follow instructions',
    config: { instructions: body.split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '')).join(' → ') || body.trim().slice(0, 240) },
    inferred: { confidence: 0.6, evidence: 'the judgment steps written in SKILL.md' },
  });

  const sourceByLabel = new Map<string, WorkflowNode>();
  const outputs: WorkflowNode[] = [];

  for (const f of skill.files) {
    const lang = LANG[path.extname(f.rel).toLowerCase()];
    if (!f.rel.startsWith('scripts/') && !(lang && !f.rel.includes('/'))) continue;
    if (!lang || f.text === undefined || f.rel.includes('/lib/')) continue;
    const text = f.text;
    const script = mk({
      id: `script_${f.rel.replace(/[^\w]+/g, '_')}`, type: 'module.script', label: humanize(f.rel),
      config: { purpose: firstComment(text) || `Runs ${f.rel}`, file: f.rel, language: lang },
      inferred: { confidence: 0.9, evidence: `script ${f.rel}` },
      customCode: true,
    });
    link(entry, script);
    link(script, ai);

    const env = scriptEnvVars(text, lang);
    const urls = [...text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)].map((m) => m[0]);
    const hosts = new Set(urls.map((u) => { try { return new URL(u.replace(/\{.*?\}/g, 'x')).host; } catch { return ''; } }).filter(Boolean));

    const addSource = (label: string, type: string, config: WorkflowNode['config'], evidence: string, confidence: number) => {
      const key = `${type}:${label}`;
      let src = sourceByLabel.get(key);
      if (!src) {
        src = mk({ id: `src_${label.replace(/[^\w]+/g, '_').toLowerCase()}`, type, label, config, inferred: { confidence, evidence } });
        sourceByLabel.set(key, src);
      }
      link(src, script);
      return src;
    };

    for (const host of hosts) {
      if (/hooks\.slack\.com|webhook\.office\.com/.test(host)) continue;
      const known = KNOWN_HOSTS.find(([re]) => re.test(host))?.[1];
      const tokenEnv = env.find((v) => /TOKEN|KEY|SECRET|PASSWORD/.test(v)) ?? '';
      addSource(known ?? host, 'source.rest', { baseUrl: `https://${host}`, path: '', method: 'GET', auth: tokenEnv ? 'bearer token' : 'none', tokenEnv }, `${f.rel} calls ${host}`, known ? 0.85 : 0.7);
    }
    if (!hosts.size && HTTP_LIB.test(text)) {
      addSource('HTTP API', 'source.rest', { baseUrl: '', path: '', method: 'GET', auth: 'none' }, `${f.rel} uses an HTTP client`, 0.5);
    }
    for (const [re, label, type] of SDK_SOURCES) {
      if (re.test(text) && ![...sourceByLabel.keys()].some((k) => k.endsWith(`:${label}`))) addSource(label, type, { baseUrl: '', path: '', method: 'GET', auth: 'bearer token' }, `${f.rel} imports the ${label} SDK`, 0.75);
    }
    if (DB_LIB.test(text)) {
      const driver = /sqlite/.test(text) ? 'sqlite' : /mysql/.test(text) ? 'mysql' : 'postgres';
      addSource('Database', 'source.database', { driver, connectionEnv: env.find((v) => /DATABASE|DB_|_URL|DSN/.test(v)) ?? '', sql: '' }, `${f.rel} uses a ${driver} driver`, 0.7);
    }
    if (/subprocess\.(run|check_output|Popen)|child_process|execSync|spawn\(/.test(text)) {
      const cmd = text.match(/(?:subprocess\.\w+|execSync|spawn)\(\s*\[?\s*["']([\w.-]+)/)?.[1] ?? '';
      addSource(cmd ? `${cmd} CLI` : 'CLI tool', 'source.cli', { command: cmd }, `${f.rel} runs a command`, 0.6);
    }

    const webhookEnv = env.find((v) => /WEBHOOK|SLACK|TEAMS|SMTP/.test(v));
    if (webhookEnv || /hooks\.slack\.com|smtplib|nodemailer/.test(text)) {
      const channel = /smtp|nodemailer/i.test(text + (webhookEnv ?? '')) ? 'email (SMTP)' : /teams|office\.com/i.test(text + (webhookEnv ?? '')) ? 'teams webhook' : 'slack webhook';
      const out = mk({ id: `out_msg_${script.id}`, type: 'output.message', label: channel.startsWith('email') ? 'Send email' : 'Send message', config: { channel, targetEnv: webhookEnv ?? '' }, inferred: { confidence: 0.75, evidence: `${f.rel} posts to ${channel}` } });
      link(script, out);
      outputs.push(out);
    }
    const written = text.match(/open\(\s*[^,]+,\s*["']w|writeFileSync\(\s*["'`]([^"'`]+)|>\s*([\w.-]+\.(md|csv|json|txt|html))/);
    if (written) {
      const file = written[1] ?? written[2] ?? 'output file';
      const out = mk({ id: `out_file_${script.id}`, type: 'output.file', label: 'Write file', config: { path: file }, inferred: { confidence: 0.6, evidence: `${f.rel} writes a file` } });
      link(script, out);
      outputs.push(out);
    }
  }

  // MCP tools mentioned in the instructions.
  const mcpRefs = new Map<string, Set<string>>();
  for (const m of body.matchAll(/mcp__([\w-]+)__([\w-]+)/g)) mcpRefs.set(m[1], (mcpRefs.get(m[1]) ?? new Set()).add(m[2]));
  for (const m of body.matchAll(/\b([A-Z][\w-]+)\s+MCP\b/g)) if (!mcpRefs.has(m[1].toLowerCase())) mcpRefs.set(m[1].toLowerCase(), new Set());
  for (const [server, tools] of mcpRefs) {
    const src = mk({ id: `mcp_${server}`, type: 'source.mcp', label: `${server} (MCP)`, config: { server, tool: [...tools].join(', '), usage: '' }, inferred: { confidence: tools.size ? 0.85 : 0.55, evidence: 'MCP tool named in SKILL.md' } });
    link(entry, src);
    link(src, ai);
  }

  // Reference docs and assets.
  for (const f of skill.files.filter((x) => x.rel.startsWith('references/'))) {
    const ref = skill.references.find((r) => r.target === f.rel);
    const line = ref ? body.split('\n')[ref.line - (skill.skillMd?.bodyStartLine ?? 1)] ?? '' : '';
    const when = line.match(/when ([^.]+)/i)?.[1] ?? '';
    const src = mk({ id: `ref_${f.rel.replace(/[^\w]+/g, '_')}`, type: 'source.reference', label: humanize(f.rel), config: { file: f.rel, readWhen: when }, inferred: { confidence: 0.9, evidence: `reference file ${f.rel}` } });
    link(src, ai);
  }

  if (/\b(reply|respond|return|summar(y|ize)|tell the user|present)\b/i.test(body) || !outputs.length) {
    const ret = mk({ id: 'out_reply', type: 'output.return', label: 'Reply in chat', config: { format: '' }, inferred: { confidence: outputs.length ? 0.6 : 0.5, evidence: 'the skill answers the user in chat' } });
    outputs.push(ret);
  }
  for (const o of outputs) if (!edges.some((e) => e.target === o.id)) link(ai, o);
  if (!edges.some((e) => e.target === ai.id)) link(entry, ai);

  return autoLayout({ version: 1, nodes, edges });
}
