import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { detectSkills } from '../src/core/detect';

const SKILL_DIR = '.claude/skills/Weekly-Report';

function mockFileSystem(root: string) {
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, SKILL_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, SKILL_DIR, 'SKILL.md'), `---
name: Weekly Report
description: Does reports
---
# Weekly report
`);
}

test('detects skills in a directory', () => {
  const root = path.join(__dirname, 'mock');
  mockFileSystem(root);
  const skills = detectSkills(root);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'Weekly Report');
  assert.equal(skills[0].description, 'Does reports');
});

test('does not detect skills in skipped directories', () => {
  const root = path.join(__dirname, 'mock');
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  mockFileSystem(root);
  const skills = detectSkills(root);
  assert.equal(skills.length, 1);
});

test('handles non-existent directories gracefully', () => {
  const root = path.join(__dirname, 'nonexistent');
  const skills = detectSkills(root);
  assert.deepEqual(skills, []);
});
