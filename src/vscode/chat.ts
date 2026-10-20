// @skillcraft chat participant: conversational creation, review, and help.
// Everything that changes files comes back as a proposal with a Review button.

import * as vscode from 'vscode';
import { CATALOG, getComponent } from '../core/catalog';
import { newProjectProposal } from '../core/proposals';
import { slugify } from '../core/skill';
import type { Proposal, ScriptLanguage, TargetId, Workflow, WorkflowNode } from '../core/types';
import { autoLayout, connect } from '../core/workflow';
import { extractJson, getAi, NO_MODEL_MESSAGE } from './ai';
import { BEST_PRACTICES, coachReview, toProposals } from './coach';
import type { Controller } from './controller';

interface Plan {
  name: string;
  does: string;
  whenToUse: string;
  examples?: string[];
  params?: string[];
  sources?: { type: string; label: string; config?: Record<string, string> }[];
  steps?: { type: string; label: string; config?: Record<string, string> }[];
  outputs?: { type: string; label: string; config?: Record<string, string> }[];
  targets?: TargetId[];
  language?: ScriptLanguage;
}

const COMPONENTS = CATALOG.map((c) => `${c.id}: ${c.summary} (config: ${c.fields.map((f) => f.key).join(', ')})`).join('\n');

const INTERVIEW = `You are SkillCraft, helping someone create an Agent Skill (a SKILL.md folder for Claude Code, OpenAI Codex and GitHub Copilot) through a short, friendly conversation.

Ask ONE question at a time, in plain words, and keep each message short. Cover, in order (skip what you already know):
1. What should the skill do?
2. When should an agent use it — what would a user say?
3. Where does the information come from? (APIs, MCP servers, documents, a knowledge base, databases, files, CLIs…)
4. What should it produce, and where should that go? (reply in chat, a file, Slack/Teams/email, an API…)
5. Which tools is it for: Claude, Codex, Copilot (default: all three)?
6. Which language for scripts: Python, Node.js or Bash? Suggest one that fits.
Offer 2–4 quick example answers when helpful. Never ask for secrets — credentials are environment variables.

${BEST_PRACTICES}

When you have enough to draft the skill (usually after 3–6 answers), say so briefly and finish your message with a fenced block:
\`\`\`skillcraft-plan
{"name": "lowercase-hyphenated", "does": "one sentence", "whenToUse": "when the user …", "examples": ["…"], "params": ["name: description"],
 "sources": [{"type": "<component id>", "label": "…", "config": {}}],
 "steps": [{"type": "module.script|module.ai|module.condition|…", "label": "…", "config": {}}],
 "outputs": [{"type": "<component id>", "label": "…", "config": {}}],
 "targets": ["claude", "codex", "copilot"], "language": "python"}
\`\`\`
Use deterministic module.script steps for fetching/merging data and module.ai steps for judgment. Components:
${COMPONENTS}`;

function planToWorkflow(plan: Plan): Workflow {
  const nodes: WorkflowNode[] = [];
  const edges: Workflow['edges'] = [];
  const mk = (type: string, label: string, config: Record<string, string> = {}, id?: string) => {
    const n: WorkflowNode = { id: id ?? `${type.split('.')[0]}_${slugify(label).replace(/-/g, '_') || nodes.length}_${nodes.length}`, type: getComponent(type) ? type : `placeholder.${type.split('.')[0] || 'module'}`, label, config, position: { x: 0, y: 0 } };
    nodes.push(n);
    return n;
  };
  const trigger = mk('entry.trigger', 'Skill trigger', { does: plan.does, whenToUse: plan.whenToUse, examples: (plan.examples ?? []).join('\n') }, 'trigger');
  let entry = trigger;
  if (plan.params?.length) {
    entry = mk('entry.input', 'Inputs', { params: plan.params.join('\n') }, 'inputs');
    edges.push(connect(trigger.id, entry.id));
  }
  const sources = (plan.sources ?? []).map((s) => mk(s.type, s.label, s.config));
  const steps = (plan.steps ?? []).map((s) => mk(s.type, s.label, s.config));
  const outputs = (plan.outputs?.length ? plan.outputs : [{ type: 'output.return', label: 'Reply in chat' }]).map((s) => mk(s.type, s.label, s.config));
  const firstStep = steps[0];
  const lastStep = steps.at(-1);
  for (const s of sources) {
    edges.push(connect(entry.id, s.id));
    if (firstStep) edges.push(connect(s.id, firstStep.id));
  }
  if (!sources.length && firstStep) edges.push(connect(entry.id, firstStep.id));
  steps.slice(1).forEach((s, i) => edges.push(connect(steps[i].id, s.id)));
  for (const o of outputs) edges.push(connect(lastStep?.id ?? sources[0]?.id ?? entry.id, o.id));
  return autoLayout({ version: 1, nodes, edges });
}

function history(context: vscode.ChatContext): { role: 'user' | 'assistant'; content: string }[] {
  return context.history.map((turn) =>
    turn instanceof vscode.ChatRequestTurn
      ? { role: 'user' as const, content: turn.prompt }
      : { role: 'assistant' as const, content: (turn as vscode.ChatResponseTurn).response.map((r) => (r instanceof vscode.ChatResponseMarkdownPart ? r.value.value : '')).join('') },
  );
}

/** Streams markdown but holds back everything from a machine-readable marker block onward. */
function guarded(stream: vscode.ChatResponseStream, marker: string) {
  let buf = '';
  let sent = 0;
  return {
    push(chunk: string) {
      buf += chunk;
      const idx = buf.indexOf(marker);
      const limit = idx === -1 ? Math.max(sent, buf.length - marker.length) : idx;
      if (limit > sent) {
        stream.markdown(buf.slice(sent, limit));
        sent = limit;
      }
    },
    flush() {
      if (buf.indexOf(marker) === -1 && sent < buf.length) stream.markdown(buf.slice(sent));
      sent = buf.length;
    },
  };
}

function offerReview(stream: vscode.ChatResponseStream, controller: Controller, proposals: Proposal[]): void {
  for (const p of proposals) {
    controller.addProposal(p);
    stream.button({ command: 'skillcraft.proposal.preview', title: `Review: ${p.title}`, arguments: [p.key] });
  }
}

export function registerChat(context: vscode.ExtensionContext, controller: Controller): void {
  const participant = vscode.chat.createChatParticipant('skillcraft.chat', async (request, chatContext, stream, token) => {
    const ai = await getAi((request as { model?: vscode.LanguageModelChat }).model);
    if (!ai) {
      stream.markdown(NO_MODEL_MESSAGE);
      return;
    }
    controller.modelName = ai.name;
    const cmd = request.command;

    if (cmd === 'review') {
      stream.progress('Reviewing your skill…');
      await coachReview(controller);
      stream.markdown(controller.coach.length ? `The coach has **${controller.coach.length} questions** for you:\n\n${controller.coach.map((q) => `- ${q.question}`).join('\n')}\n\nAnswer them here or in the orchestrator's Coach tab.` : 'No open questions — your skill looks solid.');
      stream.button({ command: 'skillcraft.openOrchestrator', title: 'Open Orchestrator' });
      return;
    }
    if (cmd === 'build') {
      await vscode.commands.executeCommand('skillcraft.build');
      stream.markdown('Build started — see the notification for results.');
      return;
    }

    if (cmd === 'new' || (!controller.ws && !cmd)) {
      const out = guarded(stream, '```skillcraft-plan');
      const text = await ai.ask(INTERVIEW, [...history(chatContext), { role: 'user', content: request.prompt || 'I want to create a new skill.' }], token, (chunk) => out.push(chunk));
      out.flush();
      const planText = text.match(/```skillcraft-plan\s*([\s\S]*?)```/)?.[1];
      const plan = planText ? extractJson<Plan>(planText) : undefined;
      if (plan?.name && plan.does) {
        const name = slugify(plan.name) || 'my-skill';
        const workflow = planToWorkflow(plan);
        const targets = (plan.targets ?? ['claude', 'codex', 'copilot']).filter((t): t is TargetId => ['claude', 'codex', 'copilot'].includes(t));
        const language = (['python', 'node', 'bash'] as ScriptLanguage[]).includes(plan.language as ScriptLanguage) ? (plan.language as ScriptLanguage) : 'python';
        let proposal: Proposal;
        if (!controller.ws) {
          proposal = newProjectProposal({ name, description: `${plan.does} Use when ${plan.whenToUse}`, language, targets: targets.length ? targets : ['claude'], workflow, source: 'chat' });
        } else {
          proposal = { key: `chat:workflow:${name}:${Date.now()}`, title: `Add the drafted workflow (${workflow.nodes.length} components)`, why: 'Drafted from our conversation.', priority: 'recommended', source: 'chat', changes: [], workflow: { addNodes: workflow.nodes.filter((n) => !controller.ws!.workflow.nodes.some((x) => x.id === n.id)), addEdges: workflow.edges } };
        }
        stream.markdown(`\n\n**Here's the draft:** ${workflow.nodes.length} components — ${workflow.nodes.map((n) => n.label).join(' → ')}. Nothing is created until you review it.`);
        offerReview(stream, controller, [proposal]);
        stream.button({ command: 'skillcraft.openOrchestrator', title: 'Open Orchestrator' });
      }
      return;
    }

    // /add, /explain and free-form questions: answer with full skill context; changes come back as proposals.
    const skillContext = `SKILL.md:\n${controller.skill?.rawSkillMd?.slice(0, 10000) ?? '(none)'}\n\nWorkflow nodes:\n${controller.ws?.workflow.nodes.map((n) => `- [${n.id}] ${n.type} "${n.label}"`).join('\n') ?? '(none)'}\n\nCheck findings:\n${controller.report?.findings.map((f) => `- (${f.severity}) ${f.message}`).join('\n') ?? '(none)'}`;
    const ask =
      cmd === 'add'
        ? `Add this to the workflow: ${request.prompt}\nReply with one short sentence, then a fenced \`\`\`skillcraft-proposals block containing JSON {"proposals":[{"kind":"addNode","title":"…","why":"…","type":"<component id>","label":"…","config":{},"after":"<node id>","before":"<node id or omit>"}]}. Components:\n${COMPONENTS}`
        : `${request.prompt}\n\nAnswer helpfully and briefly. If you recommend concrete changes, end with a fenced \`\`\`skillcraft-proposals block with JSON {"proposals":[…]} using kinds description, instructions, addNode, updateNode or test.`;
    const out = guarded(stream, '```skillcraft-proposals');
    const text = await ai.ask(`You are SkillCraft, an expert on Agent Skills.\n${BEST_PRACTICES}\n\n${skillContext}`, [...history(chatContext), { role: 'user', content: ask }], token, (chunk) => out.push(chunk));
    out.flush();
    const block = text.match(/```skillcraft-proposals\s*([\s\S]*?)```/)?.[1];
    if (block) {
      const proposals = toProposals(controller, extractJson(block) ?? {}, 'chat');
      if (proposals.length) {
        stream.markdown('\n\nProposed changes (nothing changes until you accept):');
        offerReview(stream, controller, proposals);
      }
    }
  });
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
  participant.followupProvider = {
    provideFollowups: () =>
      controller.ws
        ? [
            { prompt: 'Review my skill', command: 'review', label: 'Review my skill' },
            { prompt: 'How can I make this skill cheaper on context?', label: 'Make it leaner' },
          ]
        : [{ prompt: 'Help me create a new skill', command: 'new', label: 'Create a new skill' }],
  };
  context.subscriptions.push(participant);
}
