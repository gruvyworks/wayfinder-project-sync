/**
 * Offline test for the view definitions in `scripts/setup-project.sh`.
 *
 * A view that omits `Wayfinder` fails silently and expensively: the sync keeps
 * deriving the field correctly, the API keeps returning the right value, and the
 * board renders as one where nothing ever moves. Nothing at runtime notices, so
 * the guard has to sit on the table itself.
 *
 * The script is parsed rather than executed — running it would provision a real
 * project. Only the `VIEWS` table is read; everything else about the script is
 * verified against the live API, not in unit tests.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const SCRIPT = new URL('../setup-project.sh', import.meta.url);

/** `name|layout|filter|visible fields` -> `{name, layout, fields}`. */
function parseViews(source) {
  const block = source.match(/^VIEWS=\(\n([\s\S]*?)^\)$/m);
  assert.ok(block, 'no VIEWS=( ... ) block in setup-project.sh');

  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"'))
    .map((line) => {
      const [name, layout, , fields = ''] = line.replace(/^"|"$/g, '').split('|');
      return { name, layout, fields: fields.split(',').filter(Boolean) };
    });
}

describe('setup-project.sh views', () => {
  const views = parseViews(readFileSync(SCRIPT, 'utf8'));

  it('parses every view', () => {
    assert.deepEqual(
      views.map((v) => v.name),
      ['All maps', 'All items', 'Board', 'Roadmap', 'My items'],
    );
  });

  // `All maps` is filtered to maps, which are never claimed, and `Roadmap` has
  // no column list at all — a roadmap shows its date fields.
  it('shows Wayfinder on every view that shows tickets', () => {
    for (const view of views) {
      if (view.name === 'All maps' || view.layout === 'ROADMAP_LAYOUT') continue;
      assert.ok(
        view.fields.includes('Wayfinder'),
        `view "${view.name}" does not show Wayfinder: ${view.fields.join(', ')}`,
      );
    }
  });
});
