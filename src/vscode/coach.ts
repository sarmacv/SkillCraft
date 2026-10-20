// The AI coach: reviews the skill, asks focused questions, and turns answers
// into proposals. It never edits anything itself.

import * as vscode from 'vscode';
import { CATALOG, getComponent } from '../core/catalog';
import type { CoachQuestion } from '../core/messages';
import { joinFrontmatter } from '../core/skill';
import type { Proposal, WorkflowChange, WorkflowNode } from '../core/types';
import { connect, newId } from '../core/workflow';
import { extractJson, getAi, NO_MODEL_MESSAGE } from './ai';
import type { Controller } from './controller';

export const BEST_PRACTICES = `Agent Skills best practices you apply:
- The description says what the skill does AND when to use it, in the words users actually say. Max 1024 characters. It is the only thing agents see before deciding to load the skill.
- SKILL.md stays under ~500 lines / ~5000 tokens. Detail goes to references/ files linked from SKILL.md with "read X when Y". References are one level deep.
- Deterministic, repeatable work (API calls, parsing, merging, formatting data) belongs in scripts/; judgment (choosing, summarizing, writing) belongs in instructions.
- Scripts read credentials from environment variables, never hardcode them, handle errors with clear messages, and return compact output, not raw dumps.
- Instructions are concise imperative steps. Don't explain things the model already knows.
- Cover the unhappy path: missing inputs, empty results, failing APIs, missing credentials or MCP servers.
- Skills should be portable across Claude Code, OpenAI Codex and GitHub Copilot unless a per-tool override is intended.
- Include realistic test prompts: some that should trigger the skill, some that should not.`;

interface CoachReply {
  questions?: { area: string; question: string; why?: string; options?: string[]; suggestion?: string }[];
  proposals?: CoachProposal[];
}

type CoachProposal =
  | { kind: 'description'; title?: string; why: string; does: string; whenToUse: string; examples?: string[] }
  | { kind: 'instructions'; title: string; why: string; markdown: string }
  | { kind: 'addNode'; title: string; why: string; type: string; label: string; config?: Record<string, string>; after?: string; before?: string }
  | { kind: 'updateNode'; title: string; why: string; nodeId: string; label?: string; config?: Record<string, string> }
  | { kind: 'test'; title: string; why: string; prompt: string; shouldTrigger: boolean; expect?: string[] };

function context(controller: Controller): string {
  const s = controller.skill;
  const ws = controller.ws;
  const files = s?.files.map((f) => `${f.rel} (${f.size} bytes)`).join('\n') ?? '(no skill yet)';
  const nodes = ws?.workflow.nodes.map((n) => `- [${n.id}] ${n.type} "${n.label}" ${JSON.stringify(n.config)}`).join('\n') ?? '';
  const edges = ws?.workflow.edges.map((e) => `${e.source} -> ${e.target}`).join(', ') ?? '';
  const findings = controller.report?.findings.map((f) => `- (${f.severity}) ${f.message}`).join('\n') ?? '';
  const tests = ws?.tests.map((t) => `- ${t.shouldTrigger ? 'SHOULD' : 'should NOT'} trigger: ${t.prompt}`).join('\n') ?? '';
  return `## Project
Name: ${ws?.config.name ?? s?.folderName ?? 'unknown'} · targets: ${ws?.config.targets.join(', ') ?? 'unknown'} · script language: ${ws?.config.language ?? 'unknown'}

## SKILL.md
${(s?.rawSkillMd ?? '(missing)').slice(0, 12000)}

## Files
${files}

## Workflow (orchestration graph)
${nodes || '(empty)'}
Edges: ${edges || '(none)'}

## Automatic check findings
${findings || '(none)'}

## Test cases
${tests || '(none)'}`;
}

const SCHEMA = `Reply with ONLY a JSON object:
{
  "questions": [ { "area": "Clarity|Completeness|Robustness|Correctness|Best practice|Portability|Testing", "question": "...", "why": "one short sentence", "options": ["short answer", "..."], "suggestion": "what you'd pick by default" } ],
  "proposals": [
    { "kind": "description", "why": "...", "does": "What the skill does, one sentence.", "whenToUse": "when the user ..., or mentions ...", "examples": ["realistic request"] },
    { "kind": "instructions", "title": "...", "why": "...", "markdown": "a section to append to SKILL.md, starting with ## heading" },
    { "kind": "addNode", "title": "...", "why": "...", "type": "<component id>", "label": "...", "config": {"key": "value"}, "after": "<existing node id>", "before": "<existing node id or omit>" },
    { "kind": "updateNode", "title": "...", "why": "...", "nodeId": "<id>", "label": "...", "config": {"key": "value"} },
    { "kind": "test", "title": "...", "why": "...", "prompt": "...", "shouldTrigger": true, "expect": ["phrase"] }
  ]
}
Component ids you may use: ${CATALOG.map((c) => `${c.id} (${c.fields.map((f) => f.key).join(', ')})`).join('; ')}.`;

const SYSTEM = `You are SkillCraft's coach. You help people of every skill level build excellent Agent Skills (SKILL.md folders used by Claude Code, OpenAI Codex and GitHub Copilot).
${BEST_PRACTICES}
Be warm, specific and brief. Plain words, no jargon. Never invent facts about the user's systems — ask instead. Only propose changes you are confident improve the skill.`;

export function toProposals(controller: Controller, reply: CoachReply, source: Proposal['source'] = 'coach'): Proposal[] {
  const out: Proposal[] = [];
  const ws = controller.ws;
  const skill = controller.skill;
  const skillMdPath = ws ? `${ws.config.skillPath}/SKILL.md` : undefined;
  for (const p of reply.proposals ?? []) {
    try {
      if (p.kind === 'description' && p.does && p.whenToUse) {
        const desc = `${p.does.trim().replace(/\.?$/, '.')} Use when ${p.whenToUse.trim().replace(/^use (this skill )?when\s+/i, '').replace(/\.$/, '')}.`.slice(0, 1024);
        const fm = skill?.skillMd?.frontmatter;
        const trigger = ws?.workflow.nodes.find((n) => n.type === 'entry.trigger');
        const workflow: WorkflowChange | undefined = ws
          ? trigger
            ? { updateNodes: [{ id: trigger.id, config: { ...trigger.config, does: p.does, whenToUse: p.whenToUse, ...(p.examples?.length ? { examples: p.examples.join('\n') } : {}) } }] }
            : { addNodes: [{ id: 'trigger', type: 'entry.trigger', label: 'Skill trigger', config: { does: p.does, whenToUse: p.whenToUse, examples: (p.examples ?? []).join('\n') }, position: { x: 0, y: 0 } }] }
          : undefined;
        out.push({
          key: `${source}:description:${desc.length}:${desc.slice(0, 40)}`,
          title: 'Rewrite the description',
          why: `${p.why}\n\nNew: "${desc}"`,
          impact: 'Agents decide whether to load your skill from this text alone.',
          priority: 'recommended',
          source,
          changes: fm && skillMdPath ? [{ kind: 'modify', path: skillMdPath, content: joinFrontmatter({ ...fm, description: desc }, skill!.skillMd!.body) }] : [],
          workflow,
        });
      } else if (p.kind === 'instructions' && p.markdown && skillMdPath && skill?.rawSkillMd) {
        out.push({ key: `${source}:instr:${p.title}`, title: p.title, why: p.why, priority: 'optional', source, changes: [{ kind: 'modify', path: skillMdPath, content: `${skill.rawSkillMd.trimEnd()}\n\n${p.markdown.trim()}\n` }] });
      } else if (p.kind === 'addNode' && ws && getComponent(p.type)) {
        const node: WorkflowNode = { id: newId('n'), type: p.type, label: p.label, config: p.config ?? {}, position: { x: 0, y: 0 } };
        const after = ws.workflow.nodes.find((n) => n.id === p.after);
        const before = ws.workflow.nodes.find((n) => n.id === p.before);
        if (after) node.position = { x: after.position.x + 140, y: after.position.y + 110 };
        out.push({
          key: `${source}:add:${p.type}:${p.label}`,
          title: p.title,
          why: p.why,
          priority: 'recommended',
          source,
          changes: [],
          workflow: { addNodes: [node], addEdges: [...(after ? [connect(after.id, node.id)] : []), ...(before ? [connect(node.id, before.id)] : [])] },
        });
      } else if (p.kind === 'updateNode' && ws?.workflow.nodes.some((n) => n.id === p.nodeId)) {
        const n = ws.workflow.nodes.find((x) => x.id === p.nodeId)!;
        out.push({ key: `${source}:update:${p.nodeId}:${p.title}`, title: p.title, why: p.why, priority: 'recommended', source, changes: [], workflow: { updateNodes: [{ id: n.id, ...(p.label ? { label: p.label } : {}), config: { ...n.config, ...(p.config ?? {}) } }] } });
      } else if (p.kind === 'test' && ws && controller.root && p.prompt) {
        const cases = [...ws.tests, { id: `case-${ws.tests.length + 1}`, prompt: p.prompt, shouldTrigger: !!p.shouldTrigger, ...(p.expect?.length ? { expect: p.expect } : {}) }];
        out.push({ key: `${source}:test:${p.prompt.slice(0, 40)}`, title: p.title || 'Add a test case', why: p.why, priority: 'optional', source, changes: [{ kind: 'modify', path: 'tests/cases.json', content: JSON.stringify(cases, null, 2) + '\n' }] });
      }
    } catch {
      /* skip malformed suggestion */
    }
  }
  return out;
}

export async function coachReview(controller: Controller): Promise<void> {
  if (!controller.skill && !controller.ws) {
    void vscode.window.showInformationMessage('Create or import a skill first, then the coach can review it.');
    return;
  }
  const ai = await getAi();
  if (!ai) {
    void vscode.window.showWarningMessage(NO_MODEL_MESSAGE, 'Choose model').then((c) => c && vscode.commands.executeCommand('skillcraft.chooseModel'));
    return;
  }
  controller.coachBusy = true;
  controller.modelName = ai.name;
  controller.refresh();
  try {
    const text = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'SkillCraft coach is reviewing your skill…', cancellable: true }, (_, token) =>
      ai.ask(SYSTEM, [{ role: 'user', content: `${context(controller)}\n\nReview this skill. Ask at most 5 questions, most important first, only where the answer would change the skill. Propose concrete improvements you're confident about (always include a description proposal if the current one is weak).\n\n${SCHEMA}` }], token),
    );
    const reply = extractJson<CoachReply>(text);
    if (!reply) throw new Error('The model reply could not be read. Try again.');
    controller.coach = (reply.questions ?? []).slice(0, 5).map((q, i) => ({ id: `q${Date.now()}_${i}`, ...q }));
    const proposals = toProposals(controller, reply);
    proposals.forEach((p) => controller.addProposal(p));
    void vscode.window.showInformationMessage(`Coach: ${controller.coach.length} question${controller.coach.length === 1 ? '' : 's'}, ${proposals.length} proposal${proposals.length === 1 ? '' : 's'}.`, 'Open Orchestrator').then((c) => c && vscode.commands.executeCommand('skillcraft.openOrchestrator'));
  } catch (e) {
    if (!(e instanceof vscode.CancellationError)) void vscode.window.showErrorMessage(`Coach review failed: ${(e as Error).message}`);
  } finally {
    controller.coachBusy = false;
    controller.refresh();
  }
}

export async function coachAnswer(controller: Controller, id: string, answer: { text?: string; decide?: boolean; skip?: boolean }): Promise<void> {
  const q: CoachQuestion | undefined = controller.coach.find((x) => x.id === id);
  if (!q) return;
  controller.coach = controller.coach.filter((x) => x.id !== id);
  if (answer.skip) {
    controller.refresh();
    return;
  }
  const ai = await getAi();
  if (!ai) {
    void vscode.window.showWarningMessage(NO_MODEL_MESSAGE);
    return;
  }
  controller.coachBusy = true;
  controller.refresh();
  try {
    const reply = answer.decide
      ? `I don't mind — pick a sensible default${q.suggestion ? ` (you suggested: ${q.suggestion})` : ''} and tell me what you chose in the "why".`
      : answer.text ?? '';
    const text = await ai.ask(SYSTEM, [
      { role: 'user', content: `${context(controller)}\n\nYou asked: "${q.question}"\nMy answer: ${reply}\n\nTurn this into concrete proposals (workflow nodes, instructions, description or tests). Ask a follow-up question only if truly needed.\n\n${SCHEMA}` },
    ]);
    const parsed = extractJson<CoachReply>(text);
    if (!parsed) throw new Error('The model reply could not be read.');
    const proposals = toProposals(controller, parsed);
    proposals.forEach((p) => controller.addProposal(p));
    controller.coach = [...controller.coach, ...(parsed.questions ?? []).slice(0, 2).map((x, i) => ({ id: `q${Date.now()}_${i}`, ...x }))];
    if (proposals.length) void vscode.window.showInformationMessage(`Coach proposed ${proposals.length} change${proposals.length === 1 ? '' : 's'} — review them in Proposals or on the canvas.`);
  } catch (e) {
    void vscode.window.showErrorMessage(`Coach couldn't process that: ${(e as Error).message}`);
  } finally {
    controller.coachBusy = false;
    controller.refresh();
  }
}
