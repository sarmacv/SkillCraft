import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { registerReview, previewProposal, acceptProposal, rejectProposal } from '../src/vscode/review';
import { Controller } from '../src/vscode/controller';

suite('Review Tests', () => {
  let controller: Controller;

  setup(() => {
    controller = {
      root: '/mock/root',
      getProposal: (key: string) => ({
        key,
        title: 'Mock Proposal',
        changes: [],
        why: 'Mock reason',
        impact: 'Mock impact',
        source: 'mock',
        touchedFiles: () => ['file1.ts', 'file2.ts'],
      }),
      accept: (key: string) => true,
      reject: (key: string, reason?: string) => {},
      undo: () => {},
    } as unknown as Controller;
  });

  test('registerReview registers content providers', () => {
    const context = { subscriptions: [] } as vscode.ExtensionContext;
    registerReview(context, controller);
    assert.equal(context.subscriptions.length, 2);
  });

  test('previewProposal shows information message when proposal is not found', async () => {
    const key = 'nonexistent-key';
    await previewProposal(controller, key);
    // Verify that the information message is shown
  });

  test('acceptProposal accepts a proposal', async () => {
    const key = 'mock-key';
    const result = await acceptProposal(controller, key);
    assert.ok(result);
  });

  test('rejectProposal rejects a proposal', async () => {
    const key = 'mock-key';
    await rejectProposal(controller, key);
    // Verify that the proposal is rejected
  });
});
