import assert from 'node:assert/strict';
import { CATALOG, getComponent, isPlaceholder, categoryOf, envVarsOf, missingFields } from '../src/core/catalog';

describe('Catalog Tests', () => {
  it('should retrieve component by ID', () => {
    const component = getComponent('entry.trigger');
    assert.ok(component);
    assert.equal(component?.label, 'Skill trigger');
  });

  it('should identify placeholders correctly', () => {
    assert.ok(isPlaceholder('placeholder.entry'));
    assert.ok(!isPlaceholder('entry.trigger'));
  });

  it('should return category of a component', () => {
    assert.equal(categoryOf('entry.trigger'), 'entry');
    assert.equal(categoryOf('source.rest'), 'source');
  });

  it('should extract environment variables from component config', () => {
    const config = { auth: 'bearer token', tokenEnv: 'JIRA_API_TOKEN' };
    const envVars = envVarsOf('source.rest', config);
    assert.deepEqual(envVars, ['JIRA_API_TOKEN']);
  });

  it('should identify missing required fields', () => {
    const config = { auth: '', tokenEnv: 'JIRA_API_TOKEN' };
    const missing = missingFields('source.rest', config);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].key, 'auth');
  });
});
