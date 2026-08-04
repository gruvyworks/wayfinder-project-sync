#!/usr/bin/env node
/**
 * Entry point for the wayfinder -> GitHub Projects sync.
 *
 *   node derive.mjs event                  # from GITHUB_EVENT_PATH (sync.yml)
 *   node derive.mjs issue owner/repo#123   # one issue, for debugging
 *   node derive.mjs reconcile              # sweep every wayfinder issue (reconcile.yml)
 *
 * Configuration is entirely environment-driven so that forking this hub into an
 * organisation needs no code changes (see README, "Forking into an organisation"):
 *
 *   PROJECT_OWNER   login that owns the board; `@me` for a personal account
 *   PROJECT_NUMBER  the board's number
 *   GH_TOKEN        a token with Projects read & write + Issues read
 */

import { readFile } from 'node:fs/promises';

import { deriveFields, isWayfinderIssue, TYPES } from './lib/derive-core.mjs';
import { fetchIssueContext, fetchOpenSiblings, warn } from './lib/github.mjs';
import { ghGraphql } from './lib/gh.mjs';
import {
  addItem,
  applyFields,
  listItemIssues,
  readSingleSelectValues,
  resolveProject,
} from './lib/project.mjs';

/** Events after which a blocker may have been released. */
const RECOMPUTE_SIBLINGS_ON = new Set(['closed', 'reopened']);

function readConfig() {
  const owner = process.env.PROJECT_OWNER || '@me';
  const number = Number(process.env.PROJECT_NUMBER);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(
      `PROJECT_NUMBER must be a positive integer (got ${JSON.stringify(process.env.PROJECT_NUMBER)})`,
    );
  }
  return { owner, number };
}

/** `owner/repo#123` -> `{owner, repo, number}` */
function parseIssueRef(ref) {
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(ref ?? '');
  if (!match) throw new Error(`Expected owner/repo#123, got: ${ref}`);
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/** Derive and write one issue's card. */
async function syncIssue(project, issue) {
  // Checked before `addItem`, not after: adding the card is a side effect, and a
  // non-wayfinder issue must never appear on the board at all.
  if (!isWayfinderIssue(issue.labels)) return null;

  const { itemId, isNew } = await addItem(project, issue);

  // Read the card's current values rather than trusting `isNew`: `Mode` must be
  // written only when it has no value, or a human's override on a `task` gets
  // silently overwritten on the next event.
  const current = await readSingleSelectValues(itemId);

  const { fields } = deriveFields(issue, {
    openBlockers: issue.openBlockers,
    writeMode: !current.has('Mode'),
  });

  const written = await applyFields(project, itemId, fields);
  const label = `${issue.owner}/${issue.repo}#${issue.number}`;
  console.log(`${isNew ? 'added  ' : 'updated'} ${label}  ${written.join(' ') || '(nothing)'}`);

  return { itemId, fields };
}

async function handleEvent(getProject) {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error('GITHUB_EVENT_PATH is not set');

  const payload = JSON.parse(await readFile(path, 'utf8'));
  const { action, issue, repository } = payload;

  if (!issue || !repository) {
    console.log('Payload has no issue; nothing to do.');
    return;
  }

  // Cheap exit before any project work, so a non-wayfinder issue never touches
  // the board (acceptance criterion #6).
  if (!isWayfinderIssue(issue.labels)) {
    console.log(`#${issue.number} has no wayfinder:* label; skipping.`);
    return;
  }

  const project = await getProject();
  const [owner, repo] = repository.full_name.split('/');
  const context = await fetchIssueContext(owner, repo, issue.number);
  await syncIssue(project, context);

  if (!RECOMPUTE_SIBLINGS_ON.has(action)) return;

  // Closing a blocker is what frees its dependents, and no Actions event fires
  // for the dependency edge itself (docs/guides/guide.md, "Why reconciliation exists").
  const siblings = await fetchOpenSiblings(context);
  const relevant = siblings.filter((s) => isWayfinderIssue(s.labels));

  if (relevant.length) {
    console.log(`Recomputing ${relevant.length} sibling(s) after ${action}:`);
    for (const sibling of relevant) {
      await syncIssue(project, sibling);
    }
  }
}

async function handleIssueRef(getProject, ref) {
  const { owner, repo, number } = parseIssueRef(ref);
  const context = await fetchIssueContext(owner, repo, number);

  if (!isWayfinderIssue(context.labels)) {
    console.log(`${ref} has no wayfinder:* label; skipping.`);
    return;
  }
  await syncIssue(await getProject(), context);
}

/**
 * Every open issue carrying a wayfinder label, across the board owner's repos.
 * This is the drift correction for state changes that produce no Actions event —
 * principally dependency edges being wired up after a ticket is created.
 */
async function findWayfinderIssues(login) {
  const labelFilter = TYPES.map((t) => `wayfinder:${t}`).join(',');
  const search = `is:issue is:open owner:${login} label:${labelFilter}`;

  const query = `
    query($search: String!) {
      search(query: $search, type: ISSUE, first: 100) {
        nodes {
          ... on Issue {
            number
            repository { name owner { login } }
          }
        }
      }
    }`;

  const data = await ghGraphql(query, { search });
  return (data?.search?.nodes ?? [])
    .filter((n) => n?.number)
    .map((n) => ({
      owner: n.repository.owner.login,
      repo: n.repository.name,
      number: n.number,
    }));
}

/** Dedupe key for an `{owner, repo, number}` reference. */
const refKey = (ref) => `${ref.owner}/${ref.repo}#${ref.number}`;

async function handleReconcile(getProject) {
  const project = await getProject();

  // Two sources, because neither alone is complete:
  //   - the search finds wayfinder issues that are not on the board yet
  //   - the board finds items GitHub auto-added, which the search misses when
  //     they are closed (it only matches open issues)
  const [found, onBoard] = await Promise.all([
    findWayfinderIssues(project.login),
    listItemIssues(project),
  ]);

  const byKey = new Map();
  for (const ref of [...found, ...onBoard]) byKey.set(refKey(ref), ref);
  const issues = [...byKey.values()];

  console.log(
    `Reconciling ${issues.length} issue(s) ` +
      `(${found.length} from search, ${onBoard.length} on the board).`,
  );

  let failures = 0;
  for (const ref of issues) {
    try {
      const context = await fetchIssueContext(ref.owner, ref.repo, ref.number);
      await syncIssue(project, context);
    } catch (error) {
      // One bad issue must not abandon the rest of the sweep.
      failures += 1;
      warn(`${ref.owner}/${ref.repo}#${ref.number}: ${error.message}`);
    }
  }

  if (failures) throw new Error(`${failures} issue(s) failed to reconcile`);
}

async function main() {
  const [, , mode = 'event', argument] = process.argv;

  // Resolved lazily and only once. An issue with no wayfinder:* label must exit
  // without reading the board at all, so a repo that opts in to the workflow
  // before the project exists still behaves sanely for its other issues.
  let cached;
  const getProject = async () => {
    if (!cached) {
      const { owner, number } = readConfig();
      cached = await resolveProject(owner, number);
      console.log(`Project "${cached.title}" (${cached.login}/#${cached.number})`);
    }
    return cached;
  };

  switch (mode) {
    case 'event':
      return handleEvent(getProject);
    case 'issue':
      return handleIssueRef(getProject, argument);
    case 'reconcile':
      return handleReconcile(getProject);
    default:
      throw new Error(`Unknown mode: ${mode}. Expected event | issue | reconcile.`);
  }
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
