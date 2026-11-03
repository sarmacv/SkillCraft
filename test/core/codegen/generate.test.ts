import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFor, paramsOf, planScripts, renderWorkflowSection } from '../../src/core/codegen/generate';
import type { Workflow } from '../../src/core/types';

const mockWorkflow: Workflow = {
  version: 1,
  nodes: [
    { id: 'input', type: 'entry.input', label: 'Input', config: { params: 'param1: first parameter\nparam2: second parameter' }, position: { x: 0, y: 0 } },
    { id: 'source1', type: 'source.rest', label: 'Source 1', config: { baseUrl: 'https://api.example.com', path: '/data', method: 'GET' }, position: { x: 0, y: 0 } },
    { id: 'source2', type: 'source.rest', label: 'Source 2', config: { baseUrl: 'https://api.example.com', path: '/data2', method: 'GET' }, position: { x: 0, y: 0 } },
    { id: 'output', type: 'output.message', label: 'Output', config: { channel: 'channel_id' }, position: { x: 0, y: 0 } },
    { id: 'merge', type: 'module.script', label: 'Merge Data', config: { purpose: 'Merge data from sources' }, position: { x: 0, y: 0 } },
  ],
  edges: [
    { id: 'e1', source: 'input', target: 'source1' },
    { id: 'e2', source: 'input', target: 'source2' },
    { id: 'e3', source: 'source1', target: 'merge' },
    { id: 'e4', source: 'source2', target: 'merge' },
    { id: 'e5', source: 'merge', target: 'output' },
  ],
};

test('workflowFor filters nodes correctly', () => {
  const result = workflowFor(mockWorkflow, 'source.rest');
  assert.equal(result.nodes.length, 3); // input, source1, source2
});

test('paramsOf extracts parameters correctly', () => {
  const params = paramsOf(mockWorkflow);
  assert.equal(params.length, 2);
  assert.equal(params[0].name, 'param1');
  assert.equal(params[1].name, 'param2');
});

test('planScripts generates script plans correctly', () => {
  const plans = planScripts(mockWorkflow, 'node');
  assert.equal(plans.length, 3); // Merge Data, Source 1, Source 2
});

test('renderWorkflowSection generates correct markdown', () => {
  const markdown = renderWorkflowSection(mockWorkflow, 'node');
  assert.ok(markdown.includes('## Inputs'));
  assert.ok(markdown.includes('## Workflow'));
});
