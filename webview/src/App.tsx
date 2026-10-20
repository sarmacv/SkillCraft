import {
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  type EdgeChange,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_META, categoryOf, getComponent } from '../../src/core/catalog';
import type { HostMessage, ViewState } from '../../src/core/messages';
import type { TargetId, Workflow, WorkflowNode } from '../../src/core/types';
import { autoLayout, newId } from '../../src/core/workflow';
import { Checks } from './Checks';
import { Coach } from './Coach';
import { Header } from './Header';
import { Inspector } from './Inspector';
import { Palette, DRAG_MIME } from './Palette';
import { SkillNode, type SkillNodeData } from './SkillNode';
import { post, vscode } from './vscode';

export type TargetView = 'all' | TargetId;
type RightTab = 'inspect' | 'coach' | 'checks';

const nodeTypes = { skill: SkillNode };

export function App() {
  return (
    <ReactFlowProvider>
      <Shell />
    </ReactFlowProvider>
  );
}

function Shell() {
  const [state, setState] = useState<ViewState | undefined>();
  const [workflow, setWorkflow] = useState<Workflow>({ version: 1, nodes: [], edges: [] });
  const persisted = vscode.getState<{ target?: TargetView; tab?: RightTab }>() ?? {};
  const [target, setTarget] = useState<TargetView>(persisted.target ?? 'all');
  const [tab, setTab] = useState<RightTab>(persisted.tab ?? 'inspect');
  const [selected, setSelected] = useState<string | undefined>();
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => vscode.setState({ target, tab }), [target, tab]);

  useEffect(() => {
    const onMessage = (e: MessageEvent<HostMessage>) => {
      const m = e.data;
      if (m.type === 'state') {
        setState(m.state);
        setWorkflow(m.state.workflow);
      } else if (m.type === 'nodeTestResult') {
        setTestResults((r) => ({ ...r, [m.nodeId]: { ok: m.ok, detail: m.detail } }));
      } else if (m.type === 'select') {
        setSelected(m.nodeId);
        setTab('inspect');
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const commit = useCallback((next: Workflow) => {
    setWorkflow(next);
    post({ type: 'workflow', workflow: next });
  }, []);

  const findingsByNode = useMemo(() => {
    const map = new Map<string, NonNullable<ViewState['findings']>>();
    for (const f of state?.findings ?? []) if (f.nodeId) map.set(f.nodeId, [...(map.get(f.nodeId) ?? []), f]);
    return map;
  }, [state?.findings]);

  // Ghost nodes and edges show pending proposals before they are accepted.
  const ghostInfo = useMemo(() => {
    const added: (WorkflowNode & { proposalKey: string })[] = [];
    const removed = new Map<string, string>();
    const updated = new Map<string, string>();
    const edges: Edge[] = [];
    for (const g of state?.ghosts ?? []) {
      g.change.addNodes?.forEach((n) => added.push({ ...n, proposalKey: g.proposalKey }));
      g.change.removeNodeIds?.forEach((id) => removed.set(id, g.proposalKey));
      g.change.updateNodes?.forEach((u) => updated.set(u.id, g.proposalKey));
      g.change.addEdges?.forEach((e) => edges.push({ id: `ghost:${e.id}`, source: added.some((n) => n.id === e.source) ? `ghost:${e.source}` : e.source, target: added.some((n) => n.id === e.target) ? `ghost:${e.target}` : e.target, className: 'ghost-edge', selectable: false }));
    }
    return { added, removed, updated, edges };
  }, [state?.ghosts]);

  const derivedNodes: Node<SkillNodeData>[] = useMemo(() => {
    const real = workflow.nodes.map((n) => ({
      id: n.id,
      type: 'skill',
      position: n.position,
      selected: n.id === selected,
      data: {
        node: n,
        findings: findingsByNode.get(n.id) ?? [],
        target,
        ghost: ghostInfo.removed.has(n.id) ? 'remove' : ghostInfo.updated.has(n.id) ? 'modify' : undefined,
        proposalKey: ghostInfo.removed.get(n.id) ?? ghostInfo.updated.get(n.id),
      } satisfies SkillNodeData,
    }));
    const ghosts = ghostInfo.added.map((n) => ({
      id: `ghost:${n.id}`,
      type: 'skill',
      position: n.position.x || n.position.y ? n.position : { x: 40 + Math.random() * 40, y: 380 },
      draggable: false,
      selectable: false,
      data: { node: n, findings: [], target, ghost: 'add' as const, proposalKey: n.proposalKey },
    }));
    return [...real, ...ghosts];
  }, [workflow.nodes, selected, findingsByNode, target, ghostInfo]);

  // React Flow owns measurement and drag state, so keep its node array and merge our derived data in.
  const [rfNodes, setRfNodes] = useState<Node<SkillNodeData>[]>([]);
  useEffect(() => {
    setRfNodes((prev) => derivedNodes.map((n) => {
      const old = prev.find((p) => p.id === n.id);
      return old ? { ...n, measured: old.measured, width: old.width, height: old.height, dragging: old.dragging } : n;
    }));
  }, [derivedNodes]);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !workflow.nodes.length) return;
    fitted.current = true;
    setTimeout(() => flow.fitView({ padding: 0.2, maxZoom: 1.1 }), 60);
  }, [workflow.nodes.length, flow]);

  const rfEdges: Edge[] = useMemo(
    () => [
      ...workflow.edges.map((e) => {
        const tgt = workflow.nodes.find((n) => n.id === e.target);
        const excluded = target !== 'all' && [e.source, e.target].some((id) => workflow.nodes.find((n) => n.id === id)?.excludeTargets?.includes(target));
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          className: `cat-${tgt ? categoryOf(tgt.type) : 'module'}${excluded ? ' excluded' : ''}`,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        };
      }),
      ...ghostInfo.edges,
    ],
    [workflow.edges, workflow.nodes, ghostInfo.edges, target],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<SkillNodeData>>[]) => {
      const next = applyNodeChanges(changes, rfNodes);
      setRfNodes(next);
      const real = changes.filter((c) => !('id' in c) || !String(c.id).startsWith('ghost:'));
      const removed = real.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      const done = real.some((c) => c.type === 'remove' || (c.type === 'position' && c.dragging === false));
      if (done) {
        commit({
          ...workflow,
          nodes: workflow.nodes.filter((n) => !removed.includes(n.id)).map((n) => ({ ...n, position: next.find((m) => m.id === n.id)?.position ?? n.position })),
          edges: workflow.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)),
        });
      }
      const sel = real.find((c) => c.type === 'select' && c.selected) as { id: string } | undefined;
      if (sel) {
        setSelected(sel.id);
        setTab('inspect');
      }
      if (removed.includes(selected ?? '')) setSelected(undefined);
    },
    [workflow, rfNodes, commit, selected],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const real = changes.filter((c) => !('id' in c) || !String(c.id).startsWith('ghost:'));
      if (!real.some((c) => c.type === 'remove')) return;
      const kept = applyEdgeChanges(real, workflow.edges.map((e) => ({ ...e })));
      commit({ ...workflow, edges: kept.map((e) => ({ id: e.id, source: e.source, target: e.target })) });
    },
    [workflow, commit],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target || c.source.startsWith('ghost:') || c.target.startsWith('ghost:')) return;
      const edges = addEdge({ ...c, id: `e_${c.source}_${c.target}` }, workflow.edges.map((e) => ({ ...e }))) as Edge[];
      commit({ ...workflow, edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) });
    },
    [workflow, commit],
  );

  const addNode = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      const def = getComponent(type);
      const cat = categoryOf(type);
      const id = newId(cat);
      const pos = position ?? flow.screenToFlowPosition({ x: (wrapper.current?.clientWidth ?? 600) / 2, y: (wrapper.current?.clientHeight ?? 400) / 2 });
      const node: WorkflowNode = {
        id,
        type,
        label: def?.label ?? `New ${CATEGORY_META[cat].label.toLowerCase().replace(/s$/, '')}`,
        config: {},
        position: pos,
      };
      commit({ ...workflow, nodes: [...workflow.nodes, node] });
      setSelected(id);
      setTab('inspect');
    },
    [workflow, commit, flow],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DRAG_MIME);
      if (!type) return;
      addNode(type, flow.screenToFlowPosition({ x: e.clientX - 90, y: e.clientY - 28 }));
    },
    [addNode, flow],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<WorkflowNode>) => commit({ ...workflow, nodes: workflow.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }),
    [workflow, commit],
  );
  const deleteNode = useCallback(
    (id: string) => {
      commit({ ...workflow, nodes: workflow.nodes.filter((n) => n.id !== id), edges: workflow.edges.filter((e) => e.source !== id && e.target !== id) });
      setSelected(undefined);
    },
    [workflow, commit],
  );

  if (!state) return <div className="loading"><span className="codicon codicon-loading codicon-modifier-spin" /> Loading SkillCraft…</div>;

  const selectedNode = workflow.nodes.find((n) => n.id === selected);
  const empty = workflow.nodes.length === 0;
  const openCoach = state.coach.length;
  const issueCount = state.findings.filter((f) => f.severity !== 'info').length;

  return (
    <div className="shell">
      <Header
        state={state}
        target={target}
        onTarget={setTarget}
        onLayout={() => {
          commit(autoLayout(workflow));
          setTimeout(() => flow.fitView({ padding: 0.2, duration: 300 }), 50);
        }}
      />
      <div className="body">
        <Palette onAdd={(type) => addNode(type)} target={target} />
        <div className="canvas" ref={wrapper} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelected(undefined)}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
            minZoom={0.2}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" nodeClassName={(n) => `mini-${categoryOf((n.data as SkillNodeData).node.type)}`} />
          </ReactFlow>
          {empty && (
            <div className="empty">
              <span className="codicon codicon-type-hierarchy-sub empty-icon" />
              <h2>Start your skill's workflow</h2>
              <p>Drag a component from the left — a source, a step, an output — or let SkillCraft draft it with you.</p>
              <div className="empty-actions">
                <button className="primary" onClick={() => post({ type: 'command', command: 'describe' })}><span className="codicon codicon-comment-discussion" /> Describe it in chat</button>
                <button onClick={() => addNode('entry.trigger', { x: 0, y: 120 })}><span className="codicon codicon-zap" /> Add a trigger</button>
              </div>
            </div>
          )}
          {state.ghosts.length > 0 && (
            <div className="ghost-banner">
              <span className="codicon codicon-lightbulb" />
              {state.ghosts.length} proposal{state.ghosts.length > 1 ? 's' : ''} shown as dashed nodes.
              {state.ghosts.map((g) => (
                <span key={g.proposalKey} className="ghost-actions">
                  <b>{g.title}</b>
                  <button className="link" onClick={() => post({ type: 'proposal', key: g.proposalKey, action: 'accept' })}>Accept</button>
                  <button className="link" onClick={() => post({ type: 'proposal', key: g.proposalKey, action: 'reject' })}>Reject</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <aside className="side">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'inspect'} className={tab === 'inspect' ? 'on' : ''} onClick={() => setTab('inspect')}>
              {selectedNode ? 'Component' : 'Project'}
            </button>
            <button role="tab" aria-selected={tab === 'coach'} className={tab === 'coach' ? 'on' : ''} onClick={() => setTab('coach')}>
              Coach {openCoach > 0 && <span className="count">{openCoach}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'on' : ''} onClick={() => setTab('checks')}>
              Checks {issueCount > 0 && <span className="count warn">{issueCount}</span>}
            </button>
          </div>
          <div className="side-body">
            {tab === 'inspect' && (
              <Inspector
                key={selectedNode?.id ?? 'project'}
                state={state}
                node={selectedNode}
                target={target}
                findings={selectedNode ? findingsByNode.get(selectedNode.id) ?? [] : []}
                testResult={selectedNode ? testResults[selectedNode.id] : undefined}
                onChange={updateNode}
                onDelete={deleteNode}
              />
            )}
            {tab === 'coach' && <Coach state={state} />}
            {tab === 'checks' && (
              <Checks
                state={state}
                onSelectNode={(id) => {
                  setSelected(id);
                  setTab('inspect');
                  const n = workflow.nodes.find((x) => x.id === id);
                  if (n) flow.setCenter(n.position.x + 100, n.position.y + 30, { zoom: 1, duration: 300 });
                }}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
