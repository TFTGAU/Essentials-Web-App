import React, { useState } from 'react';

const OPTIONS = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

function read() {
  try {
    return localStorage.getItem('theme') || 'system';
  } catch {
    return 'system';
  }
}

export default function ThemeSwitch() {
  const [theme, setTheme] = useState(read);

  const change = (t) => {
    setTheme(t);
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      if (t === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', t);
    } catch {
      /* storage unavailable: choice lasts for this page only */
    }
  };

  return (
    <select className="theme-switch" value={theme} onChange={(e) => change(e.target.value)} aria-label="Theme">
      {OPTIONS.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
