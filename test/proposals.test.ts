import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { applyChanges, contentAfter, newProjectProposal, touchedFiles } from '../src/core/proposals';

const TEST_ROOT = path.join(__dirname, 'test-root');

test('applyChanges creates and modifies files correctly', () => {
  const changes = [
    { kind: 'create', path: 'test.txt', content: 'Hello, World!' },
    { kind: 'modify', path: 'test.txt', content: 'Hello, SkillCraft!' },
    { kind: 'delete', path: 'test.txt' },
  ];
  
  const undo = applyChanges(TEST_ROOT, changes);
  
  assert.ok(fs.existsSync(path.join(TEST_ROOT, 'test.txt')));
  assert.equal(fs.readFileSync(path.join(TEST_ROOT, 'test.txt'), 'utf8'), 'Hello, SkillCraft!');
  
  applyChanges(TEST_ROOT, undo);
  assert.ok(!fs.existsSync(path.join(TEST_ROOT, 'test.txt')));
});

test('contentAfter returns correct content after proposal changes', () => {
  const proposal = {
    changes: [
      { kind: 'create', path: 'test.txt', content: 'Hello, World!' },
      { kind: 'modify', path: 'test.txt', content: 'Hello, SkillCraft!' },
    ],
  };
  
  const content = contentAfter(TEST_ROOT, proposal, 'test.txt');
  assert.equal(content, 'Hello, SkillCraft!');
});

test('touchedFiles returns unique touched files', () => {
  const proposal = {
    changes: [
      { kind: 'create', path: 'test1.txt', content: 'Test 1' },
      { kind: 'rename', path: 'test2.txt', newPath: 'test3.txt' },
    ],
  };
  
  const touched = touchedFiles(proposal);
  assert.deepEqual(touched.sort(), ['test1.txt', 'test2.txt', 'test3.txt'].sort());
});

test('newProjectProposal creates a valid proposal', () => {
  const proposal = newProjectProposal({
    name: 'test-project',
    language: 'python',
    targets: ['claude'],
    workflow: { version: 1, nodes: [], edges: [] },
    source: 'setup',
  });
  
  assert.equal(proposal.key, 'new-project:test-project');
  assert.equal(proposal.title, 'Create skill project "test-project"');
  assert.equal(proposal.changes.length, 6); // Check for the number of changes
});
