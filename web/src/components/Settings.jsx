import React, { useRef, useState } from 'react';
import { api, downloadFile } from '../api.js';
import { toCsv } from '../csv.js';
import { key, actionRating, principleNumeric, NUM_RATING, e8Statuses, pct } from '../scoring.js';

// Links as one cell: "Name: url" per line
const linksCell = (links) => (links || []).map((l) => (l.title ? `${l.title}: ${l.url}` : l.url)).join('\n');
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export default function Settings({ assessment, framework, state, me, updateAssessment, stats, reload }) {
  const fileRef = useRef(null);
  const [name, setName] = useState(assessment.name);
  const [description, setDescription] = useState(assessment.description);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const allDomains = framework.domains.map((d) => d.name);
  const scope = assessment.scope.length ? assessment.scope : allDomains;

  const run = async (fn, done) => {
    setError('');
    setMsg('');
    try {
      await fn();
      if (done) setMsg(done);
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleScope = (d) => {
    const next = scope.includes(d) ? scope.filter((x) => x !== d) : [...scope, d];
    if (!next.length) return setError('At least one domain must be in scope.');
    run(() => updateAssessment({ scope: next.length === allDomains.length ? [] : next }));
  };

  const exportActionsCsv = () => {
    const rows = [['Domain', 'Priority phase', 'Principle', 'Principle name', 'Principle rating', 'Action ID', 'Action', 'Assessed rating', 'Assessor reasoning', 'Evidence gathered', 'Evidence links', 'Last updated by', 'Last updated']];
    for (const d of framework.domains)
      for (const p of d.principles) {
        const pr = NUM_RATING[principleNumeric(state, d, p)];
        for (const a of p.actions) {
          const r = state[key('action', d.name, a.id)];
          rows.push([d.name, d.priority, p.id, p.name, pr, a.id, a.description, actionRating(state, d.name, a.id), r?.data?.reasoning, r?.data?.evidence, linksCell(r?.data?.links), r?.updatedBy, r?.updatedAt]);
        }
      }
    downloadFile(`${slug(assessment.name)}-actions.csv`, '﻿' + toCsv(rows), 'text/csv');
  };

  const exportIgpCsv = () => {
    const rows = [['Domain', 'Action ID', 'Indicator ID', 'Level', 'Indicator', 'Present', 'Reasoning', 'Evidence', 'Evidence links']];
    for (const d of framework.domains)
      for (const p of d.principles)
        for (const a of p.actions)
          for (const i of a.indicators) {
            const r = state[key('igp', d.name, i.id)]?.data || {};
            if (!r.present && !r.reasoning && !r.evidence && !r.links?.length) continue;
            rows.push([d.name, a.id, i.id, i.level, i.text, r.present || 'Not assessed', r.reasoning, r.evidence, linksCell(r.links)]);
          }
    downloadFile(`${slug(assessment.name)}-indicators.csv`, '﻿' + toCsv(rows), 'text/csv');
  };

  const exportSummaryCsv = () => {
    const rows = [['Domain', 'Priority phase', 'In scope', '% effective', 'Not assessed', 'Not effective', 'Partially effective', 'Fully effective', 'Actions remaining']];
    for (const d of framework.domains) {
      const s = stats[d.name];
      rows.push([d.name, d.priority, scope.includes(d.name) ? 'Yes' : 'No', pct(s.score), ...s.counts, s.remaining]);
    }
    rows.push([]);
    rows.push(['ISM control', 'Auto status', 'Override', 'Final status']);
    const e8 = e8Statuses(framework, state);
    for (const c of framework.e8.controls) rows.push([c.id, e8[c.id].auto, e8[c.id].override, e8[c.id].final]);
    downloadFile(`${slug(assessment.name)}-summary.csv`, '﻿' + toCsv(rows), 'text/csv');
  };

  const exportJson = () => {
    const data = {
      format: 'essentials-assessment/v1',
      exportedAt: new Date().toISOString(),
      exportedBy: me.email,
      framework: framework.source,
      assessment: { name: assessment.name, description: assessment.description, scope: assessment.scope },
      responses: Object.values(state).map(({ kind, domain, itemId, data }) => ({ kind, domain, itemId, data })),
    };
    downloadFile(`${slug(assessment.name)}-backup.json`, JSON.stringify(data, null, 1), 'application/json');
  };

  const restore = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setError('That file is not valid JSON.');
    }
    const n = Array.isArray(data.responses) ? data.responses.length : 0;
    const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date';
    if (!window.confirm(`Replace ALL current answers with this backup from ${when} (${n} saved answers)? Current answers will be lost. Take a backup first if unsure.`)) return;
    run(async () => {
      await api.post('/assessment/restore', data);
      await reload();
    }, 'Backup restored.');
  };

  return (
    <div>
      <h1 style={{ marginBottom: 14 }}>Settings</h1>
      {msg && <div className="alert info">{msg}</div>}
      {error && <div className="alert">{error}</div>}

      <div className="section">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateAssessment({ name, description }), 'Saved.');
          }}
        >
          <label className="field">
            <span className="field-label">Business name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
          </label>
          <label className="field">
            <span className="field-label">Notes</span>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </label>
          <div>
            <button className="btn primary">Save</button>
          </div>
        </form>
      </div>

      <div className="section">
        <h2>Domains in scope</h2>
        <div className="scope-grid">
          {framework.domains.map((d) => (
            <label key={d.name} className="check">
              <input type="checkbox" checked={scope.includes(d.name)} onChange={() => toggleScope(d.name)} /> {d.name}
            </label>
          ))}
        </div>
      </div>

      <div className="section">
        <h2>Export</h2>
        <div className="row">
          <button className="btn" onClick={exportSummaryCsv}>
            Summary (CSV)
          </button>
          <button className="btn" onClick={exportActionsCsv}>
            Actions (CSV)
          </button>
          <button className="btn" onClick={exportIgpCsv}>
            Indicators (CSV)
          </button>
          <button className="btn" onClick={exportJson}>
            Backup (JSON)
          </button>
        </div>
      </div>

      {me.isAdmin && (
        <div className="section">
          <h2>Restore</h2>
          <p className="muted">Replaces all answers with a JSON backup. This can't be undone.</p>
          <button className="btn danger" onClick={() => fileRef.current.click()}>
            Restore from backup…
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={restore} />
        </div>
      )}
    </div>
  );
}
