// Target profiles are versioned data (profiles/*.json), not logic, so a tool
// changing its skill format means shipping new JSON, not new code.

import claude from '../../profiles/claude.json';
import codex from '../../profiles/codex.json';
import copilot from '../../profiles/copilot.json';
import type { TargetId } from './types';

export interface TargetProfile {
  id: TargetId;
  displayName: string;
  profileVersion: string;
  verifiedAt: string;
  sources: string[];
  install: { project: string; user: string; plugin?: string };
  frontmatter: { required: string[]; supported: string[] };
  limits: { descriptionChars: number; skillMdLines: number };
  invoke: string;
  mcp: { how: string; snippet: string };
  runtimes: string[];
  extraFiles: string[];
}

export const PROFILES: Record<TargetId, TargetProfile> = {
  claude: claude as TargetProfile,
  codex: codex as TargetProfile,
  copilot: copilot as TargetProfile,
};

/** Fields every selected target understands — the Universal build uses only these. */
export function commonFrontmatter(targets: TargetId[]): string[] {
  const sets = targets.map((t) => new Set(PROFILES[t].frontmatter.supported));
  return [...(sets[0] ?? [])].filter((f) => sets.every((s) => s.has(f)));
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
