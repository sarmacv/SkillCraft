import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coachAnswer, coachReview } from '../src/vscode/coach';
import { Controller } from '../src/vscode/controller';

test('coachReview should prompt for skill creation', async () => {
  const controller = new Controller();
  await coachReview(controller);
  assert.ok(controller.coach.length === 0, 'No questions should be asked if no skill is present');
});

test('coachAnswer should process answers correctly', async () => {
  const controller = new Controller();
  controller.coach = [{ id: 'q1', area: 'Clarity', question: 'Is this clear?', suggestion: 'Yes' }];
  await coachAnswer(controller, 'q1', { text: 'It is clear', decide: false });
  assert.ok(controller.coach.length === 0, 'Question should be removed after answering');
});
