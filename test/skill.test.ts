import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitFrontmatter, joinFrontmatter, findReferences, loadSkill } from '../src/core/skill';

test('splitFrontmatter correctly parses frontmatter and body', () => {
  const input = `---
name: Test Skill
description: A skill for testing
---
This is the body of the skill.`;
  
  const result = splitFrontmatter(input);
  assert.equal(result.frontmatter?.name, 'Test Skill');
  assert.equal(result.body, 'This is the body of the skill.');
});

test('joinFrontmatter correctly combines frontmatter and body', () => {
  const frontmatter = { name: 'Test Skill', description: 'A skill for testing' };
  const body = 'This is the body of the skill.';
  
  const result = joinFrontmatter(frontmatter, body);
  assert.match(result, /---\nname: Test Skill\ndescription: A skill for testing\n---/);
  assert.match(result, /This is the body of the skill./);
});

test('findReferences extracts correct references from markdown', () => {
  const markdown = 'See [example](example.md) and `scripts/test.py`.';
  const references = findReferences(markdown);
  
  assert.equal(references.length, 2);
  assert.deepEqual(references.map(r => r.target).sort(), ['example.md', 'scripts/test.py']);
});

test('loadSkill loads skill correctly', () => {
  const skillDir = 'test/skill-test'; // Assume this directory exists with a SKILL.md
  const skill = loadSkill(skillDir);
  
  assert.equal(skill.folderName, 'skill-test');
  assert.ok(skill.files.length > 0);
});
