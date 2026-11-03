import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { Controller } from '../src/vscode/controller';

const mockWorkspace = {
  config: {
    skillPath: 'mock/skill/path',
    name: 'mock-project',
    language: 'typescript',
    targets: [],
    buildMode: 'default',
  },
  state: {
    history: [],
  },
};

test('Controller initializes with correct properties', () => {
  const controller = new Controller();
  assert.ok(controller);
  assert.strictEqual(controller.root, undefined);
  assert.deepStrictEqual(controller.detected, []);
  assert.deepStrictEqual(controller.checkProposals, new Map());
});

test('Controller refresh updates workspace and skill', () => {
  const controller = new Controller();
  controller.root = '/mock/root';
  controller.ws = mockWorkspace;

  controller.refresh();

  assert.ok(controller.ws);
  assert.strictEqual(controller.detected.length, 0);
  assert.strictEqual(controller.skill?.skillMd?.frontmatter?.name, undefined);
});

test('Controller addProposal adds a proposal and fires change event', () => {
  const controller = new Controller();
  let changeFired = false;
  controller.onDidChange(() => {
    changeFired = true;
  });

  const proposal = { key: 'test-proposal', title: 'Test Proposal', changes: [] };
  controller.addProposal(proposal);

  assert.ok(changeFired);
  assert.strictEqual(controller.proposals.length, 1);
  assert.strictEqual(controller.proposals[0].key, 'test-proposal');
});

test('Controller accept applies a proposal and refreshes', () => {
  const controller = new Controller();
  controller.root = '/mock/root';
  controller.ws = mockWorkspace;

  const proposal = {
    key: 'test-proposal',
    title: 'Test Proposal',
    changes: [{ kind: 'modify', path: 'mock/path', content: 'new content' }],
  };
  controller.addProposal(proposal);

  const accepted = controller.accept('test-proposal');
  assert.ok(accepted);
  assert.strictEqual(controller.checkProposals.size, 0);
});

test('Controller reject removes a proposal and refreshes', () => {
  const controller = new Controller();
  controller.root = '/mock/root';
  controller.ws = mockWorkspace;

  const proposal = { key: 'test-proposal', title: 'Test Proposal', changes: [] };
  controller.addProposal(proposal);

  controller.reject('test-proposal', 'Not needed anymore');
  assert.strictEqual(controller.checkProposals.size, 0);
});

test('Controller undo reverts the last action', () => {
  const controller = new Controller();
  controller.root = '/mock/root';
  controller.ws = mockWorkspace;

  const proposal = {
    key: 'test-proposal',
    title: 'Test Proposal',
    changes: [{ kind: 'modify', path: 'mock/path', content: 'new content' }],
  };
  controller.addProposal(proposal);
  controller.accept('test-proposal');

  const title = controller.undo();
  assert.strictEqual(title, 'Test Proposal');
  assert.strictEqual(controller.checkProposals.size, 1);
});

