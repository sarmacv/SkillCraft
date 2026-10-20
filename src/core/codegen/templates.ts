// Per-language code templates for script-compiled components.
// Generated code uses only each runtime's standard library unless a component
// truly needs a driver, so skills run anywhere without installs.

import type { ScriptLanguage, WorkflowNode } from '../types';

export const EXT: Record<ScriptLanguage, string> = { python: '.py', node: '.mjs', bash: '.sh' };
export const RUNNER: Record<ScriptLanguage, string> = { python: 'python3', node: 'node', bash: 'bash' };
export const MANAGED_MARK = 'skillcraft:managed';

export interface Param {
  name: string;
  description: string;
}

type Cfg = WorkflowNode['config'];
const s = (v: unknown) => String(v ?? '').trim();
const fnName = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'step';

export function header(lang: ScriptLanguage, purpose: string): string {
  const c = lang === 'node' ? '//' : '#';
  const shebang = lang === 'python' ? '#!/usr/bin/env python3' : lang === 'node' ? '#!/usr/bin/env node' : '#!/usr/bin/env bash';
  return `${shebang}\n${c} ${MANAGED_MARK} — generated from workflow.json. Delete this line to take ownership of the file.\n${c} ${purpose.replace(/\n/g, ' ')}\n`;
}

export function isManaged(text: string): boolean {
  return text.split('\n').slice(0, 3).some((l) => l.includes(MANAGED_MARK));
}

// ── Python ──────────────────────────────────────────────────────────────────

function pyAuth(cfg: Cfg): string {
  const env = s(cfg.tokenEnv);
  if (!env || s(cfg.auth) === 'none' || !s(cfg.auth)) return '';
  const header =
    s(cfg.auth) === 'api key header' ? `headers["X-API-Key"] = secret`
      : s(cfg.auth) === 'basic' ? `headers["Authorization"] = "Basic " + base64.b64encode(secret.encode()).decode()`
        : `headers["Authorization"] = f"Bearer {secret}"`;
  return `    secret = require_env("${env}")\n    ${header}\n`;
}

function pySource(n: WorkflowNode): string {
  const cfg = n.config;
  const name = `fetch_${fnName(n.label)}`;
  switch (n.type) {
    case 'source.rest':
      return `def ${name}(args):\n    """${n.label}: ${s(cfg.method) || 'GET'} ${s(cfg.baseUrl)}${s(cfg.path)}"""\n    headers = {"Accept": "application/json"}\n${pyAuth(cfg)}    body = ${s(cfg.query) ? `json.loads(${JSON.stringify(s(cfg.query))})` : 'None'}\n    return http_json("${s(cfg.method) || 'GET'}", "${s(cfg.baseUrl)}${s(cfg.path)}", headers, body)\n`;
    case 'source.graphql':
      return `def ${name}(args):\n    """${n.label}: GraphQL query"""\n    headers = {"Content-Type": "application/json"}\n${pyAuth(cfg)}    query = ${JSON.stringify(s(cfg.query))}\n    return http_json("POST", "${s(cfg.endpoint)}", headers, {"query": query, "variables": args})\n`;
    case 'source.knowledge':
      return `def ${name}(args):\n    """${n.label}: knowledge base search"""\n    headers = {"Content-Type": "application/json"}\n${pyAuth(cfg)}    return http_json("POST", "${s(cfg.endpoint)}", headers, {"query": args.get("query", ""), "top_k": ${Number(cfg.topK) || 5}})\n`;
    case 'source.web':
      return `def ${name}(args):\n    """${n.label}: fetch a web page as text"""\n    with urllib.request.urlopen("${s(cfg.url)}", timeout=30) as resp:\n        return resp.read().decode("utf-8", errors="replace")[:20000]\n`;
    case 'source.files':
      return `def ${name}(args):\n    """${n.label}: read files matching ${s(cfg.glob)}"""\n    files = {}\n    for path in sorted(glob.glob("${s(cfg.glob)}", recursive=True))[:50]:\n        with open(path, encoding="utf-8", errors="replace") as fh:\n            files[path] = fh.read()[:20000]\n    return files\n`;
    case 'source.cli':
      return `def ${name}(args):\n    """${n.label}: run a command-line tool"""\n    result = subprocess.run(shlex.split(${JSON.stringify(s(cfg.command))}), capture_output=True, text=True, timeout=120)\n    if result.returncode != 0:\n        sys.exit(f"${n.label} failed: {result.stderr.strip()}")\n    try:\n        return json.loads(result.stdout)\n    except json.JSONDecodeError:\n        return result.stdout\n`;
    case 'source.database': {
      const driver = s(cfg.driver) || 'postgres';
      const connect =
        driver === 'sqlite' ? `    import sqlite3\n    conn = sqlite3.connect(require_env("${s(cfg.connectionEnv) || 'DATABASE_URL'}"))\n`
          : driver === 'mysql' ? `    import pymysql  # pip install pymysql\n    from urllib.parse import urlparse\n    u = urlparse(require_env("${s(cfg.connectionEnv) || 'DATABASE_URL'}"))\n    conn = pymysql.connect(host=u.hostname, port=u.port or 3306, user=u.username, password=u.password, database=u.path.lstrip("/"))\n`
            : `    import psycopg2  # pip install psycopg2-binary\n    conn = psycopg2.connect(require_env("${s(cfg.connectionEnv) || 'DATABASE_URL'}"))\n`;
      return `def ${name}(args):\n    """${n.label}: read-only query"""\n${connect}    try:\n        cur = conn.cursor()\n        cur.execute(${JSON.stringify(s(cfg.sql) || 'SELECT 1')})\n        cols = [c[0] for c in cur.description]\n        return [dict(zip(cols, row)) for row in cur.fetchmany(500)]\n    finally:\n        conn.close()\n`;
    }
    default:
      return '';
  }
}

function pyOutput(n: WorkflowNode): string {
  const cfg = n.config;
  const name = `send_${fnName(n.label)}`;
  if (n.type === 'output.message') {
    const env = s(cfg.targetEnv) || 'WEBHOOK_URL';
    if (s(cfg.channel).startsWith('email')) {
      return `def ${name}(result):\n    """${n.label}: send by email. ${env} looks like smtp://user:pass@host:587/to@example.com"""\n    import smtplib\n    from email.message import EmailMessage\n    u = urllib.parse.urlparse(require_env("${env}"))\n    msg = EmailMessage()\n    msg["Subject"] = "${n.label}"\n    msg["From"] = u.username\n    msg["To"] = u.path.lstrip("/")\n    msg.set_content(result if isinstance(result, str) else json.dumps(result, indent=2))\n    with smtplib.SMTP(u.hostname, u.port or 587) as smtp:\n        smtp.starttls()\n        smtp.login(urllib.parse.unquote(u.username), urllib.parse.unquote(u.password or ""))\n        smtp.send_message(msg)\n`;
    }
    return `def ${name}(result):\n    """${n.label}: post to a ${s(cfg.channel) || 'webhook'}"""\n    text = result if isinstance(result, str) else json.dumps(result, indent=2)\n    http_json("POST", require_env("${env}"), {"Content-Type": "application/json"}, {"text": text})\n`;
  }
  if (n.type === 'output.api') {
    return `def ${name}(result):\n    """${n.label}: POST results to ${s(cfg.url)}"""\n    headers = {"Content-Type": "application/json"}\n${pyAuth(cfg)}    return http_json("POST", "${s(cfg.url)}", headers, result)\n`;
  }
  return '';
}

const PY_HELPERS = `

def require_env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Missing environment variable {name}. Set it and run again.")
    return value


def http_json(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None and method != "GET" else None
    if body is not None and method == "GET":
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(body)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as err:
        sys.exit(f"{method} {url} failed with HTTP {err.code}: {err.read().decode()[:300]}")
    try:
        return json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return raw
`;

export function python(purpose: string, params: Param[], sources: WorkflowNode[], outputs: WorkflowNode[], transform?: string): string {
  const argParse = params.map((p) => `    parser.add_argument("--${p.name}", help=${JSON.stringify(p.description)})`).join('\n');
  const calls = sources.map((n) => `    data[${JSON.stringify(n.label)}] = fetch_${fnName(n.label)}(args)`).join('\n');
  const sends = outputs.map((n) => `    send_${fnName(n.label)}(result)`).join('\n');
  return `${header('python', purpose)}import base64
import glob
import json
import os
import shlex
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
${PY_HELPERS}

${[...sources.map(pySource), ...outputs.map(pyOutput)].filter(Boolean).join('\n\n')}

def run(data, args):
    """${purpose.replace(/"/g, "'")}"""
    ${transform ? `# Rule: ${transform}\n    ` : ''}# TODO: shape the result. By default everything is returned for the agent to use.
    return data


def main():
    import argparse
    parser = argparse.ArgumentParser(description=${JSON.stringify(purpose)})
${argParse || '    pass'}
    args = {k: v for k, v in vars(parser.parse_args()).items() if v is not None}
    if not sys.stdin.isatty():
        piped = sys.stdin.read().strip()
        args["input"] = json.loads(piped) if piped.startswith(("{", "[")) else piped
    data = {}
${calls || '    data = args.get("input")'}
    result = run(data, args)
${sends}
    print(json.dumps(result, indent=2, default=str) if not isinstance(result, str) else result)


if __name__ == "__main__":
    main()
`;
}

// ── Node ────────────────────────────────────────────────────────────────────

function jsAuth(cfg: Cfg): string {
  const env = s(cfg.tokenEnv);
  if (!env || s(cfg.auth) === 'none' || !s(cfg.auth)) return '';
  const line =
    s(cfg.auth) === 'api key header' ? `headers['X-API-Key'] = secret;`
      : s(cfg.auth) === 'basic' ? `headers.Authorization = 'Basic ' + Buffer.from(secret).toString('base64');`
        : 'headers.Authorization = `Bearer ${secret}`;';
  return `  const secret = requireEnv('${env}');\n  ${line}\n`;
}

const pascal = (label: string) => fnName(label).replace(/(?:^|_)(\w)/g, (_, c: string) => c.toUpperCase());

function jsSource(n: WorkflowNode): string {
  const cfg = n.config;
  const name = `fetch${pascal(n.label)}`;
  switch (n.type) {
    case 'source.rest':
      return `/** ${n.label}: ${s(cfg.method) || 'GET'} ${s(cfg.baseUrl)}${s(cfg.path)} */\nasync function ${name}(args) {\n  const headers = { Accept: 'application/json' };\n${jsAuth(cfg)}  return httpJson('${s(cfg.method) || 'GET'}', '${s(cfg.baseUrl)}${s(cfg.path)}', headers, ${s(cfg.query) || 'undefined'});\n}\n`;
    case 'source.graphql':
      return `/** ${n.label}: GraphQL query */\nasync function ${name}(args) {\n  const headers = { 'Content-Type': 'application/json' };\n${jsAuth(cfg)}  return httpJson('POST', '${s(cfg.endpoint)}', headers, { query: ${JSON.stringify(s(cfg.query))}, variables: args });\n}\n`;
    case 'source.knowledge':
      return `/** ${n.label}: knowledge base search */\nasync function ${name}(args) {\n  const headers = { 'Content-Type': 'application/json' };\n${jsAuth(cfg)}  return httpJson('POST', '${s(cfg.endpoint)}', headers, { query: args.query ?? '', top_k: ${Number(cfg.topK) || 5} });\n}\n`;
    case 'source.web':
      return `/** ${n.label}: fetch a web page as text */\nasync function ${name}() {\n  const res = await fetch('${s(cfg.url)}');\n  return (await res.text()).slice(0, 20000);\n}\n`;
    case 'source.files':
      return `/** ${n.label}: read files matching ${s(cfg.glob)} */\nasync function ${name}() {\n  const files = {};\n  for await (const file of glob('${s(cfg.glob)}')) {\n    files[file] = (await readFile(file, 'utf8')).slice(0, 20000);\n  }\n  return files;\n}\n`;
    case 'source.cli':
      return `/** ${n.label}: run a command-line tool */\nasync function ${name}() {\n  const out = execSync(${JSON.stringify(s(cfg.command))}, { encoding: 'utf8', timeout: 120000 });\n  try { return JSON.parse(out); } catch { return out; }\n}\n`;
    case 'source.database':
      return `/** ${n.label}: read-only query (npm install ${s(cfg.driver) === 'mysql' ? 'mysql2' : s(cfg.driver) === 'sqlite' ? 'better-sqlite3' : 'pg'}) */\nasync function ${name}() {\n  ${s(cfg.driver) === 'sqlite'
        ? `const { default: Database } = await import('better-sqlite3');\n  const db = new Database(requireEnv('${s(cfg.connectionEnv) || 'DATABASE_URL'}'), { readonly: true });\n  return db.prepare(${JSON.stringify(s(cfg.sql) || 'SELECT 1')}).all().slice(0, 500);`
        : s(cfg.driver) === 'mysql'
          ? `const mysql = await import('mysql2/promise');\n  const conn = await mysql.createConnection(requireEnv('${s(cfg.connectionEnv) || 'DATABASE_URL'}'));\n  try { const [rows] = await conn.query(${JSON.stringify(s(cfg.sql) || 'SELECT 1')}); return rows.slice(0, 500); } finally { await conn.end(); }`
          : `const { default: pg } = await import('pg');\n  const client = new pg.Client({ connectionString: requireEnv('${s(cfg.connectionEnv) || 'DATABASE_URL'}') });\n  await client.connect();\n  try { return (await client.query(${JSON.stringify(s(cfg.sql) || 'SELECT 1')})).rows.slice(0, 500); } finally { await client.end(); }`}\n}\n`;
    default:
      return '';
  }
}

function jsOutput(n: WorkflowNode): string {
  const cfg = n.config;
  const name = `send${pascal(n.label)}`;
  if (n.type === 'output.message') {
    if (s(cfg.channel).startsWith('email')) {
      return `/** ${n.label}: email needs an SMTP client — install nodemailer, or switch this node to a webhook. */\nasync function ${name}(result) {\n  const { default: nodemailer } = await import('nodemailer');\n  const url = new URL(requireEnv('${s(cfg.targetEnv) || 'SMTP_URL'}'));\n  const transport = nodemailer.createTransport(url.origin.replace(url.pathname, ''));\n  await transport.sendMail({ from: decodeURIComponent(url.username), to: url.pathname.slice(1), subject: '${n.label}', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) });\n}\n`;
    }
    return `/** ${n.label}: post to a ${s(cfg.channel) || 'webhook'} */\nasync function ${name}(result) {\n  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);\n  await httpJson('POST', requireEnv('${s(cfg.targetEnv) || 'WEBHOOK_URL'}'), { 'Content-Type': 'application/json' }, { text });\n}\n`;
  }
  if (n.type === 'output.api') {
    return `/** ${n.label}: POST results to ${s(cfg.url)} */\nasync function ${name}(result) {\n  const headers = { 'Content-Type': 'application/json' };\n${jsAuth(cfg)}  return httpJson('POST', '${s(cfg.url)}', headers, result);\n}\n`;
  }
  return '';
}

export function node(purpose: string, params: Param[], sources: WorkflowNode[], outputs: WorkflowNode[], transform?: string): string {
  const calls = sources.map((n) => `  data[${JSON.stringify(n.label)}] = await fetch${pascal(n.label)}(args);`).join('\n');
  const sends = outputs.map((n) => `  await send${pascal(n.label)}(result);`).join('\n');
  return `${header('node', purpose)}import { execSync } from 'node:child_process';
import { glob, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(\`Missing environment variable \${name}. Set it and run again.\`);
    process.exit(1);
  }
  return value;
}

async function httpJson(method, url, headers, body) {
  if (body !== undefined && method === 'GET') {
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(body);
    body = undefined;
  }
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    console.error(\`\${method} \${url} failed with HTTP \${res.status}: \${text.slice(0, 300)}\`);
    process.exit(1);
  }
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

${[...sources.map(jsSource), ...outputs.map(jsOutput)].filter(Boolean).join('\n')}
/** ${purpose} */
function run(data, args) {
  ${transform ? `// Rule: ${transform}\n  ` : ''}// TODO: shape the result. By default everything is returned for the agent to use.
  return data;
}

const { values: args } = parseArgs({
  options: { ${params.map((p) => `${JSON.stringify(p.name)}: { type: 'string' }`).join(', ')} },
  allowPositionals: true,
});
if (!process.stdin.isTTY) {
  let piped = '';
  for await (const chunk of process.stdin) piped += chunk;
  piped = piped.trim();
  if (piped) args.input = /^[[{]/.test(piped) ? JSON.parse(piped) : piped;
}
let data = {};
${calls || '  data = args.input;'}
const result = run(data, args);
${sends}
console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
`.replace(/^  (data|await)/gm, '$1');
}

// ── Bash ────────────────────────────────────────────────────────────────────

function shAuth(cfg: Cfg): string {
  const env = s(cfg.tokenEnv);
  if (!env || s(cfg.auth) === 'none' || !s(cfg.auth)) return '';
  const h = s(cfg.auth) === 'api key header' ? `X-API-Key: \${${env}}` : s(cfg.auth) === 'basic' ? `Authorization: Basic $(printf '%s' "\${${env}}" | base64)` : `Authorization: Bearer \${${env}}`;
  return `  require_env ${env}\n  auth=(-H "${h}")\n`;
}

function shSource(n: WorkflowNode): string {
  const cfg = n.config;
  const name = `fetch_${fnName(n.label)}`;
  switch (n.type) {
    case 'source.rest':
      return `# ${n.label}: ${s(cfg.method) || 'GET'} ${s(cfg.baseUrl)}${s(cfg.path)}\n${name}() {\n  local auth=()\n${shAuth(cfg)}  curl -fsS -X ${s(cfg.method) || 'GET'} -H "Accept: application/json" "\${auth[@]}" ${s(cfg.query) && s(cfg.method) === 'POST' ? `-H "Content-Type: application/json" -d '${s(cfg.query).replace(/'/g, "'\\''")}' ` : ''}"${s(cfg.baseUrl)}${s(cfg.path)}"\n}\n`;
    case 'source.graphql':
    case 'source.knowledge': {
      const url = s(cfg.endpoint);
      const payload = n.type === 'source.graphql' ? `{"query": ${JSON.stringify(s(cfg.query))}}` : `{"query": "$1", "top_k": ${Number(cfg.topK) || 5}}`;
      return `# ${n.label}\n${name}() {\n  local auth=()\n${shAuth(cfg)}  curl -fsS -X POST -H "Content-Type: application/json" "\${auth[@]}" -d '${payload.replace(/'/g, "'\\''")}' "${url}"\n}\n`;
    }
    case 'source.web':
      return `# ${n.label}: fetch a web page\n${name}() {\n  curl -fsSL "${s(cfg.url)}" | head -c 20000\n}\n`;
    case 'source.files':
      return `# ${n.label}: read files matching ${s(cfg.glob)}\n${name}() {\n  shopt -s globstar nullglob\n  for f in ${s(cfg.glob)}; do echo "=== $f"; head -c 20000 "$f"; echo; done\n}\n`;
    case 'source.cli':
      return `# ${n.label}\n${name}() {\n  ${s(cfg.command)}\n}\n`;
    case 'source.database':
      return `# ${n.label}: read-only query\n${name}() {\n  require_env ${s(cfg.connectionEnv) || 'DATABASE_URL'}\n  ${s(cfg.driver) === 'sqlite' ? `sqlite3 -json "\${${s(cfg.connectionEnv) || 'DATABASE_URL'}}"` : s(cfg.driver) === 'mysql' ? `mysql --batch "\${${s(cfg.connectionEnv) || 'DATABASE_URL'}}" -e` : `psql "\${${s(cfg.connectionEnv) || 'DATABASE_URL'}}" -At -c`} ${JSON.stringify(s(cfg.sql) || 'SELECT 1')}\n}\n`;
    default:
      return '';
  }
}

function shOutput(n: WorkflowNode): string {
  const cfg = n.config;
  const name = `send_${fnName(n.label)}`;
  if (n.type === 'output.message') {
    const env = s(cfg.targetEnv) || 'WEBHOOK_URL';
    if (s(cfg.channel).startsWith('email')) {
      return `# ${n.label}: send by email (uses curl's SMTP support; ${env}=smtp://user:pass@host:587/to@example.com)\n${name}() {\n  require_env ${env}\n  local to="\${${env}##*/}"\n  printf 'Subject: ${n.label}\\n\\n%s\\n' "$1" | curl -fsS --ssl-reqd --url "\${${env}%/*}" --mail-rcpt "$to" --upload-file -\n}\n`;
    }
    return `# ${n.label}: post to a ${s(cfg.channel) || 'webhook'}\n${name}() {\n  require_env ${env}\n  local text\n  text=$(printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | awk '{printf "%s\\\\n", $0}')\n  curl -fsS -X POST -H "Content-Type: application/json" -d "{\\"text\\": \\"$text\\"}" "\${${env}}" >/dev/null\n}\n`;
  }
  if (n.type === 'output.api') {
    return `# ${n.label}: POST results to ${s(cfg.url)}\n${name}() {\n  local auth=()\n${shAuth(cfg)}  printf '%s' "$1" | curl -fsS -X POST -H "Content-Type: application/json" "\${auth[@]}" --data-binary @- "${s(cfg.url)}"\n}\n`;
  }
  return '';
}

export function bash(purpose: string, params: Param[], sources: WorkflowNode[], outputs: WorkflowNode[], transform?: string): string {
  const parse = params.length
    ? `while [ $# -gt 0 ]; do\n  case "$1" in\n${params.map((p) => `    --${p.name}) ${p.name.toUpperCase().replace(/-/g, '_')}="$2"; shift 2 ;;`).join('\n')}\n    *) echo "Unknown option $1" >&2; exit 2 ;;\n  esac\ndone\n`
    : '';
  const calls = sources.map((n) => `echo "### ${n.label}"\nfetch_${fnName(n.label)}${n.type === 'source.knowledge' ? ' "${QUERY:-}"' : ''}\necho`).join('\n');
  return `${header('bash', purpose)}set -euo pipefail

require_env() {
  if [ -z "\${!1:-}" ]; then
    echo "Missing environment variable $1. Set it and run again." >&2
    exit 1
  fi
}

${[...sources.map(shSource), ...outputs.map(shOutput)].filter(Boolean).join('\n')}
${parse}
# ${purpose}
${transform ? `# Rule: ${transform}\n` : ''}result=$(
${calls || 'cat'}
)
${outputs.map((n) => `send_${fnName(n.label)} "$result"`).join('\n')}
printf '%s\\n' "$result"
`;
}

export const GENERATORS: Record<ScriptLanguage, typeof python> = { python, node, bash };
