import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { loadWorkspace, saveWorkflow, saveState, hasProject, emptyWorkflow } from '../src/core/project';

const TEST_ROOT = path.join(__dirname, 'test_workspace');

test('loadWorkspace returns undefined for non-existent project', () => {
  assert.equal(loadWorkspace(TEST_ROOT), undefined);
});

test('hasProject returns false for non-existent project file', () => {
  assert.equal(hasProject(TEST_ROOT), false);
});

test('emptyWorkflow creates a valid empty workflow', () => {
  const workflow = emptyWorkflow();
  assert.deepEqual(workflow, { version: 1, nodes: [], edges: [] });
});

test('saveWorkflow saves a workflow to the specified path', () => {
  const workflow = emptyWorkflow();
  saveWorkflow(TEST_ROOT, workflow);
  const savedWorkflow = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, 'workflow.json'), 'utf8'));
  assert.deepEqual(savedWorkflow, workflow);
});

test('saveState saves local state to the specified path', () => {
  const state = { testResults: [], lastBuild: { at: new Date().toISOString(), targets: [], ok: true } };
  saveState(TEST_ROOT, state);
  const savedState = JSON.parse(fs.readFileSync(path.join(TEST_ROOT, '.skillcraft/state.json'), 'utf8'));
  assert.deepEqual(savedState, state);
});
