// Reviewing proposals: side-by-side diffs before anything is written.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { contentAfter, touchedFiles } from '../core/proposals';
import type { Proposal } from '../core/types';
import type { Controller } from './controller';

const BEFORE = 'skillcraft-before';
const AFTER = 'skillcraft-after';

export function registerReview(context: vscode.ExtensionContext, controller: Controller): void {
  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) {
      const params = new URLSearchParams(uri.query);
      const file = params.get('file') ?? '';
      if (!controller.root) return '';
      if (uri.scheme === BEFORE) {
        try {
          return fs.readFileSync(path.join(controller.root, file), 'utf8');
        } catch {
          return '';
        }
      }
      const p = controller.getProposal(params.get('key') ?? '');
      return p ? contentAfter(controller.root, p, file) ?? '' : '';
    },
  };
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(BEFORE, provider),
    vscode.workspace.registerTextDocumentContentProvider(AFTER, provider),
  );
}

function uris(p: Proposal, file: string): [vscode.Uri, vscode.Uri] {
  const q = new URLSearchParams({ key: p.key, file }).toString();
  const name = `/${file}`;
  return [vscode.Uri.from({ scheme: BEFORE, path: name, query: q }), vscode.Uri.from({ scheme: AFTER, path: name, query: q })];
}

/** Open the diff(s) for a proposal, then offer Accept / Reject. */
export async function previewProposal(controller: Controller, key: string, ask = true): Promise<void> {
  const p = controller.getProposal(key);
  if (!p || !controller.root) {
    void vscode.window.showInformationMessage('That suggestion no longer applies.');
    return;
  }
  const files = touchedFiles(p).filter((f) => !p.changes.some((c) => c.kind === 'rename' && c.path === f));
  if (files.length === 1) {
    const [a, b] = uris(p, files[0]);
    await vscode.commands.executeCommand('vscode.diff', a, b, `${p.title} — ${files[0]}`, { preview: true });
  } else if (files.length > 1) {
    const resources = files.map((f) => {
      const [a, b] = uris(p, f);
      return [vscode.Uri.file(path.join(controller.root!, f)), a, b];
    });
    await vscode.commands.executeCommand('vscode.changes', p.title, resources);
  }
  if (!ask) return;
  const renames = p.changes.filter((c) => c.kind === 'rename').map((c) => (c.kind === 'rename' ? `${c.path} → ${c.newPath}` : ''));
  const detail = [p.why, p.impact, renames.length ? `Moves: ${renames.join(', ')}` : '', `${p.changes.length} change${p.changes.length === 1 ? '' : 's'}: ${touchedFiles(p).join(', ')}`].filter(Boolean).join('\n\n');
  const choice = await vscode.window.showInformationMessage(p.title, { modal: true, detail }, 'Accept', 'Reject');
  if (choice === 'Accept') await acceptProposal(controller, key);
  else if (choice === 'Reject') await rejectProposal(controller, key);
}

export async function acceptProposal(controller: Controller, key: string): Promise<boolean> {
  const p = controller.getProposal(key);
  if (!p) return false;
  const ok = controller.accept(key);
  if (ok) {
    const action = await vscode.window.showInformationMessage(`Applied: ${p.title}`, 'Undo');
    if (action === 'Undo') controller.undo();
  }
  return ok;
}

export async function rejectProposal(controller: Controller, key: string): Promise<void> {
  const p = controller.getProposal(key);
  if (!p) return;
  const reason = p.source === 'sync' ? undefined : await vscode.window.showInputBox({ title: `Reject "${p.title}"`, prompt: 'Optional: why? SkillCraft won\'t suggest this again.', placeHolder: 'e.g. this file is intentional' });
  // Escape on the reason box still rejects, just without a reason.
  controller.reject(key, reason || undefined);
}
