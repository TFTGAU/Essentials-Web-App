import React, { useState } from 'react';

/** Work out what kind of file a link points to, from its URL. */
export function linkKind(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { tag: 'Link', name: url };
  }
  const host = u.hostname.replace(/^www\./, '');
  const p = u.pathname;
  if (host === 'docs.google.com') {
    if (p.startsWith('/document')) return { tag: 'Doc', name: 'Google Doc' };
    if (p.startsWith('/spreadsheets')) return { tag: 'Sheet', name: 'Google Sheet' };
    if (p.startsWith('/presentation')) return { tag: 'Slides', name: 'Google Slides' };
    if (p.startsWith('/forms')) return { tag: 'Form', name: 'Google Form' };
  }
  if (host === 'drive.google.com') {
    if (p.includes('/folders/')) return { tag: 'Folder', name: 'Drive folder' };
    return { tag: 'Drive', name: 'Drive file' };
  }
  if (/\.pdf$/i.test(p)) return { tag: 'PDF', name: decodeURIComponent(p.split('/').pop()) };
  return { tag: 'Link', name: host + (p.length > 1 ? p : '') };
}

/**
 * List of evidence links with an "Add link" form.
 * onAdd({ url, title }) and onRemove(id) should return promises that reject with a message.
 */
export default function Links({ links = [], onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setAdding(false);
    setUrl('');
    setTitle('');
    setError('');
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!url.trim()) return setError('Paste a link first.');
    setBusy(true);
    setError('');
    try {
      await onAdd({ url: url.trim(), title: title.trim() });
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (l) => {
    try {
      await onRemove(l.id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="links">
      {links.length > 0 && (
        <ul className="link-list">
          {links.map((l) => {
            const k = linkKind(l.url);
            return (
              <li key={l.id}>
                <span className={`link-tag tag-${k.tag.toLowerCase()}`}>{k.tag}</span>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${l.url}${l.addedBy ? `\nAdded by ${l.addedBy}${l.addedAt ? `, ${new Date(l.addedAt).toLocaleString()}` : ''}` : ''}`}
                >
                  {l.title || k.name}
                </a>
                <button type="button" className="link-remove" onClick={() => remove(l)} aria-label={`Remove link ${l.title || k.name}`} title="Remove link">
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <div className="link-add">
          <input
            type="url"
            placeholder="Paste a Drive or web link"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(e);
              if (e.key === 'Escape') reset();
            }}
          />
          <input
            type="text"
            placeholder="Name (optional)"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit(e);
              if (e.key === 'Escape') reset();
            }}
          />
          <button type="button" className="btn small primary" onClick={submit} disabled={busy}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="link small" onClick={reset}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="link small" onClick={() => setAdding(true)}>
          + Add link
        </button>
      )}
      {error && <div className="link-error">{error}</div>}
    </div>
  );
}
