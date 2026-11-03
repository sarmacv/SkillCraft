import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newId, topoOrder, autoLayout, applyWorkflowChange, connect } from '../src/core/workflow';
import type { Workflow, WorkflowNode, WorkflowChange } from '../src/core/types';

test('newId generates unique IDs', () => {
  const id1 = newId();
  const id2 = newId();
  assert.notEqual(id1, id2);
});

test('topoOrder orders nodes correctly', () => {
  const wf: Workflow = {
    version: 1,
    nodes: [
      { id: 'a', type: 'module', label: 'A', position: { x: 0, y: 0 } },
      { id: 'b', type: 'module', label: 'B', position: { x: 0, y: 1 } },
      { id: 'c', type: 'module', label: 'C', position: { x: 0, y: 2 } },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ],
  };
  const ordered = topoOrder(wf);
  assert.deepEqual(ordered.map(n => n.id), ['a', 'b', 'c']);
});

test('autoLayout positions nodes correctly', () => {
  const wf: Workflow = {
    version: 1,
    nodes: [
      { id: 'a', type: 'entry', label: 'A', position: { x: 0, y: 0 } },
      { id: 'b', type: 'module', label: 'B', position: { x: 0, y: 0 } },
    ],
    edges: [],
  };
  const layout = autoLayout(wf);
  assert.equal(layout.nodes[0].position.x, 0);
  assert.equal(layout.nodes[1].position.x, 1);
});

test('applyWorkflowChange applies changes correctly', () => {
  const wf: Workflow = {
    version: 1,
    nodes: [{ id: 'a', type: 'module', label: 'A', position: { x: 0, y: 0 } }],
    edges: [],
  };
  const change: WorkflowChange = {
    addNodes: [{ id: 'b', type: 'module', label: 'B', position: { x: 1, y: 0 } }],
  };
  const updatedWf = applyWorkflowChange(wf, change);
  assert.equal(updatedWf.nodes.length, 2);
  assert.equal(updatedWf.nodes[1].id, 'b');
});

test('connect creates a connection object', () => {
  const connection = connect('source', 'target');
  assert.equal(connection.source, 'source');
  assert.equal(connection.target, 'target');
});
