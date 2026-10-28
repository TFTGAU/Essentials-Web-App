import React, { useMemo, useState } from 'react';
import { key, e8Statuses, E8_LEVELS, E8_OVERRIDES } from '../scoring.js';

const FINAL_CLASS = {
  Effective: 'fe',
  'Alternate control': 'fe',
  Ineffective: 'ne',
  'Not implemented': 'ne',
  'No visibility': 'pe',
};

export default function E8View({ framework, state, save }) {
  const [strategy, setStrategy] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const statuses = useMemo(() => e8Statuses(framework, state), [framework, state]);
  const level = (s) => state[key('e8level', '', s)]?.data?.level || 'ML0';
  const overrides = (s) => framework.e8.controls.filter((c) => c.strategies.includes(s) && statuses[c.id].override).length;

  const q = search.trim().toLowerCase();
  const rows = framework.e8.controls.filter(
    (c) =>
      (!strategy || c.strategies.includes(strategy)) &&
      (!status || statuses[c.id].final === status) &&
      (!q || c.id.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
  );

  return (
    <div>
      <h1>Existing E8 controls</h1>
      <div className="page-meta">Controls for a strategy are marked Effective up to the maturity level you set. Override any control below.</div>

      <table style={{ width: 'auto', marginBottom: 24 }}>
        <thead>
          <tr>
            <th>Mitigation strategy</th>
            <th>Maturity level</th>
            <th className="num">Overrides</th>
          </tr>
        </thead>
        <tbody>
          {framework.e8.strategies.map((s) => (
            <tr key={s}>
              <td style={{ verticalAlign: 'middle' }}>{s}</td>
              <td>
                <div className="seg">
                  {E8_LEVELS.map((l) => (
                    <button key={l} type="button" className={level(s) === l ? 'on' : ''} onClick={() => save('e8level', '', s, { level: l })}>
                      {l}
                    </button>
                  ))}
                </div>
              </td>
              <td className="num muted" style={{ verticalAlign: 'middle' }}>
                {overrides(s) || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="toolbar static">
        <select value={strategy} onChange={(e) => setStrategy(e.target.value)} aria-label="Strategy">
          <option value="">All strategies</option>
          {framework.e8.strategies.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {E8_OVERRIDES.filter(Boolean).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted small">{rows.length} controls</span>
      </div>

      <div className="scroll-x">
        <table className="e8-table compact">
          <thead>
            <tr>
              <th>Control</th>
              <th>Description</th>
              <th>ML</th>
              <th>Strategy</th>
              <th>Auto</th>
              <th>Override</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = statuses[c.id];
              return (
                <tr key={c.id}>
                  <td className="mono nowrap">{c.id}</td>
                  <td>{c.description}</td>
                  <td className="nowrap">{c.levels.join(', ')}</td>
                  <td>{c.strategies.join(', ')}</td>
                  <td className="nowrap muted">{s.auto}</td>
                  <td>
                    <select value={s.override} onChange={(e) => save('e8override', '', c.id, { override: e.target.value })} aria-label={`Override for ${c.id}`}>
                      {E8_OVERRIDES.map((o) => (
                        <option key={o} value={o}>
                          {o || '—'}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`rating ${FINAL_CLASS[s.final] || 'na'}`}>{s.final}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
