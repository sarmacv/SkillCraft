import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TEMPLATES } from '../src/core/templates';

test('templates have correct structure', () => {
  TEMPLATES.forEach(template => {
    assert.ok(template.id, 'Template should have an id');
    assert.ok(template.name, 'Template should have a name');
    assert.ok(template.title, 'Template should have a title');
    assert.ok(template.detail, 'Template should have a detail');
    assert.ok(template.workflow, 'Template should have a workflow');
  });
});

// Additional tests can be added here to cover specific behaviors of the templates
