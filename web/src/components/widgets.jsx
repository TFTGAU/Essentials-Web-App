import React, { useEffect, useRef, useState } from 'react';
import { RATINGS, RATING_CLASS } from '../scoring.js';

export function Rating({ rating, children }) {
  return <span className={`rating ${RATING_CLASS[rating] || 'na'}`}>{children || rating}</span>;
}

export function RatingPicker({ value, onChange }) {
  return (
    <div className="rating-picker" role="radiogroup" aria-label="Rating">
      {RATINGS.map((r) => (
        <button key={r} type="button" role="radio" aria-checked={value === r} className={`rp ${RATING_CLASS[r]} ${value === r ? 'on' : ''}`} onClick={() => onChange(r)}>
          {r}
        </button>
      ))}
    </div>
  );
}

/** Yes / No toggle. Clicking the active option clears it. */
export function YesNo({ value, onChange }) {
  return (
    <div className="yn">
      {['Yes', 'No'].map((v) => (
        <button key={v} type="button" className={`${v === 'Yes' ? 'yes' : 'no'} ${value === v ? 'on' : ''}`} onClick={() => onChange(value === v ? 'Not assessed' : v)}>
          {v}
        </button>
      ))}
    </div>
  );
}

/**
 * Textarea that keeps a local draft and saves after a pause or on blur.
 *
 * If someone else changes the same field while you're typing, your text is
 * left alone and a warning appears. You can take their version, or keep
 * typing, in which case your next save replaces theirs.
 */
export function TextField({ value = '', onSave, rows = 2, label }) {
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState('');
  const [remote, setRemote] = useState(null); // someone else's newer text, while focused
  const focused = useRef(false);
  const timer = useRef(null);
  const lastSaved = useRef(value);
  const sent = useRef(new Set()); // values this field saved, so our own echoes aren't conflicts

  useEffect(() => {
    if (value === lastSaved.current || sent.current.has(value)) return;
    if (focused.current) {
      setRemote(value);
    } else {
      setDraft(value);
      lastSaved.current = value;
      setRemote(null);
    }
  }, [value]);

  const flush = async (v) => {
    clearTimeout(timer.current);
    if (v === lastSaved.current) return;
    const previous = lastSaved.current;
    lastSaved.current = v;
    sent.current.add(v);
    if (sent.current.size > 20) sent.current.delete(sent.current.values().next().value);
    setRemote(null);
    setStatus('saving…');
    try {
      await onSave(v);
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? '' : s)), 1500);
    } catch {
      lastSaved.current = previous;
      setStatus('not saved');
    }
  };

  const useTheirs = () => {
    clearTimeout(timer.current);
    setDraft(remote);
    lastSaved.current = remote;
    setRemote(null);
  };

  return (
    <label className="field">
      <span className="field-label">
        {label}
        <span className="save-status">{status}</span>
      </span>
      <textarea
        rows={rows}
        value={draft}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          // Nothing new typed since our last save: show their change instead
          if (remote !== null && draft === lastSaved.current) useTheirs();
          else flush(draft);
        }}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(v), 1000);
        }}
      />
      {remote !== null && (
        <span className="conflict">
          Someone else just changed this. Keep typing to replace their text, or{' '}
          <button
            type="button"
            className="link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={useTheirs}
          >
            use their version
          </button>
          .
        </span>
      )}
    </label>
  );
}

export function Bar({ counts, total }) {
  const cls = ['na', 'ne', 'pe', 'fe'];
  return (
    <div className="bar" title={`Fully ${counts[3]} · Partially ${counts[2]} · Not effective ${counts[1]} · Not assessed ${counts[0]}`}>
      {[3, 2, 1].map((i) => (counts[i] ? <span key={i} className={cls[i]} style={{ width: `${(counts[i] / total) * 100}%` }} /> : null))}
    </div>
  );
}
