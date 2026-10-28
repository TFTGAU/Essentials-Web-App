import React, { useMemo, useState } from 'react';
import { key, actionRating, principleNumeric, NUM_RATING, LEVEL_NAME, e8Statuses, pct } from '../scoring.js';
import { Rating, RatingPicker, TextField, YesNo } from './widgets.jsx';
import Links from './Links.jsx';

// Link changes wait for the server (it assigns IDs) and show their own errors
const LINK_OPTS = { optimistic: false, quiet: true };

const FILTERS = ['All', 'Not assessed', 'Not effective', 'Partially effective', 'Fully effective'];
const E8_CLASS = { 1: 'fe', '-1': 'ne', 0: 'na' };

export default function DomainView({ domain, framework, state, save, stats, inScope }) {
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [openAll, setOpenAll] = useState(false);
  const e8 = useMemo(() => e8Statuses(framework, state), [framework, state]);
  const e8ById = useMemo(() => Object.fromEntries(framework.e8.controls.map((c) => [c.id, c])), [framework]);

  // Searchable text for each principle and action, built once per domain
  const index = useMemo(() => {
    const lower = (...parts) => parts.join(' ').toLowerCase();
    return Object.fromEntries(
      domain.principles.map((p) => [
        p.id,
        {
          principle: lower(p.id, p.name, p.description),
          actions: Object.fromEntries(
            p.actions.map((a) => [
              a.id,
              {
                action: lower(a.id, a.description, ...a.e8Controls.map((id) => `${id} ${e8ById[id]?.description || ''}`)),
                indicators: lower(...a.indicators.map((i) => `${i.id} ${i.text}`)),
              },
            ])
          ),
        },
      ])
    );
  }, [domain, e8ById]);

  // Every word must appear somewhere in the principle, action, indicators or E8 controls
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searchHit = (p, a) => {
    const t = index[p.id];
    const text = `${t.principle} ${t.actions[a.id].action} ${t.actions[a.id].indicators}`;
    return terms.every((w) => text.includes(w));
  };
  // Open the indicators when the match is only in them, so it's visible
  const onlyInIndicators = (p, a) => {
    const t = index[p.id];
    const outside = `${t.principle} ${t.actions[a.id].action}`;
    return terms.length > 0 && !terms.every((w) => outside.includes(w));
  };
  const matches = (p, a) => (filter === 'All' || actionRating(state, domain.name, a.id) === filter) && (!terms.length || searchHit(p, a));
  const shown = domain.principles.map((p) => ({ p, actions: p.actions.filter((a) => matches(p, a)) })).filter((x) => x.actions.length);

  return (
    <div>
      <h1>{domain.name}</h1>
      <div className="page-meta" title={domain.description}>
        {domain.priority === 'All' ? 'All phases' : `Phase ${domain.priority}`} · <b>{pct(stats.score)}</b> effective · {stats.assessed} of {stats.actions} actions assessed
        {!inScope && ' · out of scope'}
      </div>

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by rating">
          {FILTERS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check small">
          <input type="checkbox" checked={openAll} onChange={(e) => setOpenAll(e.target.checked)} /> Show indicators
        </label>
      </div>

      {shown.length === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>
          No actions match{terms.length ? ` "${search.trim()}"` : ''}
          {filter !== 'All' ? ` with rating "${filter}"` : ''}.
        </p>
      )}

      {shown.map(({ p, actions }) => {
        return (
          <section key={p.id} className="principle">
            <div className="principle-head">
              <h2>
                <span className="pid">{p.id}</span>
                {p.name}
              </h2>
              <Rating rating={NUM_RATING[principleNumeric(state, domain, p)]} />
            </div>
            <p className="principle-desc">{p.description}</p>
            {actions.map((a) => (
              <ActionRow
                key={`${a.id}-${openAll}-${onlyInIndicators(p, a)}`}
                domain={domain}
                action={a}
                state={state}
                save={save}
                e8={e8}
                e8ById={e8ById}
                defaultOpen={openAll || onlyInIndicators(p, a)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ActionRow({ domain, action, state, save, e8, e8ById, defaultOpen }) {
  const r = state[key('action', domain.name, action.id)];
  const data = r?.data || {};
  const [showIgp, setShowIgp] = useState(defaultOpen);
  const [showE8, setShowE8] = useState(false);
  const igpData = (id) => state[key('igp', domain.name, id)]?.data || {};
  const present = action.indicators.filter((i) => igpData(i.id).present === 'Yes').length;
  const lastChange = r?.updatedBy ? `Last changed by ${r.updatedBy}, ${new Date(r.updatedAt).toLocaleString()}` : undefined;

  return (
    <div className="action">
      <div className="action-top">
        <div className="action-id" title={lastChange}>
          {action.id}
        </div>
        <div className="action-body">
          <div>{action.description}</div>
          <RatingPicker value={data.rating || 'Not assessed'} onChange={(v) => save('action', domain.name, action.id, { rating: v })} />
          <div className="two-col">
            <TextField label="Reasoning" value={data.reasoning} onSave={(v) => save('action', domain.name, action.id, { reasoning: v })} />
            <div className="evidence-col">
              <TextField label="Evidence" value={data.evidence} onSave={(v) => save('action', domain.name, action.id, { evidence: v })} />
              <Links
                links={data.links}
                onAdd={(link) => save('action', domain.name, action.id, { addLink: link }, LINK_OPTS)}
                onRemove={(id) => save('action', domain.name, action.id, { removeLink: id }, LINK_OPTS)}
              />
            </div>
          </div>
          <div className="action-links">
            <button type="button" className="link" onClick={() => setShowIgp(!showIgp)}>
              {showIgp ? 'Hide' : 'Show'} indicators
              <span className="counts">
                {present}/{action.indicators.length}
              </span>
            </button>
            {action.e8Controls.length > 0 && (
              <button type="button" className="link" onClick={() => setShowE8(!showE8)}>
                {showE8 ? 'Hide' : 'Show'} E8 controls
                <span className="counts">{action.e8Controls.length}</span>
              </button>
            )}
          </div>

          {showIgp && (
            <div className="igps">
              {['NE', 'PE', 'FE'].map((level) => {
                const list = action.indicators.filter((i) => i.level === level);
                if (!list.length) return null;
                return (
                  <div key={level}>
                    <div className={`igp-level ${level.toLowerCase()}`}>{LEVEL_NAME[level]}</div>
                    {list.map((i) => (
                      <Indicator key={i.id} ind={i} data={igpData(i.id)} onSave={(patch, opts) => save('igp', domain.name, i.id, patch, opts)} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {showE8 && (
            <table className="compact">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Status</th>
                  <th>Strategy</th>
                  <th>ML</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {action.e8Controls.map((id) => {
                  const c = e8ById[id];
                  const s = e8[id];
                  return (
                    <tr key={id}>
                      <td className="mono nowrap">{id}</td>
                      <td>
                        <span className={`rating ${E8_CLASS[s?.evidence ?? 0]}`}>{s?.final}</span>
                      </td>
                      <td>{c?.strategies.join(', ')}</td>
                      <td className="nowrap">{c?.levels.join(', ')}</td>
                      <td>{c?.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Indicator({ ind, data, onSave }) {
  const linkCount = data.links?.length || 0;
  const hasNotes = !!(data.reasoning || data.evidence || linkCount);
  const [notes, setNotes] = useState(hasNotes);
  const present = data.present || 'Not assessed';
  return (
    <div className={`igp present-${present === 'Yes' ? 'yes' : present === 'No' ? 'no' : 'na'}`}>
      <div className="igp-row">
        <span className="igp-id mono">{ind.id.split('.').pop()}</span>
        <span className="igp-text">{ind.text}</span>
        <YesNo value={present} onChange={(v) => onSave({ present: v })} />
        <button type="button" className="link small" onClick={() => setNotes(!notes)}>
          {notes ? 'Hide notes' : hasNotes ? `Notes${linkCount ? ` · ${linkCount} link${linkCount > 1 ? 's' : ''}` : ''}` : 'Add notes'}
        </button>
      </div>
      {notes && (
        <div className="two-col igp-notes">
          <TextField label="Reasoning" rows={1} value={data.reasoning} onSave={(v) => onSave({ reasoning: v })} />
          <div className="evidence-col">
            <TextField label="Evidence" rows={1} value={data.evidence} onSave={(v) => onSave({ evidence: v })} />
            <Links links={data.links} onAdd={(link) => onSave({ addLink: link }, LINK_OPTS)} onRemove={(id) => onSave({ removeLink: id }, LINK_OPTS)} />
          </div>
        </div>
      )}
    </div>
  );
}
