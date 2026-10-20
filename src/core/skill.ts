// Reading a skill folder from disk into a structured form.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface SkillFile {
  /** Path relative to the skill folder, always with forward slashes. */
  rel: string;
  size: number;
  /** Text content for text files under 512 KB; undefined for binaries. */
  text?: string;
}

export interface ParsedSkillMd {
  frontmatter: Record<string, unknown> | undefined;
  frontmatterError?: string;
  /** Line number (1-based) where the body starts. */
  bodyStartLine: number;
  body: string;
}

export interface Skill {
  /** Absolute path to the skill folder. */
  dir: string;
  folderName: string;
  skillMd?: ParsedSkillMd;
  rawSkillMd?: string;
  files: SkillFile[];
  /** Relative paths referenced from SKILL.md (links and inline mentions). */
  references: { target: string; line: number }[];
}

const TEXT_EXT = new Set(['.md', '.txt', '.py', '.js', '.mjs', '.cjs', '.ts', '.sh', '.bash', '.ps1', '.json', '.yaml', '.yml', '.toml', '.csv', '.html', '.css', '.sql', '.xml', '.env', '']);
const IGNORED_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.DS_Store']);

export function splitFrontmatter(raw: string): ParsedSkillMd {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: undefined, bodyStartLine: 1, body: normalized };
  }
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) {
    return { frontmatter: undefined, frontmatterError: 'Frontmatter is not closed with ---', bodyStartLine: 1, body: normalized };
  }
  const yamlText = normalized.slice(4, end);
  const afterMarker = normalized.indexOf('\n', end + 4);
  const body = afterMarker === -1 ? '' : normalized.slice(afterMarker + 1);
  const bodyStartLine = normalized.slice(0, afterMarker + 1).split('\n').length;
  try {
    const fm = parseYaml(yamlText);
    if (fm === null || typeof fm !== 'object' || Array.isArray(fm)) {
      return { frontmatter: undefined, frontmatterError: 'Frontmatter must be a YAML mapping', bodyStartLine, body };
    }
    return { frontmatter: fm as Record<string, unknown>, bodyStartLine, body };
  } catch (e) {
    return { frontmatter: undefined, frontmatterError: `Invalid YAML: ${(e as Error).message.split('\n')[0]}`, bodyStartLine, body };
  }
}

export function joinFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, '')}`;
}

/** Relative file references in Markdown: [text](path) links and `scripts/x.py`-style mentions. */
export function findReferences(markdown: string, lineOffset = 1): { target: string; line: number }[] {
  const out: { target: string; line: number }[] = [];
  const seen = new Set<string>();
  markdown.split('\n').forEach((line, i) => {
    const add = (t: string) => {
      const clean = t.split('#')[0].replace(/^\.\//, '').trim();
      if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith('/') || clean.includes('{') || clean.includes('$')) return;
      const key = `${clean}@${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ target: clean, line: i + lineOffset });
    };
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) add(m[1]);
    for (const m of line.matchAll(/(?:^|[\s`'"(])((?:scripts|references|assets)\/[\w.\/-]+\.\w+)/g)) add(m[1]);
  });
  return out;
}

function walk(dir: string, base: string, out: SkillFile[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walk(abs, base, out);
    } else if (entry.isFile()) {
      const size = fs.statSync(abs).size;
      const isText = TEXT_EXT.has(path.extname(entry.name).toLowerCase()) && size < 512 * 1024;
      out.push({ rel, size, text: isText ? fs.readFileSync(abs, 'utf8') : undefined });
    }
  }
}

export function loadSkill(dir: string): Skill {
  const files: SkillFile[] = [];
  if (fs.existsSync(dir)) walk(dir, dir, files);
  const skillMdFile = files.find((f) => f.rel === 'SKILL.md');
  const skillMd = skillMdFile?.text !== undefined ? splitFrontmatter(skillMdFile.text) : undefined;
  return {
    dir,
    folderName: path.basename(dir),
    skillMd,
    rawSkillMd: skillMdFile?.text,
    files,
    references: skillMd ? findReferences(skillMd.body, skillMd.bodyStartLine) : [],
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '');
}
