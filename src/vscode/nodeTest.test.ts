import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testSource } from '../src/vscode/nodeTest';

test('testSource with valid REST source', async () => {
  const node = {
    type: 'source.rest',
    config: {
      baseUrl: 'https://api.example.com',
      path: '/data',
      method: 'GET',
      query: '{}',
      tokenEnv: '',
      auth: 'none',
    },
  };
  const result = await testSource(node);
  assert.ok(result.ok);
  assert.match(result.detail, /HTTP \d+/);
});

test('testSource with invalid URL', async () => {
  const node = {
    type: 'source.rest',
    config: {
      baseUrl: 'invalid-url',
      path: '',
      method: 'GET',
      query: '{}',
      tokenEnv: '',
      auth: 'none',
    },
  };
  const result = await testSource(node);
  assert.ok(!result.ok);
  assert.equal(result.detail, 'Set a full URL (https://…) first.');
});

test('testSource with invalid JSON query', async () => {
  const node = {
    type: 'source.rest',
    config: {
      baseUrl: 'https://api.example.com',
      path: '/data',
      method: 'GET',
      query: '{invalid-json}',
      tokenEnv: '',
      auth: 'none',
    },
  };
  const result = await testSource(node);
  assert.ok(!result.ok);
  assert.equal(result.detail, 'The query/body is not valid JSON.');
});

test('testSource with GraphQL source', async () => {
  const node = {
    type: 'source.graphql',
    config: {
      endpoint: 'https://api.example.com/graphql',
      query: '{ data }',
    },
  };
  const result = await testSource(node);
  assert.ok(result.ok);
  assert.match(result.detail, /HTTP \d+/);
});

test('testSource with Knowledge source', async () => {
  const node = {
    type: 'source.knowledge',
    config: {
      endpoint: 'https://api.example.com/knowledge',
    },
  };
  const result = await testSource(node);
  assert.ok(result.ok);
  assert.match(result.detail, /HTTP \d+/);
});

test('testSource with Web source', async () => {
  const node = {
    type: 'source.web',
    config: {
      url: 'https://example.com',
    },
  };
  const result = await testSource(node);
  assert.ok(result.ok);
  assert.match(result.detail, /HTTP \d+/);
});

// Additional tests for untested branches
test('testSource with REST source and query', async () => {
  const node = {
    type: 'source.rest',
    config: {
      baseUrl: 'https://api.example.com',
      path: '/data',
      method: 'POST',
      query: '{"key":"value"}',
      tokenEnv: '',
      auth: 'none',
    },
  };
  const result = await testSource(node);
  assert.ok(result.ok);
  assert.match(result.detail, /HTTP \d+/);
});

test('testSource with missing token in environment', async () => {
  const node = {
    type: 'source.rest',
    config: {
      baseUrl: 'https://api.example.com',
      path: '/data',
      method: 'GET',
      query: '{}',
      tokenEnv: 'MISSING_ENV',
      auth: 'api key header',
    },
  };
  const result = await testSource(node);
  assert.ok(!result.ok);
  assert.equal(result.detail, 'MISSING_ENV isn\'t set in VS Code\'s environment. Set it in your shell, restart VS Code, and try again.');
});
