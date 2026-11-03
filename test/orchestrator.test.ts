import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { Orchestrator } from '../src/vscode/orchestrator';
import type { Controller } from '../src/vscode/controller';

suite('Orchestrator Tests', () => {
  let mockPanel: vscode.WebviewPanel;
  let mockController: Controller;

  setup(() => {
    mockPanel = {
      webview: {
        postMessage: async () => {},
        onDidReceiveMessage: (callback) => {
          // Simulate receiving a message
          callback({ type: 'ready' });
        },
        html: '',
      },
      reveal: () => {},
      onDidDispose: (callback) => {
        // Simulate disposal
        callback();
      },
    } as unknown as vscode.WebviewPanel;

    mockController = {
      viewState: () => ({}),
      onDidChange: (callback) => {
        // Simulate controller change
        callback();
      },
      ws: {
        workflow: {
          nodes: [{ id: 'testNode', name: 'Test Node' }],
        },
      },
    } as unknown as Controller;
  });

  test('should create and show the webview panel', () => {
    Orchestrator.show({} as vscode.ExtensionContext, mockController, () => {});
    assert.ok(Orchestrator['current']);
  });

  test('should post messages to the webview', async () => {
    Orchestrator.show({} as vscode.ExtensionContext, mockController, () => {});
    const message = { type: 'test', content: 'Hello' };
    const postSpy = sinon.spy(mockPanel.webview, 'postMessage');
    Orchestrator.post(message);
    assert.ok(postSpy.calledWith(message));
  });

  test('should handle messages from the webview', async () => {
    const handleMessage = sinon.spy();
    Orchestrator.show({} as vscode.ExtensionContext, mockController, handleMessage);
    await mockPanel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'testNode') {
        assert.equal(msg.nodeId, 'testNode');
      }
    });
  });

  test('should dispose the panel correctly', () => {
    Orchestrator.show({} as vscode.ExtensionContext, mockController, () => {});
    Orchestrator['current']?.dispose();
    assert.equal(Orchestrator['current'], undefined);
  });
});
