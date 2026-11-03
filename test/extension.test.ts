import * as vscode from 'vscode';
import { activate, deactivate } from '../src/extension';

suite('Extension Tests', () => {
  let context: vscode.ExtensionContext;

  setup(() => {
    context = {
      subscriptions: [],
      // Add any other necessary context properties here
    } as unknown as vscode.ExtensionContext;
    activate(context);
  });

  teardown(() => {
    deactivate();
  });

  test('should activate the extension', () => {
    // Verify that the extension activates correctly
    assert.ok(context.subscriptions.length > 0, 'Extension did not activate properly');
  });

  test('should register commands', () => {
    // Verify that commands are registered
    const commandIds = [
      'skillcraft.describe',
      'skillcraft.sketch',
      'skillcraft.fromTemplate',
      'skillcraft.importSkill',
      'skillcraft.openOrchestrator',
      'skillcraft.analyze',
      'skillcraft.coachReview',
      'skillcraft.syncFiles',
      'skillcraft.build',
      'skillcraft.install',
      'skillcraft.runTests',
      'skillcraft.previewSkillMd',
      'skillcraft.chooseModel',
      'skillcraft.setApiKey',
      'skillcraft.proposal.preview',
      'skillcraft.proposal.accept',
      'skillcraft.proposal.reject',
      'skillcraft.proposal.why',
      'skillcraft.proposal.acceptGroup',
      'skillcraft.undo',
    ];
    commandIds.forEach(id => {
      assert.ok(context.subscriptions.some(sub => typeof sub === 'object' && 'id' in sub && sub.id === id), `Command ${id} not registered`);
    });
  });

  // Add more tests to cover additional functionality and branches
});
