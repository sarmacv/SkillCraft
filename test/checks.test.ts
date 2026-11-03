import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runChecks } from '../src/core/checks';
import { loadSkill } from '../src/core/skill';

test('runChecks returns expected findings', () => {
  const skill = loadSkill('path/to/your/skill'); // Adjust the path as necessary
  const { report } = runChecks(skill, { root: 'path/to/root', config: { name: 'test-skill', version: '0.1.0' } });
  
  assert.ok(report.findings.length > 0, 'Expected findings should be present');
  assert.equal(report.readiness, 'draft', 'Skill should be in draft readiness state');
});

// Add more tests to cover additional branches and public behavior of the checks.ts file
