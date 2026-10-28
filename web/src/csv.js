// CSV helpers for exports. Kept separate so the security tests can check them.

/** Quote a value and neutralise spreadsheet formula injection. */
export const csvCell = (v) => {
  const s = String(v ?? '');
  // A leading = + - @ (even after spaces), tab or carriage return could start a formula
  const safe = /^[\t\r]|^\s*[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
