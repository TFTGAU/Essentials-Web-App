// Scoring rules mirror the ASD workbook's "Data" sheet formulas.

export const RATINGS = ['Not assessed', 'Not effective', 'Partially effective', 'Fully effective'];
export const RATING_NUM = { 'Not assessed': 0, 'Not effective': 1, 'Partially effective': 2, 'Fully effective': 3 };
export const NUM_RATING = ['Not assessed', 'Not effective', 'Partially effective', 'Fully effective'];
export const RATING_CLASS = { 'Not assessed': 'na', 'Not effective': 'ne', 'Partially effective': 'pe', 'Fully effective': 'fe' };
export const LEVEL_NAME = { NE: 'Not effective', PE: 'Partially effective', FE: 'Fully effective' };

export const E8_LEVELS = ['ML0', 'ML1', 'ML2', 'ML3'];
export const E8_OVERRIDES = ['', 'Not assessed', 'Effective', 'Alternate control', 'Ineffective', 'No visibility', 'Not implemented', 'Not applicable'];

export const key = (kind, domain, itemId) => `${kind}|${domain}|${itemId}`;

/** Turn the list of saved responses into a lookup map. */
export function indexResponses(responses) {
  const map = {};
  for (const r of responses) map[key(r.kind, r.domain, r.itemId)] = r;
  return map;
}

export function actionRating(state, domain, actionId) {
  return state[key('action', domain, actionId)]?.data?.rating || 'Not assessed';
}

/** Principle rating = lowest action rating in that principle (Not assessed counts as 0). */
export function principleNumeric(state, domain, principle) {
  if (!principle.actions.length) return 0;
  return Math.min(...principle.actions.map((a) => RATING_NUM[actionRating(state, domain.name, a.id)]));
}

/** Domain stats: principle rating counts and % effective = (0.5*partial + full) / total. */
export function domainStats(state, domain) {
  const counts = [0, 0, 0, 0];
  let actions = 0;
  let assessed = 0;
  for (const p of domain.principles) {
    counts[principleNumeric(state, domain, p)]++;
    for (const a of p.actions) {
      actions++;
      if (actionRating(state, domain.name, a.id) !== 'Not assessed') assessed++;
    }
  }
  const total = domain.principles.length;
  const score = total ? (0.5 * counts[2] + counts[3]) / total : 0;
  return { counts, total, score, actions, assessed, remaining: actions - assessed };
}

/**
 * E8 control status. A control is auto-marked Effective when one of its mitigation
 * strategies is set to a maturity level the control belongs to. (The workbook's own
 * formula skips the strategy check; this applies the behaviour its instructions describe.)
 */
export function e8Statuses(framework, state) {
  const levelFor = (s) => state[key('e8level', '', s)]?.data?.level || 'ML0';
  const out = {};
  for (const c of framework.e8.controls) {
    const auto = c.strategies.some((s) => c.levels.includes(levelFor(s))) ? 'Effective' : 'Not assessed';
    const override = state[key('e8override', '', c.id)]?.data?.override || '';
    const final = override || auto;
    const evidence = ['Effective', 'Alternate control'].includes(final) ? 1 : ['Ineffective', 'Not implemented'].includes(final) ? -1 : 0;
    out[c.id] = { auto, override, final, evidence, notes: state[key('e8override', '', c.id)]?.data?.notes || '' };
  }
  return out;
}

export const pct = (v) => `${Math.round(v * 100)}%`;
