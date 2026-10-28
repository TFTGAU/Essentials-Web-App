import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const SOURCE = { env: '.env', app: 'App', domain: 'Domain' };

export default function Users({ me }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.get('/users').then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const call = async (fn) => {
    setError('');
    try {
      await fn();
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const add = (e) => {
    e.preventDefault();
    call(async () => {
      await api.post('/users', { email, isAdmin });
      setEmail('');
      setIsAdmin(false);
    });
  };

  const remove = (u) => {
    if (window.confirm(`Remove access for ${u.email}?`)) call(() => api.del(`/users/${encodeURIComponent(u.email)}`));
  };

  return (
    <main className="page">
      <h1>Users</h1>
      <div className="page-meta">
        Only these people can sign in. Users from .env are managed there.
        {data?.allowedDomains?.length > 0 && ` Anyone at ${data.allowedDomains.join(', ')} can also sign in.`}
      </div>

      <form className="row" onSubmit={add} style={{ marginBottom: 16 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: 280 }} />
        <label className="check">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Admin
        </label>
        <button className="btn primary">Add</button>
      </form>
      {error && <div className="alert">{error}</div>}

      {data && (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Source</th>
              <th>Last sign-in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.email}>
                <td>
                  {u.email}
                  {u.name && <span className="muted"> · {u.name}</span>}
                </td>
                <td>{u.is_admin ? 'Admin' : 'User'}</td>
                <td className="muted">{SOURCE[u.source] || u.source}</td>
                <td className="muted">{u.last_login ? new Date(u.last_login).toLocaleString() : '—'}</td>
                <td className="right nowrap">
                  {u.source !== 'env' && u.email !== me.email && (
                    <span className="row" style={{ justifyContent: 'flex-end', gap: 14 }}>
                      <button className="link" onClick={() => call(() => api.post('/users', { email: u.email, isAdmin: !u.is_admin }))}>
                        {u.is_admin ? 'Make user' : 'Make admin'}
                      </button>
                      <button className="link danger" onClick={() => remove(u)}>
                        Remove
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
