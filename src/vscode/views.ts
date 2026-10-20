// Sidebar tree views: Skills, Health and Proposals.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { PROFILES } from '../core/profiles';
import { PRIORITY_LABEL, PRIORITY_ORDER } from '../core/proposals';
import type { Finding, Proposal, ProposalPriority, TargetId } from '../core/types';
import type { Controller } from './controller';

type Item = vscode.TreeItem & { children?: Item[] };

function item(label: string, opts: Partial<vscode.TreeItem> & { children?: Item[] } = {}): Item {
  const t = new vscode.TreeItem(label, opts.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None) as Item;
  Object.assign(t, opts);
  return t;
}

abstract class Tree implements vscode.TreeDataProvider<Item> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(protected readonly controller: Controller) {
    controller.onDidChange(() => this.emitter.fire());
  }
  getTreeItem(e: Item): vscode.TreeItem {
    return e;
  }
  getChildren(e?: Item): Item[] {
    return e ? e.children ?? [] : this.roots();
  }
  protected abstract roots(): Item[];
}

const READINESS_LABEL = { draft: 'Draft', runnable: 'Runnable', tested: 'Tested', ready: 'Ready to ship' } as const;

export class SkillsTree extends Tree {
  protected roots(): Item[] {
    const c = this.controller;
    if (!c.root) return [];
    if (!c.ws) {
      if (!c.detected.length) return [];
      return [
        item(`Found ${c.detected.length} existing skill${c.detected.length > 1 ? 's' : ''}`, {
          iconPath: new vscode.ThemeIcon('search'),
          children: c.detected.map((d) =>
            item(d.name, {
              description: d.formats.length ? d.formats.map((f) => PROFILES[f].displayName).join(', ') : d.rel,
              tooltip: `${d.rel}\n${d.description}`,
              iconPath: new vscode.ThemeIcon('symbol-misc'),
              command: { command: 'skillcraft.importSkill', title: 'Analyze', arguments: [d.dir] },
            }),
          ),
        }),
      ];
    }
    const ws = c.ws;
    const skillAbs = path.join(c.root, ws.config.skillPath);
    const fileItem = (rel: string): Item =>
      item(path.basename(rel), {
        resourceUri: vscode.Uri.file(path.join(skillAbs, rel)),
        command: { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.join(skillAbs, rel))] },
        description: rel.includes('/') ? path.dirname(rel) : undefined,
      });
    const files = c.skill?.files.map((f) => f.rel).sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b))) ?? [];
    const r = c.report;
    const builds = ws.config.targets.filter((t) => fs.existsSync(path.join(c.root!, 'dist', ws.config.buildMode === 'universal' ? 'universal' : t)));
    return [
      item(ws.config.name, {
        description: r ? READINESS_LABEL[r.readiness] : undefined,
        tooltip: String(c.skill?.skillMd?.frontmatter?.description ?? ''),
        iconPath: new vscode.ThemeIcon('package'),
        children: files.map(fileItem),
      }),
      item('Workflow', { description: `${ws.workflow.nodes.length} components`, iconPath: new vscode.ThemeIcon('type-hierarchy'), command: { command: 'skillcraft.openOrchestrator', title: 'Open' } }),
      item('Tests', {
        description: `${ws.tests.length} cases`,
        iconPath: new vscode.ThemeIcon('beaker'),
        command: { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.join(c.root, 'tests/cases.json'))] },
      }),
      item('Builds', {
        description: builds.length ? builds.map((t) => PROFILES[t].displayName).join(', ') : 'not built yet',
        iconPath: new vscode.ThemeIcon('archive'),
        children: builds.map((t) => {
          const dir = path.join(c.root!, 'dist', ws.config.buildMode === 'universal' ? 'universal' : t);
          return item(PROFILES[t].displayName, {
            description: 'SETUP.md',
            iconPath: new vscode.ThemeIcon('book'),
            command: { command: 'markdown.showPreview', title: 'Open', arguments: [vscode.Uri.file(path.join(dir, 'SETUP.md'))] },
          });
        }),
      }),
    ];
  }
}

function findingItem(c: Controller, f: Finding): Item {
  const icon = f.severity === 'error' ? new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground')) : f.severity === 'warning' ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground')) : new vscode.ThemeIcon('info', new vscode.ThemeColor('problemsInfoIcon.foreground'));
  const command: vscode.Command | undefined = f.proposalKey
    ? { command: 'skillcraft.proposal.preview', title: 'Review fix', arguments: [f.proposalKey] }
    : f.nodeId
      ? { command: 'skillcraft.openOrchestrator', title: 'Show', arguments: [f.nodeId] }
      : f.file && c.root
        ? { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(path.join(c.root, f.file)), { selection: new vscode.Range((f.line ?? 1) - 1, 0, (f.line ?? 1) - 1, 0) }] }
        : undefined;
  return item(f.message, { iconPath: icon, tooltip: f.message, description: f.proposalKey ? 'fix available' : undefined, command });
}

export class HealthTree extends Tree {
  protected roots(): Item[] {
    const c = this.controller;
    const r = c.report;
    if (!r) return [];
    const b = r.budget;
    const refs = b.references.reduce((s, x) => s + x.tokens, 0);
    const areas: Finding['area'][] = ['structure', 'integrity', 'workflow', 'efficiency', 'portability', 'docs'];
    const label = (a: string) => a[0].toUpperCase() + a.slice(1);
    const targets: TargetId[] = c.ws?.config.targets ?? [];
    return [
      item(`Readiness: ${READINESS_LABEL[r.readiness]}`, {
        iconPath: new vscode.ThemeIcon(r.readiness === 'ready' ? 'rocket' : 'milestone'),
        children: r.readinessChecklist.map((x) => item(x.label, { iconPath: new vscode.ThemeIcon(x.done ? 'pass-filled' : 'circle-large-outline') })),
      }),
      item(`Efficiency ${r.efficiencyScore}/100`, {
        iconPath: new vscode.ThemeIcon('dashboard'),
        children: [
          item(`Always loaded ~${b.metadataTokens} tokens`, { iconPath: new vscode.ThemeIcon('eye'), tooltip: 'Name and description — loaded for every conversation' }),
          item(`When triggered ~${b.instructionTokens.toLocaleString()} tokens`, { iconPath: new vscode.ThemeIcon(b.instructionTokens > 5000 ? 'warning' : 'zap'), tooltip: 'SKILL.md body — loaded each time the skill is used' }),
          item(`On demand ~${refs.toLocaleString()} tokens`, { iconPath: new vscode.ThemeIcon('book'), tooltip: b.references.map((x) => `${x.path}: ~${x.tokens}`).join('\n') || 'No reference files' }),
        ],
      }),
      ...(targets.length
        ? [item('Portability', { iconPath: new vscode.ThemeIcon('globe'), children: targets.map((t) => item(PROFILES[t].displayName, { description: r.portability[t], iconPath: new vscode.ThemeIcon(r.portability[t] === 'ok' ? 'pass' : r.portability[t] === 'warn' ? 'warning' : 'error') })) })]
        : []),
      ...areas
        .map((a) => ({ a, list: r.findings.filter((f) => f.area === a) }))
        .filter((x) => x.list.length)
        .map(({ a, list }) => {
          const worst = list.some((f) => f.severity === 'error') ? 'error' : list.some((f) => f.severity === 'warning') ? 'warning' : 'info';
          const t = item(label(a), { description: `${list.length}`, iconPath: new vscode.ThemeIcon(worst), children: list.map((f) => findingItem(c, f)) });
          t.collapsibleState = worst === 'info' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded;
          return t;
        }),
    ];
  }
}

export class ProposalsTree extends Tree {
  protected roots(): Item[] {
    const all = this.controller.proposals;
    return PRIORITY_ORDER.map((pr: ProposalPriority) => ({ pr, list: all.filter((p) => p.priority === pr) }))
      .filter((g) => g.list.length)
      .map(({ pr, list }) =>
        item(PRIORITY_LABEL[pr], {
          contextValue: 'proposalGroup',
          id: `group:${pr}`,
          description: `${list.length}`,
          iconPath: new vscode.ThemeIcon(pr === 'critical' ? 'flame' : pr === 'recommended' ? 'lightbulb' : 'sparkle'),
          children: list.map((p: Proposal) =>
            item(p.title, {
              id: p.key,
              contextValue: 'proposal',
              description: p.source === 'coach' ? 'coach' : p.source === 'chat' ? 'chat' : undefined,
              tooltip: new vscode.MarkdownString(`**${p.title}**\n\n${p.why}${p.impact ? `\n\n_${p.impact}_` : ''}`),
              iconPath: new vscode.ThemeIcon(p.workflow ? 'type-hierarchy-sub' : p.changes.some((x) => x.kind === 'rename') ? 'move' : 'diff'),
              command: { command: 'skillcraft.proposal.preview', title: 'Preview', arguments: [p.key] },
            }),
          ),
        }),
      );
  }
}
