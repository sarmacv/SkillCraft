// The orchestrator canvas (webview panel).

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { HostMessage, WebviewMessage } from '../core/messages';
import type { Controller } from './controller';
import { testSource } from './nodeTest';

export class Orchestrator {
  private static current: Orchestrator | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, controller: Controller, handle: (m: WebviewMessage) => void, selectNodeId?: string): void {
    if (Orchestrator.current) {
      Orchestrator.current.panel.reveal(vscode.ViewColumn.One);
    } else {
      const panel = vscode.window.createWebviewPanel('skillcraft.orchestrator', 'SkillCraft Orchestrator', vscode.ViewColumn.One, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'dist', 'webview'))],
      });
      panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'activity.svg'));
      Orchestrator.current = new Orchestrator(panel, context, controller, handle);
    }
    if (selectNodeId) Orchestrator.current.post({ type: 'select', nodeId: selectNodeId });
  }

  static post(m: HostMessage): void {
    Orchestrator.current?.post(m);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly controller: Controller,
    handle: (m: WebviewMessage) => void,
  ) {
    panel.webview.html = this.html(context);
    this.disposables.push(
      controller.onDidChange(() => this.pushState()),
      panel.webview.onDidReceiveMessage(async (m: WebviewMessage) => {
        if (m.type === 'ready') return this.pushState();
        if (m.type === 'testNode') {
          const node = controller.ws?.workflow.nodes.find((n) => n.id === m.nodeId);
          if (node) this.post({ type: 'nodeTestResult', nodeId: node.id, ...(await testSource(node)) });
          return;
        }
        handle(m);
      }),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private post(m: HostMessage): void {
    void this.panel.webview.postMessage(m);
  }

  private pushState(): void {
    this.post({ type: 'state', state: this.controller.viewState() });
  }

  private dispose(): void {
    Orchestrator.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }

  private html(context: vscode.ExtensionContext): string {
    const w = this.panel.webview;
    const asset = (f: string) => w.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'dist', 'webview', f)));
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data:; style-src ${w.cspSource} 'unsafe-inline'; font-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('codicon.css')}">
<link rel="stylesheet" href="${asset('main.css')}">
<title>SkillCraft Orchestrator</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
  }
}
