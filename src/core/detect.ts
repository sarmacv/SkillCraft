// Brownfield: find existing skills anywhere in a folder.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TargetId } from './types';
import { splitFrontmatter } from './skill';

export interface DetectedSkill {
  /** Absolute path of the skill folder. */
  dir: string;
  /** Path relative to the scanned root. */
  rel: string;
  name: string;
  description: string;
  /** Tools this location or layout suggests the skill was written for. */
  formats: TargetId[];
  inPlugin: boolean;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'out-test', '.venv', 'venv', '__pycache__', '.skillcraft']);

export function detectSkills(root: string, maxDepth = 7): DetectedSkill[] {
  const found: DetectedSkill[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      found.push(describe(root, dir));
      return; // a skill's subfolders are part of the skill
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name)) visit(path.join(dir, e.name), depth + 1);
    }
  };
  visit(root, 0);
  return found;
}

function describe(root: string, dir: string): DetectedSkill {
  const rel = path.relative(root, dir).split(path.sep).join('/') || '.';
  const raw = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const fm = splitFrontmatter(raw).frontmatter ?? {};
  const formats = new Set<TargetId>();
  if (rel.includes('.claude/skills')) formats.add('claude');
  if (rel.includes('.agents/skills')) formats.add('codex').add('copilot');
  if (rel.includes('.github/skills')) formats.add('copilot');
  if (fs.existsSync(path.join(dir, 'agents', 'openai.yaml'))) formats.add('codex');
  const claudeOnly = ['allowed-tools', 'disable-model-invocation', 'argument-hint', 'context', 'hooks', 'when_to_use'];
  if (Object.keys(fm).some((k) => claudeOnly.includes(k))) formats.add('claude');
  let inPlugin = false;
  for (let d = dir, i = 0; i < 4; i++, d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.claude-plugin')) || fs.existsSync(path.join(d, '.codex-plugin'))) {
      inPlugin = true;
      break;
    }
  }
  return {
    dir,
    rel,
    name: typeof fm.name === 'string' ? fm.name : path.basename(dir),
    description: typeof fm.description === 'string' ? fm.description : '',
    formats: [...formats],
    inPlugin,
  };
}
