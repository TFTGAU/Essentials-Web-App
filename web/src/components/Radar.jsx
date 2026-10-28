import React, { useState } from 'react';
import { pct } from '../scoring.js';

const W = 560;
const H = 460;
const CX = W / 2;
const CY = H / 2 + 4;
const R = 150;
const RINGS = [0.2, 0.4, 0.6, 0.8, 1];

/** Split a label into lines of roughly `max` characters. */
function wrap(text, max = 18) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Radar chart of % effective per domain (mirrors the workbook's Domain Summary chart).
 * points: [{ name, value (0..1), detail, href, muted }]
 */
export default function Radar({ points }) {
  const [hover, setHover] = useState(null);
  const n = points.length;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i, r) => [CX + Math.cos(angle(i)) * r, CY + Math.sin(angle(i)) * r];
  const ring = (f) => points.map((_, i) => at(i, R * f).join(',')).join(' ');
  const shape = points.map((p, i) => at(i, R * Math.max(0, Math.min(1, p.value))).join(',')).join(' ');

  return (
    <div className="radar">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Percent effective by domain">
        {/* grid */}
        {RINGS.map((f) => (
          <polygon key={f} points={ring(f)} className="radar-grid" />
        ))}
        {points.map((_, i) => {
          const [x, y] = at(i, R);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} className="radar-grid" />;
        })}
        {RINGS.map((f) => (
          <text key={f} x={CX + 4} y={CY - R * f + 4} className="radar-tick">
            {f * 100}%
          </text>
        ))}

        {/* data */}
        <polygon points={shape} className="radar-area" />
        {points.map((p, i) => {
          const [x, y] = at(i, R * Math.max(0, Math.min(1, p.value)));
          return <circle key={i} cx={x} cy={y} r={hover === i ? 5.5 : 4} className="radar-dot" />;
        })}

        {/* labels */}
        {points.map((p, i) => {
          const [x, y] = at(i, R + 18);
          const anchor = Math.abs(x - CX) < 4 ? 'middle' : x > CX ? 'start' : 'end';
          const lines = wrap(p.name);
          // Each label is the name lines plus a value line, 14px apart
          const dy = y < CY - R * 0.5 ? -lines.length * 14 : y > CY + R * 0.5 ? 10 : -(lines.length * 14) / 2 + 4;
          return (
            <a key={p.name} href={p.href}>
              <text x={x} y={y + dy} textAnchor={anchor} className={`radar-label ${p.muted ? 'muted' : ''}`}>
                {lines.map((l, j) => (
                  <tspan key={j} x={x} dy={j ? 14 : 0}>
                    {l}
                  </tspan>
                ))}
                <tspan x={x} dy={14} className="radar-value">
                  {p.muted ? 'out of scope' : pct(p.value)}
                </tspan>
              </text>
            </a>
          );
        })}

        {/* hover targets, larger than the marks */}
        {points.map((p, i) => {
          const [x, y] = at(i, R * Math.max(0, Math.min(1, p.value)));
          return (
            <a key={p.name} href={p.href}>
              <circle cx={x} cy={y} r={14} className="radar-hit" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <title>{`${p.name}: ${pct(p.value)}`}</title>
              </circle>
            </a>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${(at(hover, R * points[hover].value)[0] / W) * 100}%`,
            top: `${(at(hover, R * points[hover].value)[1] / H) * 100}%`,
          }}
        >
          <div className="tip-title">{points[hover].name}</div>
          <div>
            <b>{pct(points[hover].value)}</b> effective
          </div>
          <div className="muted">{points[hover].detail}</div>
        </div>
      )}
    </div>
  );
}
