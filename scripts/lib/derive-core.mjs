/**
 * Pure derivation logic. No network, no gh, no process state.
 *
 * This is the single source of truth for "given an issue, what should the
 * project card look like". Everything else in this repo is plumbing around it.
 */

export const WAYFINDER_LABEL_RE = /^wayfinder:(.+)$/;

/** Values of the project's `Type` single-select. */
export const TYPES = ['map', 'research', 'prototype', 'grilling', 'task'];

/** Values of the project's `Wayfinder` single-select. */
export const STATE = {
  READY: 'Ready',
  BLOCKED: 'Blocked',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};

/** Values of the project's `Mode` single-select. */
export const MODE = { HITL: 'HITL', AFK: 'AFK' };

/**
 * Labels arrive as `[{name}]` from webhooks and `["name"]` from some gh output.
 * @returns {string[]} label names
 */
function labelNames(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((l) => (typeof l === 'string' ? l : l?.name))
    .filter((n) => typeof n === 'string');
}

/** The `<x>` of every `wayfinder:<x>` label, in the order GitHub returned them. */
export function wayfinderSuffixes(labels) {
  return labelNames(labels)
    .map((n) => n.match(WAYFINDER_LABEL_RE)?.[1])
    .filter(Boolean);
}

/** Any `wayfinder:*` label at all means the issue is ours to sync. */
export function isWayfinderIssue(labels) {
  return wayfinderSuffixes(labels).length > 0;
}

/**
 * The first suffix that is a known Type. An issue may carry an unrecognised
 * `wayfinder:*` label (a newer skill version, a typo) — that still makes it
 * ours, but we cannot write a single-select option we did not create.
 * @returns {string|null}
 */
export function wayfinderType(labels) {
  return wayfinderSuffixes(labels).find((s) => TYPES.includes(s)) ?? null;
}

/**
 * HITL/AFK is implied by type. `task` is genuinely ambiguous — the skill decides
 * per ticket and does not encode it in a label — so it gets a default the human
 * may override on the card. Never infer it from the issue body.
 * @returns {string|null} null means "leave unset"
 */
export function modeFor(type) {
  switch (type) {
    case 'research':
      return MODE.AFK;
    case 'prototype':
    case 'grilling':
    case 'task':
      return MODE.HITL;
    default:
      return null; // map, or unknown
  }
}

/**
 * Precedence matters: a closed issue is Done even if it still has an assignee
 * or open blockers, and an assigned issue is In progress even if blocked —
 * someone is actively on it, which is the more useful signal on a board.
 */
export function deriveState({ closed, hasAssignee, openBlockers = 0 }) {
  if (closed) return STATE.DONE;
  if (hasAssignee) return STATE.IN_PROGRESS;
  if (openBlockers > 0) return STATE.BLOCKED;
  return STATE.READY;
}

/**
 * Everything the sync should write for one issue.
 *
 * @param {object} issue        REST-shaped issue (`state`, `assignees`, `labels`)
 * @param {number} openBlockers open blocker count
 * @param {boolean} writeMode   whether `Mode` may be written — true only when the
 *                              card has no `Mode` value yet
 * @returns {{sync: boolean, fields: Record<string,string>, type: string|null}}
 *
 * `fields` is deliberately sparse: a key is absent when we must not write it.
 * `Mode` is present only when the card has no value for it, so re-derivation
 * never stomps a human's override on a `task`. `Context` is never written.
 *
 * Note this is keyed on the card's *actual* state rather than on whether we just
 * created the item. Inferring "new" from the issue's project membership is
 * unreliable — that snapshot can be stale, or page out when an issue belongs to
 * many projects — and being wrong there silently destroys the override.
 */
export function deriveFields(issue, { openBlockers = 0, writeMode = false } = {}) {
  if (!isWayfinderIssue(issue.labels)) {
    return { sync: false, fields: {}, type: null };
  }

  const type = wayfinderType(issue.labels);
  const fields = {
    Wayfinder: deriveState({
      closed: issue.state === 'closed',
      hasAssignee: (issue.assignees ?? []).length > 0,
      openBlockers,
    }),
  };

  if (type) fields.Type = type;

  if (writeMode) {
    const mode = modeFor(type);
    if (mode) fields.Mode = mode;
  }

  return { sync: true, fields, type };
}
