import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
}

const SIGNED_OUT = 'ee_signed_out';
const LAST_EMAIL = 'ee_last_email';

function readStore(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeStore(k, v) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

/** Remember who signed in on this browser, so Google can skip the account chooser next time. */
export function rememberEmail(email) {
  writeStore(LAST_EMAIL, email);
}

/** Remember that the user chose to sign out, for the next time the login page loads. */
export function markSignedOut() {
  writeStore(SIGNED_OUT, '1');
  // Forget the account too, so the chooser appears and a different account can be picked
  writeStore(LAST_EMAIL, null);
}

function consumeSignedOutFlag() {
  try {
    const was = localStorage.getItem(SIGNED_OUT) === '1';
    localStorage.removeItem(SIGNED_OUT);
    return was;
  } catch {
    return false;
  }
}

// Google sign-in is set up once per page load; it sends credentials to whichever
// login screen is currently showing.
let gsiReady = false;
let onCredential = null;

export default function Login({ onSignedIn }) {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState('');
  const btnRef = useRef(null);

  useEffect(() => {
    api.get('/config').then(setCfg).catch(() => setError('Could not reach the server.'));
  }, []);

  useEffect(() => {
    if (!cfg?.googleClientId) return;
    loadGsi()
      .then(() => {
        const gid = window.google.accounts.id;
        onCredential = async ({ credential }) => {
          setBusy(true);
          setError('');
          try {
            await api.post('/auth/google', { credential });
            onSignedIn();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        };
        if (gsiReady) {
          gid.renderButton(btnRef.current, { theme: 'outline', size: 'large', text: 'signin_with', width: 310 });
          return;
        }
        gsiReady = true;
        gid.initialize({
          client_id: cfg.googleClientId,
          // Returning users with one Google account signed in are signed in without a click.
          // The button also uses the browser's built-in sign-in (FedCM), so signing in with it
          // counts as a returning user for next time, and can complete without the chooser.
          auto_select: true,
          cancel_on_tap_outside: false,
          use_fedcm_for_prompt: true,
          use_fedcm_for_button: true,
          button_auto_select: true,
          // Pre-select the account last used here (helps browsers without FedCM, e.g. Safari)
          ...(readStore(LAST_EMAIL) ? { login_hint: readStore(LAST_EMAIL) } : {}),
          callback: (response) => onCredential?.(response),
        });
        // After a deliberate sign-out, don't sign straight back in (Google remembers this until the next manual sign-in)
        if (consumeSignedOutFlag()) gid.disableAutoSelect();
        gid.renderButton(btnRef.current, { theme: 'outline', size: 'large', text: 'signin_with', width: 310 });
        gid.prompt();
      })
      .catch((e) => setError(e.message));
  }, [cfg, onSignedIn]);

  const devLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/auth/dev', { email: devEmail });
      onSignedIn();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div>
          <h1>Essentials for Enterprise IT</h1>
          <div className="muted">Assessment</div>
        </div>
        {cfg && !cfg.googleClientId && <div className="alert">GOOGLE_CLIENT_ID is not set on the server.</div>}
        <div ref={btnRef} className="gsi-btn" />
        {busy && <div className="muted">Signing in…</div>}
        {error && <div className="alert">{error}</div>}
        {cfg?.devLogin && (
          <form onSubmit={devLogin} className="dev-login">
            <span className="small muted">Dev login</span>
            <input type="email" placeholder="Email" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} required />
            <button className="btn">Sign in</button>
          </form>
        )}
      </div>
    </div>
  );
}
