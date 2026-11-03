import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { build } from '../src/core/build';
import { loadSkill } from '../src/core/skill';
import { tmp } from './utils'; // Assuming a utility function for temporary directory creation

const SAMPLE_WORKSPACE = {
  config: {
    name: 'sample-skill',
    skillPath: 'skills/sample-skill',
    targets: ['claude'],
    version: '0.1.0',
    buildMode: 'tailored',
  },
  root: '',
  workflow: { nodes: [] },
  state: { testResults: [] },
};

function createSampleSkill(root: string) {
  const skillDir = path.join(root, SAMPLE_WORKSPACE.config.skillPath);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---
name: Sample Skill
description: A sample skill for testing.
---`);
}

test('build function returns expected result', () => {
  const root = tmp();
  createSampleSkill(root);
  const ws = { ...SAMPLE_WORKSPACE, root };
  const result = build(ws);
  assert.ok(result.ok);
  assert.equal(result.outDir, path.join(root, 'dist'));
  assert.ok(result.builds.length > 0);
});

test('build function handles missing SKILL.md gracefully', () => {
  const root = tmp();
  const ws = { ...SAMPLE_WORKSPACE, root };
  const result = build(ws);
  assert.ok(!result.ok);
  assert.ok(result.errors.includes('SKILL.md is missing or has invalid frontmatter.'));
});

test('build function checks folder name matches skill name', () => {
  const root = tmp();
  createSampleSkill(root);
  const ws = { ...SAMPLE_WORKSPACE, root };
  ws.config.name = 'wrong-name'; // Intentionally set a wrong name
  const result = build(ws);
  assert.ok(!result.ok);
  assert.ok(result.errors.includes('Skill folder "sample-skill" must match the project name "wrong-name".'));
});
