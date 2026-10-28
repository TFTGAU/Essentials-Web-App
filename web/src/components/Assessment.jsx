import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { indexResponses, key, domainStats, pct } from '../scoring.js';
import Overview from './Overview.jsx';
import DomainView from './DomainView.jsx';
import E8View from './E8View.jsx';
import Settings from './Settings.jsx';

const POLL_MS = 5000;

export default function Assessment({ view, arg, framework, me }) {
  const [assessment, setAssessment] = useState(null);
  const [state, setState] = useState({});
  const [error, setError] = useState('');
  const since = useRef('');
  const restoredAt = useRef(null);

  const merge = useCallback((responses) => {
    if (!responses.length) return;
    setState((prev) => {
      const next = { ...prev };
      for (const r of responses) {
        const k = key(r.kind, r.domain, r.itemId);
        if (!next[k] || next[k].updatedAt <= r.updatedAt) next[k] = r;
      }
      return next;
    });
  }, []);

  const load = useCallback(
    () =>
      api
        .get('/assessment')
        .then((d) => {
          setAssessment(d.assessment);
          setState(indexResponses(d.responses));
          since.current = d.serverTime;
          restoredAt.current = d.assessment.restored_at;
        })
        .catch((e) => setError(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  // Pick up teammates' changes: every few seconds, and as soon as the tab is shown again
  useEffect(() => {
    let busy = false;
    const poll = async () => {
      if (busy || document.hidden || !since.current) return;
      busy = true;
      try {
        const d = await api.get(`/assessment/changes?since=${encodeURIComponent(since.current)}`);
        if (d.assessment.restored_at !== restoredAt.current) {
          // Someone restored a backup: answers may have been removed, so reload everything
          await load();
          return;
        }
        since.current = d.serverTime;
        setAssessment(d.assessment);
        merge(d.responses);
      } catch {
        /* ignore transient errors */
      } finally {
        busy = false;
      }
    };
    const t = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [merge, load]);

  /** Save part of a response. Optimistic: updates the screen first. */
  const save = useCallback(
    async (kind, domain, itemId, patch, { optimistic = true, quiet = false } = {}) => {
      const k = key(kind, domain, itemId);
      if (optimistic) {
        setState((prev) => ({
          ...prev,
          [k]: { ...(prev[k] || { kind, domain, itemId }), data: { ...(prev[k]?.data || {}), ...patch }, updatedBy: me.email, updatedAt: prev[k]?.updatedAt || '' },
        }));
      }
      try {
        const [saved] = await api.put('/assessment/responses', { kind, domain, itemId, data: patch });
        merge([saved]);
        return saved;
      } catch (e) {
        // quiet: the caller shows the error itself (e.g. an invalid link)
        if (!quiet) setError(`Save failed: ${e.message}`);
        throw e;
      }
    },
    [me.email, merge]
  );

  const updateAssessment = async (patch) => {
    const a = await api.patch('/assessment', patch);
    setAssessment(a);
    return a;
  };

  const stats = useMemo(() => Object.fromEntries(framework.domains.map((d) => [d.name, domainStats(state, d)])), [framework, state]);

  if (error && !assessment) return <main className="page narrow"><div className="alert">{error}</div></main>;
  if (!assessment) return <main className="page narrow muted">Loading…</main>;

  const inScope = (name) => !assessment.scope.length || assessment.scope.includes(name);
  const base = '#';
  const domainIndex = view === 'domain' ? Number(arg) : -1;

  const navDomain = (d, i) => {
    const s = stats[d.name];
    return (
      <a key={d.name} href={`${base}/domain/${i}`} className={`side-link ${domainIndex === i ? 'active' : ''} ${inScope(d.name) ? '' : 'out'}`}>
        <span>{d.name}</span>
        <span className="side-count" title={`${s.assessed} of ${s.actions} actions assessed`}>
          {s.assessed ? pct(s.score) : ''}
        </span>
      </a>
    );
  };

  let content;
  if (view === 'domain' && framework.domains[domainIndex]) {
    content = (
      <DomainView
        key={domainIndex}
        domain={framework.domains[domainIndex]}
        framework={framework}
        state={state}
        save={save}
        stats={stats[framework.domains[domainIndex].name]}
        inScope={inScope(framework.domains[domainIndex].name)}
      />
    );
  } else if (view === 'e8') {
    content = <E8View framework={framework} state={state} save={save} />;
  } else if (view === 'settings') {
    content = <Settings assessment={assessment} framework={framework} state={state} me={me} updateAssessment={updateAssessment} stats={stats} reload={load} />;
  } else {
    content = <Overview framework={framework} state={state} stats={stats} inScope={inScope} base={base} />;
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="side-title" title={assessment.name}>
          {assessment.name}
        </div>
        <a href={`${base}/overview`} className={`side-link ${view === 'overview' ? 'active' : ''}`}>
          Summary
        </a>
        <a href={`${base}/e8`} className={`side-link ${view === 'e8' ? 'active' : ''}`}>
          E8 controls
        </a>
        <div className="side-group">Capability</div>
        {framework.domains.map((d, i) => (d.kind === 'capability' ? navDomain(d, i) : null))}
        {['1', '2', '3'].map((phase) => (
          <React.Fragment key={phase}>
            <div className="side-group">Technical · phase {phase}</div>
            {framework.domains.map((d, i) => (d.kind === 'technical' && d.priority === phase ? navDomain(d, i) : null))}
          </React.Fragment>
        ))}
        <div className="side-spacer" />
        <a href={`${base}/settings`} className={`side-link ${view === 'settings' ? 'active' : ''}`}>
          Settings
        </a>
      </aside>
      <main className="content">
        {error && (
          <div className="alert" onClick={() => setError('')}>
            {error}
          </div>
        )}
        {content}
      </main>
    </div>
  );
}

