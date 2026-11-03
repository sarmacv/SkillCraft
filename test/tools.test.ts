import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { registerTools } from '../src/vscode/tools';
import { Controller } from '../src/vscode/controller';

suite('Tools Tests', () => {
  let context: vscode.ExtensionContext;
  let controller: Controller;

  setup(() => {
    context = { subscriptions: [] } as vscode.ExtensionContext;
    controller = { refresh: () => {}, report: null } as unknown as Controller;
  });

  test('registerTools should register skillcraft_validate tool', () => {
    vscode.lm = { registerTool: (name: string, tool: any) => {
      assert.equal(name, 'skillcraft_validate');
      assert.ok(tool.invoke);
      return { dispose: () => {} };
    }};
    registerTools(context, controller);
    assert.equal(context.subscriptions.length, 1);
  });

  test('registerTools should register skillcraft_build tool', () => {
    vscode.lm = { registerTool: (name: string, tool: any) => {
      assert.equal(name, 'skillcraft_build');
      assert.ok(tool.invoke);
      return { dispose: () => {} };
    }};
    registerTools(context, controller);
    assert.equal(context.subscriptions.length, 2);
  });

  test('skillcraft_validate tool invoke should return findings', async () => {
    vscode.lm = { registerTool: () => ({ dispose: () => {} }) };
    controller.report = {
      skillName: 'Test Skill',
      readiness: 'ready',
      efficiencyScore: 90,
      budget: { instructionTokens: 100 },
      findings: [],
    };
    registerTools(context, controller);
    const result = await context.subscriptions[0].invoke();
    assert.ok(result);
    assert.ok(result.parts[0].text.includes('Skill "Test Skill" — readiness: ready, efficiency 90/100'));
  });

  test('skillcraft_build tool invoke should return build result', async () => {
    vscode.lm = { registerTool: () => ({ dispose: () => {} }) };
    controller.root = 'test/root';
    registerTools(context, controller);
    const result = await context.subscriptions[1].invoke();
    assert.ok(result);
    assert.ok(result.parts[0].text.includes('No SkillCraft project (skillcraft.json) in this workspace.'));
  });
});
