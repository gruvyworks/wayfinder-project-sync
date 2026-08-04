import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveFields,
  deriveState,
  isWayfinderIssue,
  modeFor,
  wayfinderType,
  MODE,
  STATE,
  TYPES,
} from './derive-core.mjs';

/** Minimal REST-shaped issue. */
const issue = ({ labels = [], state = 'open', assignees = [] } = {}) => ({
  labels: labels.map((name) => ({ name })),
  state,
  assignees: assignees.map((login) => ({ login })),
});

describe('isWayfinderIssue', () => {
  test('any wayfinder: label makes it ours', () => {
    assert.equal(isWayfinderIssue([{ name: 'wayfinder:task' }]), true);
  });

  test('an unrecognised wayfinder: label is still ours', () => {
    assert.equal(isWayfinderIssue([{ name: 'wayfinder:something-new' }]), true);
  });

  test('unrelated labels are not ours', () => {
    assert.equal(isWayfinderIssue([{ name: 'bug' }, { name: 'p1' }]), false);
  });

  test('no labels at all is not ours', () => {
    assert.equal(isWayfinderIssue([]), false);
    assert.equal(isWayfinderIssue(undefined), false);
  });

  test('a label merely containing "wayfinder" does not count', () => {
    assert.equal(isWayfinderIssue([{ name: 'not-wayfinder:task' }]), false);
  });

  test('accepts bare-string labels as well as objects', () => {
    assert.equal(isWayfinderIssue(['wayfinder:map']), true);
  });
});

describe('wayfinderType', () => {
  for (const type of TYPES) {
    test(`extracts ${type}`, () => {
      assert.equal(wayfinderType([{ name: `wayfinder:${type}` }]), type);
    });
  }

  test('ignores non-wayfinder labels alongside', () => {
    assert.equal(
      wayfinderType([{ name: 'bug' }, { name: 'wayfinder:research' }]),
      'research',
    );
  });

  test('unknown suffix yields null, so we never write an option that does not exist', () => {
    assert.equal(wayfinderType([{ name: 'wayfinder:invented' }]), null);
  });

  test('prefers the first known type when an unknown one comes first', () => {
    assert.equal(
      wayfinderType([{ name: 'wayfinder:invented' }, { name: 'wayfinder:task' }]),
      'task',
    );
  });
});

describe('modeFor', () => {
  test('research is AFK', () => assert.equal(modeFor('research'), MODE.AFK));
  test('prototype is HITL', () => assert.equal(modeFor('prototype'), MODE.HITL));
  test('grilling is HITL', () => assert.equal(modeFor('grilling'), MODE.HITL));
  test('task defaults to HITL', () => assert.equal(modeFor('task'), MODE.HITL));
  test('map is unset', () => assert.equal(modeFor('map'), null));
  test('unknown type is unset', () => assert.equal(modeFor(null), null));
});

describe('deriveState', () => {
  test('open, unassigned, no blockers -> Ready', () => {
    assert.equal(deriveState({ closed: false, hasAssignee: false }), STATE.READY);
  });

  test('assigned -> In progress', () => {
    assert.equal(deriveState({ closed: false, hasAssignee: true }), STATE.IN_PROGRESS);
  });

  test('open blockers -> Blocked', () => {
    assert.equal(
      deriveState({ closed: false, hasAssignee: false, openBlockers: 2 }),
      STATE.BLOCKED,
    );
  });

  test('closed -> Done', () => {
    assert.equal(deriveState({ closed: true, hasAssignee: false }), STATE.DONE);
  });

  test('closed beats assignee and blockers', () => {
    assert.equal(
      deriveState({ closed: true, hasAssignee: true, openBlockers: 3 }),
      STATE.DONE,
    );
  });

  test('assignee beats blockers: someone is actively on it', () => {
    assert.equal(
      deriveState({ closed: false, hasAssignee: true, openBlockers: 3 }),
      STATE.IN_PROGRESS,
    );
  });

  test('zero blockers is not Blocked', () => {
    assert.equal(
      deriveState({ closed: false, hasAssignee: false, openBlockers: 0 }),
      STATE.READY,
    );
  });
});

describe('deriveFields', () => {
  test('non-wayfinder issue is skipped entirely', () => {
    const result = deriveFields(issue({ labels: ['bug'] }));
    assert.equal(result.sync, false);
    assert.deepEqual(result.fields, {});
  });

  test('acceptance #1: new grilling ticket -> grilling / HITL / Ready', () => {
    const { sync, fields } = deriveFields(issue({ labels: ['wayfinder:grilling'] }), {
      writeMode: true,
    });
    assert.equal(sync, true);
    assert.deepEqual(fields, {
      Kind: 'grilling',
      Mode: MODE.HITL,
      Wayfinder: STATE.READY,
    });
  });

  test('acceptance #2: assigning moves it to In progress', () => {
    const { fields } = deriveFields(
      issue({ labels: ['wayfinder:grilling'], assignees: ['gruvycodr'] }),
    );
    assert.equal(fields.Wayfinder, STATE.IN_PROGRESS);
  });

  test('acceptance #3: open blockers move it to Blocked', () => {
    const { fields } = deriveFields(issue({ labels: ['wayfinder:task'] }), {
      openBlockers: 1,
    });
    assert.equal(fields.Wayfinder, STATE.BLOCKED);
  });

  test('acceptance #5: closing moves it to Done', () => {
    const { fields } = deriveFields(
      issue({ labels: ['wayfinder:task'], state: 'closed' }),
    );
    assert.equal(fields.Wayfinder, STATE.DONE);
  });

  test('Mode is written on creation', () => {
    const { fields } = deriveFields(issue({ labels: ['wayfinder:research'] }), {
      writeMode: true,
    });
    assert.equal(fields.Mode, MODE.AFK);
  });

  test('Mode is NOT rewritten on update, so a human override survives', () => {
    const { fields } = deriveFields(issue({ labels: ['wayfinder:task'] }), {
      writeMode: false,
    });
    assert.ok(!('Mode' in fields), 'Mode must be absent on re-derivation');
  });

  test('map gets no Mode even when newly created', () => {
    const { fields } = deriveFields(issue({ labels: ['wayfinder:map'] }), {
      writeMode: true,
    });
    assert.ok(!('Mode' in fields));
    assert.equal(fields.Kind, 'map');
  });

  test('Context is never written', () => {
    for (const writeMode of [true, false]) {
      const { fields } = deriveFields(issue({ labels: ['wayfinder:task'] }), {
        writeMode,
      });
      assert.ok(!('Context' in fields), `Context written when writeMode=${writeMode}`);
    }
  });

  test('unknown type still syncs state but writes no Kind', () => {
    const { sync, fields } = deriveFields(issue({ labels: ['wayfinder:invented'] }), {
      writeMode: true,
    });
    assert.equal(sync, true);
    assert.ok(!('Kind' in fields));
    assert.equal(fields.Wayfinder, STATE.READY);
  });
});
