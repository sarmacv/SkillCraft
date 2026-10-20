import { useMemo, useState } from 'react';
import { CATALOG, CATEGORY_META, type ComponentDef } from '../../src/core/catalog';
import type { Category } from '../../src/core/types';
import type { TargetView } from './App';

export const DRAG_MIME = 'application/x-skillcraft-component';
const CATEGORIES: Category[] = ['entry', 'source', 'module', 'output'];

export function Palette({ onAdd, target }: { onAdd: (type: string) => void; target: TargetView }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<Category>>(new Set());

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (c: ComponentDef) => !q || `${c.label} ${c.summary} ${c.id}`.toLowerCase().includes(q);
  }, [query]);

  const startDrag = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData(DRAG_MIME, type);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <nav className="palette" aria-label="Components">
      <div className="search">
        <span className="codicon codicon-search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search components" aria-label="Search components" />
      </div>
      <div className="palette-scroll">
        {CATEGORIES.map((cat) => {
          const items = CATALOG.filter((c) => c.category === cat && matches(c));
          if (!items.length && query) return null;
          const open = !collapsed.has(cat) || !!query;
          return (
            <section key={cat} className={`group cat-${cat}`}>
              <button
                className="group-head"
                aria-expanded={open}
                onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n; })}
              >
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
                <span className="swatch" />
                {CATEGORY_META[cat].label}
                <span className="hint">{CATEGORY_META[cat].hint}</span>
              </button>
              {open && (
                <ul>
                  {cat !== 'entry' && !query && (
                    <li
                      className="item placeholder"
                      draggable
                      onDragStart={(e) => startDrag(e, `placeholder.${cat}`)}
                      onDoubleClick={() => onAdd(`placeholder.${cat}`)}
                      title="Not sure yet? Drop a placeholder and choose the exact type later."
                    >
                      <span className="codicon codicon-question" />
                      <div>
                        <div className="label">Some {cat === 'source' ? 'source' : cat === 'module' ? 'step' : 'output'}…</div>
                        <div className="summary">Decide the type later</div>
                      </div>
                    </li>
                  )}
                  {items.map((c) => {
                    const support = target === 'all' ? undefined : c.support[target];
                    return (
                      <li
                        key={c.id}
                        className={`item ${support === 'no' ? 'unsupported' : ''}`}
                        draggable
                        onDragStart={(e) => startDrag(e, c.id)}
                        onDoubleClick={() => onAdd(c.id)}
                        onKeyDown={(e) => e.key === 'Enter' && onAdd(c.id)}
                        tabIndex={0}
                        title={`${c.summary}. Drag onto the canvas, or double-click to add.${support === 'setup' && c.supportNote ? `\n${c.supportNote}` : ''}`}
                      >
                        <span className={`codicon codicon-${c.icon}`} />
                        <div>
                          <div className="label">{c.label}{support === 'setup' && <span className="tag">setup</span>}</div>
                          <div className="summary">{c.summary}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <div className="palette-foot">Drag onto the canvas · double-click to add</div>
    </nav>
  );
}
