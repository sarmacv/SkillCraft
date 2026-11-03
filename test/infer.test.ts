import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferWorkflow } from '../src/core/infer';

const SAMPLE_SKILL = {
  skillMd: {
    frontmatter: {
      description: 'Sample skill description',
    },
    body: '## Inputs\n- input1\n- input2\n',
  },
  files: [
    {
      rel: 'scripts/sample_script.js',
      text: 'console.log("Hello World");',
    },
  ],
};

test('inferWorkflow should create a workflow from a skill', () => {
  const workflow = inferWorkflow(SAMPLE_SKILL);
  assert.equal(workflow.nodes.length > 0, true);
  assert.ok(workflow.nodes.some(node => node.type === 'entry.trigger'));
  assert.ok(workflow.nodes.some(node => node.type === 'entry.input'));
  assert.ok(workflow.nodes.some(node => node.type === 'module.script'));
});

test('inferWorkflow should link nodes correctly', () => {
  const workflow = inferWorkflow(SAMPLE_SKILL);
  const edges = workflow.edges;
  assert.ok(edges.length > 0);
  assert.ok(edges.some(edge => edge.source === 'trigger' && edge.target === 'inputs'));
});

test('inferWorkflow should handle missing inputs gracefully', () => {
  const skillWithoutInputs = {
    skillMd: {
      frontmatter: {
        description: 'Skill without inputs',
      },
      body: '',
    },
    files: [],
  };
  const workflow = inferWorkflow(skillWithoutInputs);
  assert.ok(workflow.nodes.some(node => node.type === 'entry.trigger'));
  assert.equal(workflow.nodes.length, 1); // Only trigger node should exist
});
