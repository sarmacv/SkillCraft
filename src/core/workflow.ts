// Graph helpers shared by the extension host and the webview (browser-safe).

import { categoryOf } from './catalog';
import type { Category, Workflow, WorkflowChange, WorkflowNode } from './types';

const CATEGORY_RANK: Record<Category, number> = { entry: 0, source: 1, module: 2, output: 3 };

let counter = 0;
export function newId(prefix = 'n'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Nodes in dependency order (Kahn), ties broken by category then label. Cycles are appended at the end. */
export function topoOrder(wf: Workflow): WorkflowNode[] {
  const indeg = new Map(wf.nodes.map((n) => [n.id, 0]));
  for (const e of wf.edges) if (indeg.has(e.target) && indeg.has(e.source)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const rank = (n: WorkflowNode) => CATEGORY_RANK[categoryOf(n.type)];
  const ready = wf.nodes.filter((n) => indeg.get(n.id) === 0);
  const out: WorkflowNode[] = [];
  while (ready.length) {
    ready.sort((a, b) => rank(a) - rank(b) || a.position.y - b.position.y);
    const n = ready.shift()!;
    out.push(n);
    for (const e of wf.edges.filter((x) => x.source === n.id)) {
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0 && byId.has(e.target)) ready.push(byId.get(e.target)!);
    }
  }
  for (const n of wf.nodes) if (!out.includes(n)) out.push(n);
  return out;
}

/** Layered left-to-right layout: column = longest path from a root, nudged so categories read left to right. */
export function autoLayout(wf: Workflow): Workflow {
  const depth = new Map<string, number>();
  for (const n of topoOrder(wf)) {
    const parents = wf.edges.filter((e) => e.target === n.id).map((e) => depth.get(e.source) ?? 0);
    const fromParents = parents.length ? Math.max(...parents) + 1 : 0;
    depth.set(n.id, Math.max(fromParents, CATEGORY_RANK[categoryOf(n.type)] === 0 ? 0 : 1));
  }
  const columns = new Map<number, WorkflowNode[]>();
  for (const n of wf.nodes) {
    const d = depth.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const COL_W = 280;
  const ROW_H = 120;
  const tallest = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const nodes = wf.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const col = columns.get(d)!;
    const i = col.indexOf(n);
    const offset = ((tallest - col.length) * ROW_H) / 2;
    return { ...n, position: { x: d * COL_W, y: offset + i * ROW_H } };
  });
  return { ...wf, nodes };
}

export function applyWorkflowChange(wf: Workflow, change: WorkflowChange): Workflow {
  const remove = new Set(change.removeNodeIds ?? []);
  const removeEdges = new Set(change.removeEdgeIds ?? []);
  let nodes = wf.nodes.filter((n) => !remove.has(n.id));
  for (const u of change.updateNodes ?? []) {
    nodes = nodes.map((n) => (n.id === u.id ? { ...n, ...u, config: { ...n.config, ...(u.config ?? {}) } } : n));
  }
  nodes = [...nodes, ...(change.addNodes ?? [])];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [...wf.edges.filter((e) => !removeEdges.has(e.id)), ...(change.addEdges ?? [])].filter((e) => ids.has(e.source) && ids.has(e.target));
  return { ...wf, nodes, edges };
}

export function connect(source: string, target: string): { id: string; source: string; target: string } {
  return { id: `e_${source}_${target}`, source, target };
}
