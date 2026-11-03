import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { registerChat } from '../src/vscode/chat';

suite('Chat Module Tests', () => {
  let context: vscode.ExtensionContext;

  setup(() => {
    context = { subscriptions: [] } as any;
  });

  test('registerChat should create a chat participant', () => {
    registerChat(context, {} as any);
    assert.equal(context.subscriptions.length, 1, 'Expected one subscription to be added');
  });

  test('history function should return correct format', () => {
    const mockHistory = [
      new vscode.ChatRequestTurn('User prompt'),
      new vscode.ChatResponseTurn([new vscode.ChatResponseMarkdownPart('AI response')]),
    ];
    const result = history({ history: mockHistory });
    assert.deepEqual(result, [
      { role: 'user', content: 'User prompt' },
      { role: 'assistant', content: 'AI response' },
    ]);
  });

  test('guarded function should push markdown correctly', () => {
    const mockStream = {
      markdown: (content: string) => assert.equal(content, 'Hello'),
      push: (chunk: string) => {
        if (chunk === 'Hello') {
          mockStream.markdown(chunk);
        }
      },
    };
    const g = guarded(mockStream as any, '```skillcraft-plan');
    g.push('Hello');
    g.flush();
  });

  test('offerReview should add proposals to controller', () => {
    const mockStream = {
      button: () => {},
    };
    const mockController = {
      addProposal: (proposal: any) => assert.ok(proposal),
    };
    const proposals = [{ title: 'Test Proposal', key: 'test-key' }];
    offerReview(mockStream as any, mockController, proposals);
  });
});
