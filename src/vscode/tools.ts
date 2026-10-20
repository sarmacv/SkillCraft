// Language model tools, so Copilot agent mode (and any agent using VS Code tools)
// can validate and build the skill on its own.

import * as vscode from 'vscode';
import { build } from '../core/build';
import { loadWorkspace } from '../core/project';
import type { Controller } from './controller';

export function registerTools(context: vscode.ExtensionContext, controller: Controller): void {
  if (!vscode.lm?.registerTool) return;
  context.subscriptions.push(
    vscode.lm.registerTool('skillcraft_validate', {
      async invoke() {
        controller.refresh();
        const r = controller.report;
        const text = r
          ? `Skill "${r.skillName}" — readiness: ${r.readiness}, efficiency ${r.efficiencyScore}/100, ~${r.budget.instructionTokens} tokens when triggered.\n` +
            (r.findings.length ? r.findings.map((f) => `- [${f.severity}] ${f.area}: ${f.message}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''}`).join('\n') : 'No findings.')
          : 'No skill found in this workspace.';
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
      },
    }),
    vscode.lm.registerTool('skillcraft_build', {
      async prepareInvocation() {
        return { invocationMessage: 'Building the skill for its target tools', confirmationMessages: { title: 'Build skill', message: 'Rebuild dist/ for every target tool? This replaces the previous build output.' } };
      },
      async invoke() {
        const ws = controller.root ? loadWorkspace(controller.root) : undefined;
        if (!ws) return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('No SkillCraft project (skillcraft.json) in this workspace.')]);
        const result = build(ws);
        controller.refresh();
        const text = result.ok
          ? `Built into ${result.outDir}:\n${result.builds.map((b) => `- ${b.target}: ${b.files.length} files${b.warnings.length ? `; notes: ${b.warnings.join('; ')}` : ''}`).join('\n')}`
          : `Build failed: ${result.errors.join(' ')}`;
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
      },
    }),
  );
}
