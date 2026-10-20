// Model access. Default: whatever language models the user has in VS Code
// (Copilot or any provider registered with the Language Model API), honoring
// the skillcraft.model setting. Fallback: the user's own Anthropic API key.

import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiClient {
  name: string;
  ask(system: string, turns: ChatTurn[], token?: vscode.CancellationToken, onText?: (chunk: string) => void): Promise<string>;
}

const SECRET_KEY = 'skillcraft.anthropicApiKey';
const FALLBACK_MODEL = 'claude-opus-5-5';

let secrets: vscode.SecretStorage | undefined;
export function initAi(context: vscode.ExtensionContext): void {
  secrets = context.secrets;
}

function lmClient(model: vscode.LanguageModelChat): AiClient {
  return {
    name: `${model.name} (${model.vendor})`,
    async ask(system, turns, token, onText) {
      // The VS Code API has no system role; lead with it as the first user message.
      const messages = [
        vscode.LanguageModelChatMessage.User(system),
        ...turns.map((t) => (t.role === 'user' ? vscode.LanguageModelChatMessage.User(t.content) : vscode.LanguageModelChatMessage.Assistant(t.content))),
      ];
      const response = await model.sendRequest(messages, { justification: 'SkillCraft uses AI to draft and review your skill.' }, token ?? new vscode.CancellationTokenSource().token);
      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
        onText?.(chunk);
      }
      return text;
    },
  };
}

function anthropicClient(apiKey: string): AiClient {
  const client = new Anthropic({ apiKey });
  return {
    name: `Claude Opus 5.5 (your API key)`,
    async ask(system, turns, token, onText) {
      const controller = new AbortController();
      token?.onCancellationRequested(() => controller.abort());
      const response = await client.beta.messages.create(
        {
          model: FALLBACK_MODEL,
          max_tokens: 16000,
          system,
          messages: turns,
          // If a request is declined, the API retries it on a fallback model chosen by refusal category.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: controller.signal },
      );
      if (response.stop_reason === 'refusal') {
        throw new Error('The model declined this request. Try rephrasing it.');
      }
      const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      onText?.(text);
      return text;
    },
  };
}

/** The model chosen for this request: chat request model > setting > first available > API key fallback. */
export async function getAi(preferred?: vscode.LanguageModelChat): Promise<AiClient | undefined> {
  if (preferred) return lmClient(preferred);
  const wanted = vscode.workspace.getConfiguration('skillcraft').get<string>('model', '');
  try {
    const all = await vscode.lm.selectChatModels({});
    const pick = (wanted && all.find((m) => m.id === wanted || m.family === wanted)) || all[0];
    if (pick) return lmClient(pick);
  } catch {
    // Language Model API unavailable (e.g. a VS Code fork) — fall through to the API key.
  }
  const key = await secrets?.get(SECRET_KEY);
  return key ? anthropicClient(key) : undefined;
}

export async function describeAi(): Promise<string | undefined> {
  return (await getAi())?.name;
}

export async function chooseModel(): Promise<void> {
  let models: vscode.LanguageModelChat[] = [];
  try {
    models = await vscode.lm.selectChatModels({});
  } catch {
    /* none */
  }
  const items: (vscode.QuickPickItem & { id?: string; key?: boolean })[] = [
    ...models.map((m) => ({ label: m.name, description: `${m.vendor} · ${m.family}`, id: m.id })),
    { label: '$(key) Use my Anthropic API key instead', key: true },
  ];
  const picked = await vscode.window.showQuickPick(items, { title: 'Model for SkillCraft', placeHolder: models.length ? 'Pick one of the models you have in VS Code' : 'No VS Code models found — use an API key' });
  if (!picked) return;
  if (picked.key) return setApiKey();
  await vscode.workspace.getConfiguration('skillcraft').update('model', picked.id, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`SkillCraft will use ${picked.label}.`);
}

export async function setApiKey(): Promise<void> {
  const key = await vscode.window.showInputBox({ title: 'Anthropic API key', prompt: 'Stored in VS Code secret storage. Used only when no VS Code language model is available.', password: true, ignoreFocusOut: true });
  if (key === undefined) return;
  if (key) await secrets?.store(SECRET_KEY, key.trim());
  else await secrets?.delete(SECRET_KEY);
  vscode.window.showInformationMessage(key ? 'API key saved.' : 'API key removed.');
}

/** Pull the first JSON object or array out of a model reply (tolerates ```json fences). */
export function extractJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.search(/[[{]/);
    if (start === -1) continue;
    for (let end = c.length; end > start; end--) {
      const ch = c[end - 1];
      if (ch !== '}' && ch !== ']') continue;
      try {
        return JSON.parse(c.slice(start, end)) as T;
      } catch {
        /* keep shrinking */
      }
    }
  }
  return undefined;
}

export const NO_MODEL_MESSAGE = 'No AI model is available. Sign in to GitHub Copilot (or another VS Code model provider), or run "SkillCraft: Set Anthropic API Key".';
