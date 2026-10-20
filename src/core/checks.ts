// Structure, integrity, efficiency and portability checks.
// Every fixable finding comes with a Proposal — nothing is ever applied here.

import * as path from 'node:path';
import { envVarsOf, getComponent, isPlaceholder, missingFields } from './catalog';
import { PROFILES } from './profiles';
import type { LocalState, TestCase } from './project';
import { estimateTokens, joinFrontmatter, type Skill, slugify } from './skill';
import type { ContextBudget, FileChange, Finding, HealthReport, ProjectConfig, Proposal, Readiness, TargetId, Workflow } from './types';

export interface CheckOptions {
  /** Workspace root; finding paths are relative to it. */
  root: string;
  config?: ProjectConfig;
  workflow?: Workflow;
  tests?: TestCase[];
  state?: LocalState;
  thresholds?: { skillMdLines: number; skillMdTokens: number };
}

export interface CheckResult {
  report: HealthReport;
  proposals: Proposal[];
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HUMAN_DOCS = /^(readme|install(ation)?|setup|changelog|contributing|installation_guide)(\.[a-z]+)?$/i;
const SCRIPT_EXT: Record<string, string> = { '.py': 'python', '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.ts': 'node', '.sh': 'bash', '.bash': 'bash' };

const PY_STDLIB = new Set('abc argparse ast asyncio base64 collections concurrent contextlib copy csv dataclasses datetime decimal difflib email enum functools glob hashlib heapq hmac html http io itertools json logging math mimetypes os pathlib pickle platform pprint queue random re shlex shutil signal smtplib socket sqlite3 ssl statistics string struct subprocess sys tempfile textwrap threading time timeit traceback typing unicodedata unittest urllib uuid warnings xml zipfile zoneinfo __future__'.split(' '));
const PY_PIP_NAME: Record<string, string> = { yaml: 'pyyaml', bs4: 'beautifulsoup4', PIL: 'pillow', dotenv: 'python-dotenv', jwt: 'pyjwt', psycopg2: 'psycopg2-binary', slack_sdk: 'slack-sdk', github: 'PyGithub', sklearn: 'scikit-learn', docx: 'python-docx', pptx: 'python-pptx' };
const NODE_BUILTINS = new Set('assert buffer child_process crypto events fs http https net os path process querystring readline stream string_decoder timers tls url util zlib worker_threads'.split(' '));

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/, label: 'API key' },
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/, label: 'GitHub token' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
  { re: /\b([A-Za-z_]*(?:api[_-]?key|token|secret|password)[A-Za-z_]*)\s*[:=]\s*["'][^"'\s]{8,}["']/i, label: 'hardcoded credential' },
];

function rel(opts: CheckOptions, skill: Skill, file: string): string {
  return path.relative(opts.root, path.join(skill.dir, file)).split(path.sep).join('/') || file;
}

/** Replace every reference to `from` inside SKILL.md text with `to`. */
function rewriteRefs(text: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(\\]\\(|\`|\\s|^|\\()(\\./)?${escaped}(?=[)\`\\s#]|$)`, 'gm'), `$1${to}`);
}

export function scriptEnvVars(text: string, lang: string): string[] {
  const vars = new Set<string>();
  const patterns =
    lang === 'python'
      ? [/os\.environ(?:\.get)?\s*[[(]\s*["']([A-Z_][A-Z0-9_]*)["']/g, /os\.getenv\(\s*["']([A-Z_][A-Z0-9_]*)["']/g]
      : lang === 'node'
        ? [/process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\]/g]
        : [/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g];
  const ignore = new Set(['HOME', 'PATH', 'PWD', 'USER', 'SHELL', 'TMPDIR', 'LANG', 'IFS']);
  for (const re of patterns) for (const m of text.matchAll(re)) if (!ignore.has(m[1])) vars.add(m[1]);
  return [...vars];
}

export function scriptImports(text: string, lang: string): string[] {
  const mods = new Set<string>();
  if (lang === 'python') {
    for (const m of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) mods.add((m[1] ?? m[2]).split('.')[0]);
  } else if (lang === 'node') {
    for (const m of text.matchAll(/(?:require\(\s*["']([^"']+)["']\s*\)|from\s+["']([^"']+)["']|import\s+["']([^"']+)["'])/g)) {
      const spec = (m[1] ?? m[2] ?? m[3]).replace(/^node:/, '');
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      mods.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
  }
  return [...mods];
}

export function computeBudget(skill: Skill): ContextBudget {
  const fm = skill.skillMd?.frontmatter ?? {};
  const meta = `${fm.name ?? ''} ${fm.description ?? ''} ${fm.when_to_use ?? ''}`;
  return {
    metadataTokens: estimateTokens(meta),
    instructionTokens: estimateTokens(skill.skillMd?.body ?? ''),
    references: skill.files
      .filter((f) => f.rel.startsWith('references/') && f.text !== undefined)
      .map((f) => ({ path: f.rel, tokens: estimateTokens(f.text ?? '') })),
  };
}

export function runChecks(skill: Skill, opts: CheckOptions): CheckResult {
  const findings: Finding[] = [];
  const proposals: Proposal[] = [];
  const thresholds = opts.thresholds ?? { skillMdLines: 500, skillMdTokens: 5000 };
  const targets: TargetId[] = opts.config?.targets ?? [];
  const skillMdPath = rel(opts, skill, 'SKILL.md');
  const fm = skill.skillMd?.frontmatter;
  const body = skill.skillMd?.body ?? '';
  const rejected = new Set((opts.config?.rejected ?? []).map((r) => r.key));

  const propose = (p: Proposal, finding?: Finding) => {
    if (rejected.has(p.key)) return;
    proposals.push(p);
    if (finding) finding.proposalKey = p.key;
  };
  const find = (f: Finding) => {
    findings.push(f);
    return f;
  };

  // Every change to SKILL.md in this run is layered on the same text so proposals compose.
  const withSkillMd = (mutate: (raw: string) => string): FileChange[] => {
    const before = skill.rawSkillMd ?? '';
    const after = mutate(before);
    return after === before ? [] : [{ kind: 'modify', path: skillMdPath, content: after }];
  };

  // ── Structure ──────────────────────────────────────────────────────────────
  if (!skill.rawSkillMd) {
    find({ rule: 'skill-md-missing', severity: 'error', area: 'structure', message: 'SKILL.md is missing. Every skill needs one at the folder root.', file: skillMdPath });
  } else if (skill.skillMd?.frontmatterError || !fm) {
    find({ rule: 'frontmatter-invalid', severity: 'error', area: 'structure', message: skill.skillMd?.frontmatterError ?? 'SKILL.md has no YAML frontmatter (--- name/description ---).', file: skillMdPath, line: 1 });
  }

  if (fm) {
    const name = typeof fm.name === 'string' ? fm.name : '';
    const folderOk = NAME_RE.test(skill.folderName) && skill.folderName.length <= 64;
    if (!name) {
      const f = find({ rule: 'name-missing', severity: 'error', area: 'structure', message: 'Frontmatter has no `name`.', file: skillMdPath, line: 2 });
      if (folderOk) {
        propose({
          key: `name-missing:${skillMdPath}`, title: `Set name to "${skill.folderName}"`, priority: 'critical', source: 'checks',
          why: 'The Agent Skills standard requires a `name`, and it must match the skill folder name.',
          changes: [{ kind: 'modify', path: skillMdPath, content: joinFrontmatter({ name: skill.folderName, ...fm }, body) }],
        }, f);
      }
    } else if (!NAME_RE.test(name) || name.length > 64) {
      const fixed = slugify(name);
      const f = find({ rule: 'name-invalid', severity: 'error', area: 'structure', message: `Name "${name}" must be 1–64 lowercase letters, numbers and single hyphens.`, file: skillMdPath, line: 2 });
      if (fixed && fixed === skill.folderName) {
        propose({ key: `name-invalid:${skillMdPath}`, title: `Rename skill to "${fixed}"`, priority: 'critical', source: 'checks', why: 'Names must be lowercase with hyphens so every tool can load the skill.', changes: [{ kind: 'modify', path: skillMdPath, content: joinFrontmatter({ ...fm, name: fixed }, body) }] }, f);
      }
    } else if (name !== skill.folderName) {
      const f = find({ rule: 'name-folder-mismatch', severity: 'error', area: 'structure', message: `Name "${name}" must match the folder name "${skill.folderName}".`, file: skillMdPath, line: 2 });
      if (folderOk) {
        propose({ key: `name-folder-mismatch:${skillMdPath}`, title: `Set name to match folder "${skill.folderName}"`, priority: 'critical', source: 'checks', why: 'Tools look skills up by folder; a mismatch can stop the skill from loading.', changes: [{ kind: 'modify', path: skillMdPath, content: joinFrontmatter({ ...fm, name: skill.folderName }, body) }] }, f);
      }
    }

    const desc = typeof fm.description === 'string' ? fm.description.trim() : '';
    if (!desc) {
      find({ rule: 'description-missing', severity: 'error', area: 'structure', message: 'Frontmatter has no `description`. Agents use it to decide when to load the skill — ask the coach to draft one.', file: skillMdPath, line: 3 });
    } else {
      if (desc.length > 1024) find({ rule: 'description-too-long', severity: 'error', area: 'structure', message: `Description is ${desc.length} characters; the limit is 1024.`, file: skillMdPath, line: 3 });
      if (desc.length < 60 || !/\b(use (it |this )?when|when the user|when asked|use for|triggers? (on|when))\b/i.test(desc)) {
        find({ rule: 'description-vague', severity: 'warning', area: 'efficiency', message: 'Description should say what the skill does AND when to use it, with keywords users would say. The coach can rewrite it.', file: skillMdPath, line: 3 });
      }
      for (const t of targets) {
        const limit = PROFILES[t].limits.descriptionChars;
        const combined = desc.length + String(fm.when_to_use ?? '').length;
        if (combined > limit) find({ rule: `description-limit-${t}`, severity: 'warning', area: 'portability', message: `${PROFILES[t].displayName} truncates descriptions at ${limit} characters (yours: ${combined}).`, file: skillMdPath, line: 3 });
      }
    }
    if (typeof fm.compatibility === 'string' && fm.compatibility.length > 500) {
      find({ rule: 'compatibility-too-long', severity: 'warning', area: 'structure', message: '`compatibility` must be 500 characters or fewer.', file: skillMdPath });
    }

    // Portability of frontmatter fields.
    for (const t of targets) {
      const supported = new Set(PROFILES[t].frontmatter.supported);
      const unsupported = Object.keys(fm).filter((k) => !supported.has(k));
      if (unsupported.length) {
        find({ rule: `frontmatter-portability-${t}`, severity: 'info', area: 'portability', message: `${PROFILES[t].displayName} ignores: ${unsupported.join(', ')}. Tailored builds drop these for ${PROFILES[t].displayName}; move them to a per-tool override to keep the source clean.`, file: skillMdPath, line: 1 });
      }
    }
  }

  // Human docs inside the skill folder.
  for (const f of skill.files) {
    if (f.rel.includes('/')) continue;
    if (f.rel !== 'SKILL.md' && HUMAN_DOCS.test(f.rel)) {
      const fileRel = rel(opts, skill, f.rel);
      const dest = opts.config ? `docs/${f.rel}` : rel(opts, skill, `../${skill.folderName}.${f.rel}`);
      const finding = find({ rule: 'human-docs-in-skill', severity: 'warning', area: 'structure', message: `${f.rel} is for people, not the agent. Keep it outside the skill folder; SkillCraft generates README and SETUP files at build time.`, file: fileRel });
      propose({ key: `human-docs-in-skill:${fileRel}`, title: `Move ${f.rel} out of the skill folder`, priority: 'recommended', source: 'checks', why: 'Agents may read every file in the skill folder. Human docs there add noise and tokens.', impact: `Moves to ${dest}; your notes are merged into the generated README.`, changes: [{ kind: 'rename', path: fileRel, newPath: dest }] }, finding);
    }
  }

  // Misplaced files at the skill root.
  for (const f of skill.files) {
    if (f.rel.includes('/') || f.rel === 'SKILL.md' || HUMAN_DOCS.test(f.rel)) continue;
    const ext = path.extname(f.rel).toLowerCase();
    let destDir: string | undefined;
    if (SCRIPT_EXT[ext]) destDir = 'scripts';
    else if (ext === '.md') destDir = 'references';
    else if (['.json', '.csv', '.yaml', '.yml', '.png', '.jpg', '.svg', '.html', '.txt', '.docx', '.xlsx', '.pptx'].includes(ext)) destDir = 'assets';
    if (!destDir) continue;
    const fileRel = rel(opts, skill, f.rel);
    const newRel = `${destDir}/${f.rel}`;
    const finding = find({ rule: 'misplaced-file', severity: 'info', area: 'structure', message: `${f.rel} belongs in ${destDir}/ by convention.`, file: fileRel });
    propose({
      key: `misplaced-file:${fileRel}`, title: `Move ${f.rel} to ${destDir}/`, priority: 'optional', source: 'checks',
      why: `The standard layout keeps code in scripts/, docs in references/ and templates or data in assets/, so agents and people know what each file is for.`,
      impact: 'Links in SKILL.md are updated too.',
      changes: [{ kind: 'rename', path: fileRel, newPath: rel(opts, skill, newRel) }, ...withSkillMd((raw) => rewriteRefs(raw, f.rel, newRel))],
    }, finding);
  }

  // ── Integrity ──────────────────────────────────────────────────────────────
  const fileSet = new Set(skill.files.map((f) => f.rel));
  for (const ref of skill.references) {
    if (fileSet.has(ref.target) || [...fileSet].some((f) => f.startsWith(ref.target.replace(/\/$/, '') + '/'))) continue;
    const finding = find({ rule: 'broken-reference', severity: 'error', area: 'integrity', message: `SKILL.md references ${ref.target}, which doesn't exist.`, file: skillMdPath, line: ref.line });
    const base = path.basename(ref.target);
    const candidate = skill.files.find((f) => path.basename(f.rel) === base);
    if (candidate) {
      propose({ key: `broken-reference:${ref.target}`, title: `Point ${ref.target} to ${candidate.rel}`, priority: 'critical', source: 'checks', why: 'A broken link means the agent cannot find instructions or scripts it was told to use.', changes: withSkillMd((raw) => rewriteRefs(raw, ref.target, candidate.rel)) }, finding);
    }
  }

  const referenced = new Set(skill.references.map((r) => r.target));
  const mentionedElsewhere = (target: string) =>
    skill.files.some((other) => other.rel !== target && other.text !== undefined && (other.text.includes(target) || other.text.includes(path.basename(target))));
  const orphans = skill.files.filter(
    (f) =>
      /^(references|scripts|assets)\//.test(f.rel) &&
      !referenced.has(f.rel) &&
      !/(requirements\.txt|package\.json|package-lock\.json)$/.test(f.rel) &&
      !f.rel.includes('/lib/') &&
      !mentionedElsewhere(f.rel),
  );
  for (const f of orphans) {
    const fileRel = rel(opts, skill, f.rel);
    const finding = find({ rule: 'orphan-file', severity: 'warning', area: 'integrity', message: `${f.rel} isn't referenced from SKILL.md, so the agent won't know it exists.`, file: fileRel });
    const verb = f.rel.startsWith('scripts/') ? 'Run' : f.rel.startsWith('assets/') ? 'Use' : 'Read';
    propose({
      key: `orphan-file:${fileRel}`, title: `Link ${f.rel} from SKILL.md`, priority: 'recommended', source: 'checks',
      why: 'Agents discover bundled files through SKILL.md. An unlinked file is dead weight.',
      impact: 'Adds one line under "## Resources". Edit the "when" before accepting.',
      changes: withSkillMd((raw) => {
        const line = `- ${verb} [${f.rel}](${f.rel}) when …`;
        return /^## Resources\s*$/m.test(raw) ? raw.replace(/^## Resources\s*$/m, `## Resources\n\n${line}`) : `${raw.trimEnd()}\n\n## Resources\n\n${line}\n`;
      }),
    }, finding);
  }

  for (const f of skill.files.filter((x) => x.rel.startsWith('references/') && x.rel.endsWith('.md') && x.text)) {
    const nested = (f.text ?? '').match(/\]\((?!https?:)(?:\.\/)?([^)]+\.md)\)/g);
    if (nested?.length) {
      find({ rule: 'deep-reference', severity: 'info', area: 'efficiency', message: `${f.rel} links to other reference files. Keep references one level deep from SKILL.md so agents don't chase chains.`, file: rel(opts, skill, f.rel) });
    }
  }

  // Scripts: secrets, absolute paths, dependencies, env vars.
  const envUsed = new Set<string>();
  const pyImports = new Set<string>();
  const nodeImports = new Set<string>();
  for (const f of skill.files) {
    const lang = SCRIPT_EXT[path.extname(f.rel).toLowerCase()];
    if (!lang || f.text === undefined) continue;
    const fileRel = rel(opts, skill, f.rel);
    const lines = f.text.split('\n');

    lines.forEach((line, i) => {
      for (const p of SECRET_PATTERNS) {
        const m = line.match(p.re);
        if (!m) continue;
        const finding = find({ rule: 'hardcoded-secret', severity: 'error', area: 'integrity', message: `Possible ${p.label} hardcoded in ${f.rel}. Read it from an environment variable instead.`, file: fileRel, line: i + 1 });
        const assigned = line.match(/^\s*(?:export\s+)?(?:const|let|var)?\s*([A-Za-z_]\w*)\s*[:=]/)?.[1];
        const varName = (assigned ?? (m[1] && /[a-z]/i.test(m[1]) ? m[1] : `${path.basename(f.rel, path.extname(f.rel))}_TOKEN`)).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
        const replacement = lang === 'python' ? `os.environ["${varName}"]` : lang === 'node' ? `process.env.${varName}` : `"\${${varName}}"`;
        const quoted = line.match(/["'][^"']*["']/g)?.find((q) => p.re.test(q) || q.length > 9);
        if (quoted) {
          let text = f.text!.replace(line, line.replace(quoted, replacement));
          if (lang === 'python' && !/^import os\b|^import .*\bos\b/m.test(text)) text = `import os\n${text}`;
          propose({ key: `hardcoded-secret:${fileRel}:${i + 1}`, title: `Read ${varName} from the environment in ${f.rel}`, priority: 'critical', source: 'checks', why: 'Secrets in a skill get copied to every machine and repository it is installed in.', impact: `Remember to rotate the exposed credential and set ${varName} where the skill runs.`, changes: [{ kind: 'modify', path: fileRel, content: text }] }, finding);
        }
        break;
      }
      if (/["'](\/Users\/|\/home\/[a-z]|[A-Z]:\\\\)/.test(line)) {
        find({ rule: 'absolute-path', severity: 'warning', area: 'integrity', message: `Absolute path in ${f.rel} won't exist on other machines. Use paths relative to the skill folder.`, file: fileRel, line: i + 1 });
      }
    });

    scriptEnvVars(f.text, lang).forEach((v) => envUsed.add(v));
    if (lang === 'python') scriptImports(f.text, lang).forEach((m) => pyImports.add(m));
    if (lang === 'node') scriptImports(f.text, lang).forEach((m) => nodeImports.add(m));
  }

  const localModules = new Set(skill.files.map((f) => path.basename(f.rel).replace(/\.\w+$/, '')));
  const pyThirdParty = [...pyImports].filter((m) => !PY_STDLIB.has(m) && !localModules.has(m));
  if (pyThirdParty.length && !skill.files.some((f) => f.rel.endsWith('requirements.txt') || f.rel === 'pyproject.toml')) {
    const finding = find({ rule: 'python-deps-undeclared', severity: 'warning', area: 'integrity', message: `Python scripts import ${pyThirdParty.join(', ')} but no requirements.txt declares them.`, file: rel(opts, skill, 'scripts') });
    propose({ key: 'python-deps-undeclared', title: 'Declare Python dependencies in scripts/requirements.txt', priority: 'recommended', source: 'checks', why: 'Without declared dependencies, the skill fails on machines that lack these packages, and setup docs cannot list them.', changes: [{ kind: 'create', path: rel(opts, skill, 'scripts/requirements.txt'), content: pyThirdParty.map((m) => PY_PIP_NAME[m] ?? m).join('\n') + '\n' }] }, finding);
  }
  const nodeThirdParty = [...nodeImports].filter((m) => !NODE_BUILTINS.has(m));
  if (nodeThirdParty.length && !skill.files.some((f) => f.rel.endsWith('package.json'))) {
    const finding = find({ rule: 'node-deps-undeclared', severity: 'warning', area: 'integrity', message: `Node scripts import ${nodeThirdParty.join(', ')} but no package.json declares them.`, file: rel(opts, skill, 'scripts') });
    const pkg = { name: `${skill.folderName}-scripts`, private: true, type: 'module', dependencies: Object.fromEntries(nodeThirdParty.map((m) => [m, '*'])) };
    propose({ key: 'node-deps-undeclared', title: 'Declare Node dependencies in scripts/package.json', priority: 'recommended', source: 'checks', why: 'Declared dependencies make the skill installable anywhere and feed the generated setup guide.', impact: 'Pin real versions before shipping.', changes: [{ kind: 'create', path: rel(opts, skill, 'scripts/package.json'), content: JSON.stringify(pkg, null, 2) + '\n' }] }, finding);
  }

  const undocumented = [...envUsed].filter((v) => !(skill.rawSkillMd ?? '').includes(v));
  if (undocumented.length && skill.rawSkillMd) {
    const finding = find({ rule: 'env-undocumented', severity: 'warning', area: 'integrity', message: `Scripts read ${undocumented.join(', ')} but SKILL.md never mentions them, so the agent can't explain a missing credential.`, file: skillMdPath });
    propose({
      key: `env-undocumented:${undocumented.sort().join(',')}`, title: 'Document required environment variables', priority: 'recommended', source: 'checks',
      why: 'When a credential is missing, the agent should tell the user exactly which variable to set.',
      changes: withSkillMd((raw) => `${raw.trimEnd()}\n\n## Configuration\n\nThe scripts read these environment variables. If one is missing, tell the user which one to set and stop:\n\n${undocumented.map((v) => `- \`${v}\``).join('\n')}\n`),
    }, finding);
  }

  // ── Efficiency ─────────────────────────────────────────────────────────────
  const bodyLines = body.split('\n').length;
  const bodyTokens = estimateTokens(body);
  if (skill.rawSkillMd && (bodyLines > thresholds.skillMdLines || bodyTokens > thresholds.skillMdTokens)) {
    const finding = find({ rule: 'skill-md-too-long', severity: 'warning', area: 'efficiency', message: `SKILL.md is ${bodyLines} lines (~${bodyTokens.toLocaleString()} tokens). The whole file loads every time the skill triggers; aim for under ${thresholds.skillMdLines} lines.`, file: skillMdPath });
    const sections = splitSections(body).filter((s) => s.lines >= 30).sort((a, b) => b.lines - a.lines).slice(0, 3);
    if (sections.length && fm) {
      let newBody = body;
      const changes: FileChange[] = [];
      let saved = 0;
      for (const s of sections) {
        const file = `references/${slugify(s.title) || 'details'}.md`;
        if (fileSet.has(file)) continue;
        newBody = newBody.replace(s.text, `## ${s.title}\n\nSee [${file}](${file}) for details. Read it when you need ${s.title.toLowerCase()}.\n`);
        changes.push({ kind: 'create', path: rel(opts, skill, file), content: `# ${s.title}\n\n${s.text.replace(/^## .*\n/, '').trim()}\n` });
        saved += estimateTokens(s.text);
      }
      if (changes.length) {
        changes.unshift({ kind: 'modify', path: skillMdPath, content: joinFrontmatter(fm, newBody) });
        propose({ key: `split-skill-md:${sections.map((s) => slugify(s.title)).join(',')}`, title: `Move ${changes.length - 1} long section${changes.length > 2 ? 's' : ''} into references/`, priority: 'recommended', source: 'checks', why: 'Progressive disclosure: detail lives in reference files that load only when needed.', impact: `About −${saved.toLocaleString()} tokens every time the skill triggers.`, changes }, finding);
      }
    }
  }

  for (const block of codeBlocks(body)) {
    if (block.lines < 25) continue;
    const ext = { python: '.py', py: '.py', bash: '.sh', sh: '.sh', shell: '.sh', javascript: '.js', js: '.js', node: '.js' }[block.lang];
    const finding = find({ rule: 'inline-code-block', severity: 'info', area: 'efficiency', message: `A ${block.lines}-line code block in SKILL.md is loaded into context on every use. As a script it runs without costing tokens.`, file: skillMdPath, line: (skill.skillMd?.bodyStartLine ?? 1) + block.startLine });
    if (ext && fm) {
      const file = `scripts/snippet-${block.startLine}${ext}`;
      const runner = ext === '.py' ? 'python3' : ext === '.js' ? 'node' : 'bash';
      propose({ key: `inline-code-block:${block.startLine}`, title: `Move the ${block.lines}-line ${block.lang} block into ${file}`, priority: 'optional', source: 'checks', why: 'Scripts are executed rather than read, so they cost almost nothing in context and behave the same every time.', impact: `About −${estimateTokens(block.text).toLocaleString()} tokens per use. Rename the file before accepting.`, changes: [{ kind: 'create', path: rel(opts, skill, file), content: block.code + '\n' }, { kind: 'modify', path: skillMdPath, content: joinFrontmatter(fm, body.replace(block.text, `Run \`${runner} ${file}\`.`)) }] }, finding);
    }
  }

  for (const f of skill.files.filter((x) => x.rel.startsWith('references/') && x.rel.endsWith('.md') && x.text)) {
    const lines = (f.text ?? '').split('\n');
    if (lines.length <= 100 || /^#+\s*(contents|table of contents)/im.test(f.text ?? '')) continue;
    const heads = lines.filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, '').trim());
    if (heads.length < 3) continue;
    const fileRel = rel(opts, skill, f.rel);
    const finding = find({ rule: 'reference-no-toc', severity: 'info', area: 'efficiency', message: `${f.rel} is ${lines.length} lines with no table of contents. A TOC lets the agent jump to the part it needs.`, file: fileRel });
    const toc = `## Contents\n\n${heads.map((h) => `- ${h}`).join('\n')}\n\n`;
    const firstH2 = (f.text ?? '').search(/^##\s/m);
    propose({ key: `reference-no-toc:${fileRel}`, title: `Add a table of contents to ${f.rel}`, priority: 'optional', source: 'checks', why: 'Agents preview long files; a TOC up front tells them where to look.', changes: [{ kind: 'modify', path: fileRel, content: (f.text ?? '').slice(0, firstH2) + toc + (f.text ?? '').slice(firstH2) }] }, finding);
  }

  // ── Workflow ───────────────────────────────────────────────────────────────
  const wf = opts.workflow;
  if (wf && opts.config) {
    if (wf.nodes.length && !wf.nodes.some((n) => n.type === 'entry.trigger')) {
      find({ rule: 'workflow-no-trigger', severity: 'warning', area: 'workflow', message: 'The workflow has no Skill trigger. Add one so the description says when to use the skill.' });
    }
    for (const n of wf.nodes) {
      if (isPlaceholder(n.type)) {
        find({ rule: 'workflow-placeholder', severity: 'warning', area: 'workflow', message: `"${n.label}" is a placeholder. Choose what kind of component it is.`, nodeId: n.id });
        continue;
      }
      const def = getComponent(n.type);
      if (!def) {
        find({ rule: 'workflow-unknown-component', severity: 'error', area: 'workflow', message: `"${n.label}" uses unknown component ${n.type}.`, nodeId: n.id });
        continue;
      }
      const missing = missingFields(n.type, n.config);
      if (missing.length) find({ rule: 'workflow-missing-config', severity: 'warning', area: 'workflow', message: `"${n.label}" needs: ${missing.map((m) => m.label).join(', ')}.`, nodeId: n.id });
      if (n.inferred && !n.inferred.confirmed) find({ rule: 'workflow-inferred', severity: 'info', area: 'workflow', message: `"${n.label}" was inferred (${Math.round(n.inferred.confidence * 100)}% confidence): ${n.inferred.evidence}. Confirm or correct it.`, nodeId: n.id });
      for (const t of targets) {
        if (n.excludeTargets?.includes(t)) continue;
        const effective = n.targetOverrides?.[t]?.type ?? n.type;
        const support = getComponent(effective)?.support[t];
        if (support === 'no') find({ rule: `workflow-unsupported-${t}`, severity: 'error', area: 'portability', message: `"${n.label}" isn't supported in ${PROFILES[t].displayName}. Exclude it there or substitute another component.`, nodeId: n.id });
        if (support === 'setup') find({ rule: `workflow-setup-${t}`, severity: 'info', area: 'portability', message: `"${n.label}" needs setup in ${PROFILES[t].displayName}: ${getComponent(effective)?.supportNote ?? ''}`, nodeId: n.id });
      }
      for (const v of envVarsOf(n.type, n.config)) envUsed.add(v);
    }
    const connected = new Set(wf.edges.flatMap((e) => [e.source, e.target]));
    for (const n of wf.nodes) {
      if (wf.nodes.length > 1 && !connected.has(n.id)) find({ rule: 'workflow-disconnected', severity: 'info', area: 'workflow', message: `"${n.label}" isn't connected to anything.`, nodeId: n.id });
    }
  }

  return { report: buildReport(skill, opts, findings, targets), proposals };
}

function buildReport(skill: Skill, opts: CheckOptions, findings: Finding[], targets: TargetId[]): HealthReport {
  const budget = computeBudget(skill);
  const thresholds = opts.thresholds ?? { skillMdLines: 500, skillMdTokens: 5000 };
  let score = 100;
  if (budget.instructionTokens > thresholds.skillMdTokens) score -= 20;
  for (const f of findings) {
    if (f.area !== 'efficiency') continue;
    score -= f.severity === 'warning' ? 10 : f.severity === 'info' ? 4 : 15;
  }
  score = Math.max(0, Math.min(100, score));

  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const fm = skill.skillMd?.frontmatter;
  const nodes = opts.workflow?.nodes ?? [];
  const isDraft = !!fm?.name && !!fm?.description && ((skill.skillMd?.body.trim().length ?? 0) > 0 || nodes.length > 0);
  const isRunnable = isDraft && errors.length === 0 && !findings.some((f) => f.rule === 'workflow-placeholder' || f.rule === 'workflow-missing-config');
  const results = opts.state?.testResults ?? [];
  const tests = opts.tests ?? [];
  const isTested = isRunnable && tests.length > 0 && targets.every((t) => tests.every((c) => results.some((r) => r.caseId === c.id && (r.target === t || r.target === 'all') && r.passed)));
  const isReady = isTested && warnings.length === 0 && !!opts.state?.lastBuild?.ok;
  const readiness: Readiness = isReady ? 'ready' : isTested ? 'tested' : isRunnable ? 'runnable' : 'draft';

  const portability = {} as Record<TargetId, 'ok' | 'warn' | 'fail'>;
  for (const t of ['claude', 'codex', 'copilot'] as TargetId[]) {
    const mine = findings.filter((f) => f.rule.endsWith(`-${t}`));
    portability[t] = errors.length || mine.some((f) => f.severity === 'error') ? 'fail' : mine.some((f) => f.severity === 'warning') ? 'warn' : 'ok';
  }

  return {
    skillName: String(fm?.name ?? skill.folderName),
    findings,
    budget,
    efficiencyScore: score,
    readiness,
    readinessChecklist: [
      { label: 'Has a name, description and instructions or workflow', done: isDraft },
      { label: 'No errors, placeholders or missing settings', done: isRunnable },
      { label: tests.length ? 'Every test passes for every target' : 'Add test cases (tests/cases.json)', done: isTested },
      { label: 'No warnings and a successful build', done: isReady },
    ],
    portability,
  };
}

interface Section {
  title: string;
  text: string;
  lines: number;
}

export function splitSections(body: string): Section[] {
  const out: Section[] = [];
  const parts = body.split(/^(?=## )/m);
  for (const part of parts) {
    const m = part.match(/^## (.+)\n/);
    if (!m) continue;
    out.push({ title: m[1].trim(), text: part, lines: part.split('\n').length });
  }
  return out;
}

export function codeBlocks(body: string): { lang: string; code: string; text: string; lines: number; startLine: number }[] {
  const out: { lang: string; code: string; text: string; lines: number; startLine: number }[] = [];
  const re = /^```(\w*)\n([\s\S]*?)^```/gm;
  for (const m of body.matchAll(re)) {
    const startLine = body.slice(0, m.index).split('\n').length - 1;
    out.push({ lang: m[1].toLowerCase(), code: m[2].trimEnd(), text: m[0], lines: m[2].split('\n').length, startLine });
  }
  return out;
}
