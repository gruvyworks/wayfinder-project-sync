/**
 * Offline tests for the GraphQL reads that have a paging contract.
 *
 * `findWayfinderIssues` drives the reconcile sweep, and a truncated result is
 * invisible at runtime: the sweep simply stops correcting drift on whatever it
 * did not see. Only the paging is exercised here — the query text itself is
 * verified against the live API, not in unit tests.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findWayfinderIssues } from './github.mjs';

/** A search node as the API returns it. */
const node = (number) => ({
  number,
  repository: { name: 'repo', owner: { login: 'acme' } },
});

/**
 * A fake `ghGraphql` serving `pages` in order, recording the variables it was
 * called with so the cursor hand-off can be asserted.
 */
function fakeGraphql(pages) {
  const calls = [];
  const graphql = async (_query, variables) => {
    calls.push(variables);
    const page = pages[calls.length - 1];
    if (!page) throw new Error(`Unexpected call ${calls.length}: only ${pages.length} page(s)`);
    return {
      search: {
        pageInfo: { hasNextPage: Boolean(page.next), endCursor: page.next ?? null },
        nodes: page.nodes,
      },
    };
  };
  return { graphql, calls };
}

describe('findWayfinderIssues', () => {
  it('returns every issue across multiple pages', async () => {
    const first = Array.from({ length: 100 }, (_, i) => node(i + 1));
    const second = [node(101), node(102)];
    const { graphql } = fakeGraphql([
      { nodes: first, next: 'CURSOR_1' },
      { nodes: second, next: null },
    ]);

    const issues = await findWayfinderIssues('acme', graphql);

    assert.equal(issues.length, 102);
    assert.deepEqual(issues.at(-1), { owner: 'acme', repo: 'repo', number: 102 });
  });

  it('omits the cursor on the first page and passes endCursor on the next', async () => {
    const { graphql, calls } = fakeGraphql([
      { nodes: [node(1)], next: 'CURSOR_1' },
      { nodes: [node(2)], next: null },
    ]);

    await findWayfinderIssues('acme', graphql);

    assert.equal(calls.length, 2);
    // `gh api -F` cannot send a null, so the variable is absent, not empty.
    assert.ok(!('cursor' in calls[0]));
    assert.equal(calls[1].cursor, 'CURSOR_1');
  });

  it('stops after one page when there is nothing more', async () => {
    const { graphql, calls } = fakeGraphql([{ nodes: [node(1)], next: null }]);

    const issues = await findWayfinderIssues('acme', graphql);

    assert.equal(calls.length, 1);
    assert.equal(issues.length, 1);
  });

  it('scopes the search to the board owner and every wayfinder type', async () => {
    const { graphql, calls } = fakeGraphql([{ nodes: [], next: null }]);

    await findWayfinderIssues('growx-tech', graphql);

    assert.match(calls[0].search, /owner:growx-tech/);
    assert.match(calls[0].search, /label:wayfinder:/);
  });

  it('skips nodes that are not issues', async () => {
    const { graphql } = fakeGraphql([{ nodes: [node(1), {}, node(2)], next: null }]);

    const issues = await findWayfinderIssues('acme', graphql);

    assert.deepEqual(
      issues.map((i) => i.number),
      [1, 2],
    );
  });
});
