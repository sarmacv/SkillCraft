import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { SkillsTree, HealthTree, ProposalsTree } from '../src/vscode/views';
import { Controller } from '../src/vscode/controller';

class MockController implements Controller {
  root = '/mock/root';
  ws = { config: { skillPath: 'mock/skill/path' }, workflow: { nodes: [] }, tests: [] };
  detected = [];
  skill = { files: [] };
  report = { readiness: 'draft' };
  onDidChange = (callback: () => void) => { /* Mock implementation */ };
}

suite('Views Tests', () => {
  let controller: MockController;

  setup(() => {
    controller = new MockController();
  });

  test('SkillsTree should return correct roots', () => {
    const tree = new SkillsTree(controller);
    const roots = tree.roots();
    assert.equal(roots.length, 1);
    assert.equal(roots[0].label, 'mock/skill/path');
  });

  test('HealthTree should return correct roots', () => {
    const tree = new HealthTree(controller);
    const roots = tree.roots();
    assert.equal(roots.length, 1);
    assert.equal(roots[0].label.startsWith('Readiness:'), true);
  });

  test('ProposalsTree should return correct roots', () => {
    const tree = new ProposalsTree(controller);
    const roots = tree.roots();
    assert.equal(roots.length, 0); // Assuming no proposals are present
  });
});
