import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Login, { markSignedOut, rememberEmail } from './components/Login.jsx';
import Assessment from './components/Assessment.jsx';
import Users from './components/Users.jsx';
import ThemeSwitch from './components/ThemeSwitch.jsx';

/** Tiny hash router: #/overview, #/e8, #/domain/:index, #/settings, #/users */
function useRoute() {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const [me, setMe] = useState(undefined);
  const [framework, setFramework] = useState(null);
  const route = useRoute();

  const loadMe = useCallback(() => {
    api
      .get('/me')
      .then((m) => {
        rememberEmail(m.email);
        setMe(m);
      })
      .catch(() => setMe(null));
  }, []);

  useEffect(loadMe, [loadMe]);
  useEffect(() => {
    const out = () => setMe(null);
    window.addEventListener('signed-out', out);
    return () => window.removeEventListener('signed-out', out);
  }, []);
  useEffect(() => {
    if (me && !framework) api.get('/framework').then(setFramework);
  }, [me, framework]);

  if (me === undefined) return null;
  if (me === null) return <Login onSignedIn={loadMe} />;
  if (!framework) return <div className="center muted">Loading…</div>;

  const signOut = async () => {
    await api.post('/auth/logout');
    markSignedOut();
    window.google?.accounts?.id?.disableAutoSelect?.();
    // Reload so Google sign-in starts fresh (no remembered account, no auto sign-in)
    window.location.replace('/');
  };

  let page;
  if (route[0] === 'users' && me.isAdmin) {
    page = <Users me={me} />;
  } else {
    page = <Assessment view={route[0] || 'overview'} arg={route[1]} framework={framework} me={me} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/overview">
          Essentials<span className="brand-full"> for Enterprise IT</span>
        </a>
        {me.isAdmin && (
          <nav className="topnav">
            <a href="#/overview" className={route[0] !== 'users' ? 'active' : ''}>
              Assessment
            </a>
            <a href="#/users" className={route[0] === 'users' ? 'active' : ''}>
              Users
            </a>
          </nav>
        )}
        <div className="me">
          <ThemeSwitch />
          <span>{me.email}</span>
          <button className="link" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      {page}
    </div>
  );
}
