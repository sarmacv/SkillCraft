// Generated human docs: README.md for the build and SETUP.md per target tool.
// They live next to the built skill, never inside it.

import { envVarsOf, getComponent } from './catalog';
import { paramsOf } from './codegen/generate';
import { RUNNER } from './codegen/templates';
import { fill, PROFILES } from './profiles';
import type { TestResult } from './project';
import type { ProjectConfig, TargetId, Workflow } from './types';
import { topoOrder } from './workflow';

export interface DocInputs {
  config: ProjectConfig;
  workflow: Workflow;
  description: string;
  /** Env vars found in scripts as well as in the workflow. */
  envVars: string[];
  pythonDeps: string[];
  nodeDeps: boolean;
  notes?: string;
  setupNotes?: Partial<Record<TargetId, string>>;
  testResults?: TestResult[];
  builtTargets: TargetId[];
  universal: boolean;
}

const str = (v: unknown) => String(v ?? '').trim();

export function mermaid(wf: Workflow): string {
  if (!wf.nodes.length) return '';
  const id = (s: string) => s.replace(/[^\w]/g, '_');
  const shape = (n: Workflow['nodes'][number]) => {
    const label = n.label.replace(/"/g, "'");
    const cat = getComponent(n.type)?.category ?? n.type.split('.')[1];
    return cat === 'entry' ? `(["${label}"])` : cat === 'source' ? `[("${label}")]` : cat === 'output' ? `[/"${label}"/]` : `["${label}"]`;
  };
  const lines = ['```mermaid', 'flowchart LR'];
  for (const n of topoOrder(wf)) lines.push(`  ${id(n.id)}${shape(n)}`);
  for (const e of wf.edges) lines.push(`  ${id(e.source)} --> ${id(e.target)}`);
  lines.push('```');
  return lines.join('\n');
}

function mcpServers(wf: Workflow): { server: string; url: string; tools: string[] }[] {
  const map = new Map<string, { server: string; url: string; tools: string[] }>();
  for (const n of wf.nodes.filter((x) => x.type === 'source.mcp' || x.type === 'output.mcp')) {
    const server = str(n.config.server);
    if (!server) continue;
    const entry = map.get(server) ?? { server, url: str(n.config.url), tools: [] };
    if (str(n.config.tool)) entry.tools.push(str(n.config.tool));
    if (!entry.url) entry.url = str(n.config.url);
    map.set(server, entry);
  }
  return [...map.values()];
}

export function allEnvVars(wf: Workflow, fromScripts: string[]): string[] {
  return [...new Set([...fromScripts, ...wf.nodes.flatMap((n) => envVarsOf(n.type, n.config))])].sort();
}

export function readme(d: DocInputs): string {
  const { config, workflow } = d;
  const trigger = workflow.nodes.find((n) => n.type === 'entry.trigger');
  const examples = str(trigger?.config.examples).split('\n').map((l) => l.trim()).filter(Boolean);
  const params = paramsOf(workflow);
  const sources = workflow.nodes.filter((n) => getComponent(n.type)?.category === 'source');
  const outputs = workflow.nodes.filter((n) => getComponent(n.type)?.category === 'output');
  const mcp = mcpServers(workflow);
  const results = d.testResults ?? [];
  const parts: string[] = [];

  parts.push(`# ${config.name}\n\n${d.description || '_No description yet._'}\n\nVersion ${config.version} · built with SkillCraft`);
  if (examples.length) parts.push(`## Try it\n\nAsk your agent things like:\n\n${examples.map((e) => `- "${e}"`).join('\n')}`);
  const diagram = mermaid(workflow);
  if (diagram) parts.push(`## How it works\n\n${diagram}`);
  if (params.length) parts.push(`## Inputs\n\n| Name | Description |\n| --- | --- |\n${params.map((p) => `| \`${p.name}\` | ${p.description || '—'} |`).join('\n')}`);
  if (sources.length || outputs.length) {
    parts.push(`## Connections\n\n${[...sources.map((n) => `- **${n.label}** — ${getComponent(n.type)?.label ?? n.type} (reads)`), ...outputs.map((n) => `- **${n.label}** — ${getComponent(n.type)?.label ?? n.type} (writes)`)].join('\n')}`);
  }

  const req: string[] = [];
  if (config.language === 'python') req.push(`- Python 3.9+${d.pythonDeps.length ? ` and packages: ${d.pythonDeps.map((p) => `\`${p}\``).join(', ')}` : ' (standard library only)'}`);
  if (config.language === 'node') req.push(`- Node.js 22+${d.nodeDeps ? ' and the packages in `scripts/package.json`' : ''}`);
  if (config.language === 'bash') req.push('- bash and curl');
  if (d.envVars.length) req.push(`- Environment variables: ${d.envVars.map((v) => `\`${v}\``).join(', ')}`);
  if (mcp.length) req.push(`- MCP servers: ${mcp.map((m) => `\`${m.server}\``).join(', ')}`);
  parts.push(`## Requirements\n\n${req.join('\n')}`);

  const targetRows = d.builtTargets.map((t) => {
    const mine = results.filter((r) => r.target === t);
    const status = mine.length ? `${mine.filter((r) => r.passed).length}/${mine.length} tests passing` : 'not tested yet';
    const folder = d.universal ? 'universal' : t;
    return `| ${PROFILES[t].displayName} | [${folder}/SETUP.md](${folder}/SETUP.md) | ${status} |`;
  });
  parts.push(`## Install\n\n| Tool | Setup guide | Tests |\n| --- | --- | --- |\n${targetRows.join('\n')}\n\nEach folder has an install script: \`./install.sh\` (macOS/Linux) or \`./install.ps1\` (Windows). Pass \`--user\` to install for all your projects.`);

  if (d.notes?.trim()) parts.push(`## Notes\n\n${d.notes.trim().replace(/^# .*\n+/, '')}`);
  return parts.join('\n\n') + '\n';
}

export function setup(d: DocInputs, target: TargetId | 'universal'): string {
  const { config, workflow } = d;
  const targets = target === 'universal' ? d.builtTargets : [target];
  const title = target === 'universal' ? 'all supported tools' : PROFILES[target].displayName;
  const mcp = mcpServers(workflow);
  const name = config.name;
  const steps: string[] = [];
  let n = 0;
  const step = (heading: string, text: string) => steps.push(`## ${++n}. ${heading}\n\n${text}`);

  const prereq: string[] = [];
  if (config.language === 'python') {
    prereq.push('Check Python 3.9 or newer is installed:\n\n```bash\npython3 --version\n```');
    if (d.pythonDeps.length) prereq.push(`Install the Python packages the scripts use:\n\n\`\`\`bash\npython3 -m pip install -r ${name}/scripts/requirements.txt\n\`\`\``);
  } else if (config.language === 'node') {
    prereq.push('Check Node.js 22 or newer is installed:\n\n```bash\nnode --version\n```');
    if (d.nodeDeps) prereq.push(`Install the packages the scripts use:\n\n\`\`\`bash\nnpm install --prefix ${name}/scripts\n\`\`\``);
  } else {
    prereq.push('The scripts need `bash` and `curl` (preinstalled on macOS and most Linux; on Windows use WSL or Git Bash).');
  }
  step('Prerequisites', prereq.join('\n\n'));

  if (d.envVars.length) {
    const rows = d.envVars.map((v) => {
      const node = workflow.nodes.find((x) => Object.values(x.config).includes(v));
      return `| \`${v}\` | ${node ? `${node.label}` : 'Used by the scripts'} |`;
    });
    step('Credentials', `The skill reads these environment variables. Never put their values inside the skill folder.\n\n| Variable | Used by |\n| --- | --- |\n${rows.join('\n')}\n\nSet them in the shell your agent runs in, for example:\n\n\`\`\`bash\n${d.envVars.map((v) => `export ${v}="…"`).join('\n')}\n\`\`\``);
  }

  if (mcp.length) {
    const blocks = targets.map((t) => {
      const p = PROFILES[t];
      const snippets = mcp.map((m) => '```' + (t === 'codex' ? 'toml' : t === 'copilot' ? 'json' : 'bash') + '\n' + fill(p.mcp.snippet, { server: m.server, url: m.url || '<server-url>' }) + '\n```').join('\n\n');
      return `${targets.length > 1 ? `### ${p.displayName}\n\n` : ''}${p.mcp.how}\n\n${snippets}`;
    });
    step('Connect MCP servers', `This skill uses: ${mcp.map((m) => `\`${m.server}\`${m.tools.length ? ` (${m.tools.join(', ')})` : ''}`).join(', ')}.\n\n${blocks.join('\n\n')}`);
  }

  const installBlocks = targets.map((t) => {
    const p = PROFILES[t];
    return `${targets.length > 1 ? `### ${p.displayName}\n\n` : ''}| Scope | Location |\n| --- | --- |\n| This project (shared with your team) | \`${p.install.project}/${name}/\` |\n| Just you, every project | \`${p.install.user}/${name}/\` |\n\nCopy the \`${name}\` folder there, or run the install script from this folder:\n\n\`\`\`bash\n./install.sh${target === 'universal' ? ` --tool ${t}` : ''} /path/to/your/project     # project scope\n./install.sh${target === 'universal' ? ` --tool ${t}` : ''} --user                   # personal scope\n\`\`\`\n\nOn Windows: \`./install.ps1${target === 'universal' ? ` -Tool ${t}` : ''} -Project C:\\path\\to\\project\` or \`./install.ps1${target === 'universal' ? ` -Tool ${t}` : ''} -User\`.`;
  });
  step('Install', installBlocks.join('\n\n'));

  const trigger = workflow.nodes.find((x) => x.type === 'entry.trigger');
  const example = str(trigger?.config.examples).split('\n')[0] || `a request that matches: "${d.description.slice(0, 80)}…"`;
  step('Check it works', `Start a new session${targets.map((t) => ` in ${PROFILES[t].displayName}`).join(' or')} and ask:\n\n> ${example}\n\n${targets.map((t) => `- **${PROFILES[t].displayName}:** ${fill(PROFILES[t].invoke, { name })}`).join('\n')}\n\nYou should see the agent load \`${name}\`${config.language !== 'bash' || workflow.nodes.some((x) => getComponent(x.type)?.compile === 'script') ? ` and run its scripts with \`${RUNNER[config.language]}\`` : ''}.`);

  const trouble = [
    '| Problem | Fix |',
    '| --- | --- |',
    '| The skill never loads | Start a new session after installing, and check the folder name matches the `name` in SKILL.md. Ask for it by name to test. |',
    `| "Missing environment variable" | Set the variable in the same shell or environment your agent runs in, then restart the agent. |`,
    config.language === 'python' ? '| `python3: command not found` | Install Python 3, or make sure it is on your PATH. |' : config.language === 'node' ? '| `node: command not found` | Install Node.js 22+, or make sure it is on your PATH. |' : '| `curl: command not found` | Install curl. |',
  ];
  if (mcp.length) trouble.push('| The agent says a tool is unavailable | Check the MCP server is configured and connected (see step 3). |');
  step('Troubleshooting', trouble.join('\n'));

  step('Update or remove', `To update, run the install script again; it replaces the old copy. To remove, delete the \`${name}\` folder from the location you installed it to.`);

  const extra = target === 'universal' ? '' : d.setupNotes?.[target]?.trim();
  return `# Set up ${name} for ${title}\n\n${d.description}\n\n${steps.join('\n\n')}${extra ? `\n\n## Notes\n\n${extra}` : ''}\n`;
}

export function installSh(name: string, targets: TargetId[]): string {
  const cases = targets.map((t) => `    ${t}) PROJECT_DIR="${PROFILES[t].install.project}"; USER_DIR="${PROFILES[t].install.user.replace('~', '$HOME')}" ;;`).join('\n');
  return `#!/usr/bin/env bash
# Installs the ${name} skill. Generated by SkillCraft.
# Usage: ./install.sh [--tool ${targets.join('|')}] [--user | <project-path>]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="${targets[0]}"
SCOPE="project"
DEST_ROOT="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --tool) TOOL="$2"; shift 2 ;;
    --user) SCOPE="user"; shift ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) DEST_ROOT="$1"; shift ;;
  esac
done
case "$TOOL" in
${cases}
    *) echo "Unknown tool: $TOOL (expected ${targets.join(', ')})" >&2; exit 2 ;;
esac
if [ "$SCOPE" = "user" ]; then DEST="$USER_DIR"; else DEST="$DEST_ROOT/$PROJECT_DIR"; fi
mkdir -p "$DEST"
rm -rf "$DEST/${name}"
cp -R "$HERE/${name}" "$DEST/${name}"
echo "Installed ${name} for $TOOL in $DEST/${name}"
echo "Start a new agent session to pick it up."
`;
}

export function installPs1(name: string, targets: TargetId[]): string {
  const cases = targets.map((t) => `  '${t}' { $ProjectDir = '${PROFILES[t].install.project}'; $UserDir = Join-Path $HOME '${PROFILES[t].install.user.replace('~/', '')}' }`).join('\n');
  return `# Installs the ${name} skill. Generated by SkillCraft.
# Usage: ./install.ps1 [-Tool ${targets.join('|')}] [-User | -Project <path>]
param(
  [ValidateSet(${targets.map((t) => `'${t}'`).join(', ')})] [string]$Tool = '${targets[0]}',
  [switch]$User,
  [string]$Project = (Get-Location).Path
)
$ErrorActionPreference = 'Stop'
switch ($Tool) {
${cases}
}
$Dest = if ($User) { $UserDir } else { Join-Path $Project $ProjectDir }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Target = Join-Path $Dest '${name}'
if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
Copy-Item -Recurse -Path (Join-Path $PSScriptRoot '${name}') -Destination $Target
Write-Host "Installed ${name} for $Tool in $Target"
Write-Host 'Start a new agent session to pick it up.'
`;
}
