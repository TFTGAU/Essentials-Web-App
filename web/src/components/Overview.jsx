import React from 'react';
import { principleNumeric, NUM_RATING, RATING_CLASS, pct } from '../scoring.js';
import { Bar, Rating } from './widgets.jsx';
import Radar from './Radar.jsx';

const SHORT = { 'Not effective': 'NE', 'Partially effective': 'PE', 'Fully effective': 'FE', 'Not assessed': '–' };

export default function Overview({ framework, state, stats, inScope, base }) {
  const domains = framework.domains.map((d, i) => ({ ...d, index: i }));
  const scoped = domains.filter((d) => inScope(d.name));
  const capability = domains.filter((d) => d.kind === 'capability');
  const technical = domains.filter((d) => d.kind === 'technical');

  // Totals across in-scope domains
  const sum = (f) => scoped.reduce((n, d) => n + f(stats[d.name]), 0);
  const totalActions = sum((s) => s.actions);
  const assessed = sum((s) => s.assessed);
  const principles = sum((s) => s.total);
  const counts = [0, 1, 2, 3].map((i) => sum((s) => s.counts[i]));
  const overall = principles ? (0.5 * counts[2] + counts[3]) / principles : 0;

  const radarPoints = domains.map((d) => {
    const s = stats[d.name];
    return {
      name: d.name,
      value: s.score,
      href: `${base}/domain/${d.index}`,
      muted: !inScope(d.name),
      detail: `${s.counts[3]} fully, ${s.counts[2]} partially, ${s.counts[1]} not effective, ${s.counts[0]} not assessed · ${s.assessed}/${s.actions} actions`,
    };
  });

  const cell = (d, pid) => {
    const p = d.principles.find((x) => x.id === pid);
    if (!p) return <td key={d.name} className="hm empty" />;
    const r = NUM_RATING[principleNumeric(state, d, p)];
    return (
      <td key={d.name} className={`hm ${RATING_CLASS[r]}`} title={`${d.name}, ${pid}: ${r}`}>
        <a href={`${base}/domain/${d.index}`}>{SHORT[r]}</a>
      </td>
    );
  };

  const principleName = (pid) => {
    for (const d of framework.domains) {
      const p = d.principles.find((x) => x.id === pid);
      if (p) return p.name;
    }
    return '';
  };

  const principleRow = (pid, cols) => (
    <tr key={pid}>
      <th>
        <span className="pid">{pid}</span>
        {principleName(pid)}
      </th>
      {cols.map((d) => cell(d, pid))}
    </tr>
  );

  return (
    <div>
      <h1>Summary</h1>
      <div className="page-meta">{scoped.length === domains.length ? 'All domains in scope' : `${scoped.length} of ${domains.length} domains in scope`}</div>

      <div className="stats">
        <div className="stat hero" title="(0.5 × partially effective + fully effective principles) ÷ all principles, across in-scope domains">
          <div className="stat-value">{pct(overall)}</div>
          <div className="stat-label">Overall effective</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {assessed}
            <span className="stat-of"> / {totalActions}</span>
          </div>
          <div className="stat-label">Actions assessed</div>
          <div className="meter">
            <span style={{ width: `${totalActions ? (assessed / totalActions) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="stat">
          <div className="stat-value">{counts[3]}</div>
          <div className="stat-label">
            <Rating rating="Fully effective">Principles fully effective</Rating>
          </div>
        </div>
        <div className="stat">
          <div className="stat-value">{counts[2]}</div>
          <div className="stat-label">
            <Rating rating="Partially effective">Partially effective</Rating>
          </div>
        </div>
        <div className="stat">
          <div className="stat-value">{counts[1]}</div>
          <div className="stat-label">
            <Rating rating="Not effective">Not effective</Rating>
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <h2>% effective by domain</h2>
          <Radar points={radarPoints} />
        </div>

        <div className="panel">
          <h2>Domains</h2>
          <div className="scroll-x">
            <table className="compact">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Phase</th>
                  <th className="num">Effective</th>
                  <th>Principles</th>
                  <th className="num" title="Actions left to assess">
                    Left
                  </th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => {
                  const s = stats[d.name];
                  return (
                    <tr key={d.name} className={inScope(d.name) ? '' : 'out'}>
                      <td>
                        <a href={`${base}/domain/${d.index}`}>{d.name}</a>
                        {!inScope(d.name) && ' (out of scope)'}
                      </td>
                      <td>{d.priority}</td>
                      <td className="num">
                        <b>{pct(s.score)}</b>
                      </td>
                      <td style={{ verticalAlign: 'middle', minWidth: 110 }}>
                        <Bar counts={s.counts} total={s.total} />
                      </td>
                      <td className="num">{s.remaining}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="legend" style={{ marginTop: 10 }}>
            {['Fully effective', 'Partially effective', 'Not effective'].map((r) => (
              <Rating key={r} rating={r} />
            ))}
          </div>
        </div>
      </div>

      <div className="section" style={{ marginTop: 24 }}>
        <h2>Principle ratings</h2>
        <div className="legend">
          {['Not effective', 'Partially effective', 'Fully effective', 'Not assessed'].map((r) => (
            <Rating key={r} rating={r}>
              {SHORT[r] !== '–' ? `${SHORT[r]} ${r}` : r}
            </Rating>
          ))}
        </div>
        <div className="heatmaps">
          <div>
            {capability.map((d) => (
              <table key={d.name} className="heatmap" style={{ marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Principle</th>
                    <th>{d.name}</th>
                  </tr>
                </thead>
                <tbody>{d.principles.map((p) => principleRow(p.id, [d]))}</tbody>
              </table>
            ))}
          </div>
          <div className="scroll-x">
            <table className="heatmap">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Principle</th>
                  {technical.map((d) => (
                    <th key={d.name}>
                      {d.name}
                      <div className="muted" style={{ fontWeight: 400 }}>
                        Phase {d.priority}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{framework.principleOrder.technical.map((pid) => principleRow(pid, technical))}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
