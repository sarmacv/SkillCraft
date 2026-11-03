import assert from 'node:assert/strict';
import { mermaid, allEnvVars, readme, setup } from '../src/core/docs';
import type { DocInputs, Workflow } from '../src/core/types';

const mockWorkflow: Workflow = {
  version: 1,
  nodes: [
    { id: 't', type: 'entry.trigger', label: 'Skill trigger', config: { does: 'Does something', whenToUse: 'when asked', examples: 'Example usage' }, position: { x: 0, y: 0 } },
    { id: 'source', type: 'source.rest', label: 'Source', config: { url: 'http://example.com' }, position: { x: 0, y: 0 } },
  ],
  edges: [],
};

const mockInputs: DocInputs = {
  config: { name: 'Test Skill', version: '1.0.0', language: 'node' },
  workflow: mockWorkflow,
  description: 'This is a test skill.',
  envVars: ['TEST_VAR'],
  pythonDeps: [],
  nodeDeps: true,
  builtTargets: ['claude'],
  universal: false,
};

test('mermaid function generates correct diagram', () => {
  const result = mermaid(mockWorkflow);
  assert.ok(result.includes('flowchart LR'));
  assert.ok(result.includes('Skill trigger'));
});

test('allEnvVars combines workflow and script env vars', () => {
  const result = allEnvVars(mockWorkflow, ['SCRIPT_VAR']);
  assert.deepEqual(result, ['SCRIPT_VAR', 'TEST_VAR']);
});

test('readme function generates correct markdown', () => {
  const result = readme(mockInputs);
  assert.ok(result.includes('# Test Skill'));
  assert.ok(result.includes('This is a test skill.'));
  assert.ok(result.includes('## Requirements'));
});

test('setup function generates correct setup instructions', () => {
  const result = setup(mockInputs, 'claude');
  assert.ok(result.includes('# Set up Test Skill for Claude'));
});
