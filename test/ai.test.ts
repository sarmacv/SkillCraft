import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { getAi, describeAi, chooseModel, setApiKey, extractJson, NO_MODEL_MESSAGE } from '../src/vscode/ai';

suite('AI Module Tests', () => {
  test('describeAi returns the AI client name', async () => {
    const mockClient = { name: 'Test AI' };
    const getAiStub = sinon.stub().returns(Promise.resolve(mockClient));
    sinon.replace(getAi, 'getAi', getAiStub);

    const name = await describeAi();
    assert.equal(name, 'Test AI');
    
    sinon.restore();
  });

  test('chooseModel updates configuration with selected model', async () => {
    const mockModel = { id: 'test-model', name: 'Test Model', vendor: 'Test Vendor', family: 'Test Family' };
    sinon.stub(vscode.lm, 'selectChatModels').returns(Promise.resolve([mockModel]));
    sinon.stub(vscode.window, 'showQuickPick').returns(Promise.resolve({ id: 'test-model' }));
    sinon.stub(vscode.workspace.getConfiguration('skillcraft'), 'update').returns(Promise.resolve());

    await chooseModel();
    
    assert.ok(vscode.workspace.getConfiguration('skillcraft').update.calledWith('model', 'test-model', vscode.ConfigurationTarget.Global));
    
    sinon.restore();
  });

  test('setApiKey stores the API key', async () => {
    const mockKey = 'test-api-key';
    sinon.stub(vscode.window, 'showInputBox').returns(Promise.resolve(mockKey));
    const storeStub = sinon.stub(vscode.SecretStorage.prototype, 'store').returns(Promise.resolve());

    await setApiKey();
    
    assert.ok(storeStub.calledWith('skillcraft.anthropicApiKey', mockKey.trim()));
    
    sinon.restore();
  });

  test('extractJson extracts JSON from text', () => {
    const jsonText = 'Here is some text with a JSON object: ```json { "key": "value" } ``` and more text.';
    const result = extractJson(jsonText);
    assert.deepEqual(result, { key: 'value' });
  });

  test('extractJson returns undefined for invalid JSON', () => {
    const invalidJsonText = 'Here is some text with invalid JSON: ```json { key: value } ```';
    const result = extractJson(invalidJsonText);
    assert.equal(result, undefined);
  });

  test('getAi returns undefined when no model is available', async () => {
    sinon.stub(vscode.workspace.getConfiguration('skillcraft'), 'get').returns('');
    sinon.stub(vscode.lm, 'selectChatModels').throws(new Error('API unavailable'));
    const result = await getAi();
    assert.equal(result, undefined);
  });

  test('NO_MODEL_MESSAGE is correctly defined', () => {
    assert.equal(NO_MODEL_MESSAGE, 'No AI model is available. Sign in to GitHub Copilot (or another VS Code model provider), or run "SkillCraft: Set Anthropic API Key".');
  });
});
