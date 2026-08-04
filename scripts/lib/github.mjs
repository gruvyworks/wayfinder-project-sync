/**
 * Issue reads, via GraphQL.
 *
 * The original design handoff suggested reading `issue_dependencies_summary.blocked_by` from
 * the REST issue endpoint. That field is not actually present on REST issue
 * payloads — verified against live issues — whereas the GraphQL `Issue` type
 * exposes `issueDependenciesSummary { blockedBy }` with exactly the intended
 * semantics (open blockers; `totalBlockedBy` is the all-states count).
 *
 * GraphQL also lets one query return the labels, state, assignees, blocker
 * count, parent map and project membership together, so a sync event costs a
 * single round trip rather than four.
 */

import { ghGraphql } from './gh.mjs';

/** Emits a GitHub Actions annotation in CI, a plain warning otherwise. */
export function warn(message) {
  const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : 'WARNING: ';
  console.error(`${prefix}${message}`);
}

/** GitHub caps sub-issues at 100 children per parent, so one page is always enough. */
const MAX_SUB_ISSUES = 100;

const ISSUE_CORE = `
  fragment IssueCore on Issue {
    id
    number
    state
    title
    repository { name owner { login } }
    labels(first: 50) { nodes { name } }
    assignees(first: 10) { nodes { login } }
    issueDependenciesSummary { blockedBy }
    projectItems(first: 20) { nodes { id project { id number } } }
  }`;

/**
 * Normalise a GraphQL issue into the shape `derive-core` expects, plus the
 * identifiers the project writer needs.
 *
 * GraphQL returns `state` as the enum `OPEN`/`CLOSED`; `derive-core` works in
 * REST's lowercase, so it is folded here rather than in the pure logic.
 */
function normaliseIssue(node) {
  if (!node || typeof node.number !== 'number') {
    throw new Error(`Malformed issue node: ${JSON.stringify(node)?.slice(0, 300)}`);
  }

  return {
    nodeId: node.id,
    number: node.number,
    title: node.title,
    owner: node.repository.owner.login,
    repo: node.repository.name,
    state: String(node.state).toLowerCase(),
    labels: node.labels?.nodes ?? [],
    assignees: node.assignees?.nodes ?? [],
    openBlockers: openBlockerCount(node),
    projectItems: (node.projectItems?.nodes ?? []).map((item) => ({
      id: item.id,
      projectId: item.project?.id,
      projectNumber: item.project?.number,
    })),
  };
}

/**
 * Count of *open* blockers — the live gate for `Blocked`.
 *
 * If this field ever changes shape, treating it as "no blockers" would silently
 * park every card in `Ready` forever, so drift is announced loudly. We still
 * return 0 so one API change cannot take the whole sync down.
 */
export function openBlockerCount(node) {
  const summary = node.issueDependenciesSummary;
  if (summary == null) return 0; // no dependencies ever set — normal, not drift

  if (typeof summary.blockedBy !== 'number') {
    warn(
      `issueDependenciesSummary.blockedBy missing or non-numeric on #${node.number} ` +
        `(got ${JSON.stringify(summary.blockedBy)}). Treating as 0 blockers — ` +
        `the Blocked state may be wrong until this is fixed.`,
    );
    return 0;
  }
  return summary.blockedBy;
}

/** Everything needed to derive and write one issue's card, in one round trip. */
export async function fetchIssueContext(owner, repo, number) {
  const query = `
    ${ISSUE_CORE}
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          ...IssueCore
          parent { number repository { name owner { login } } }
        }
      }
    }`;

  const data = await ghGraphql(query, { owner, repo, number });
  const node = data?.repository?.issue;
  if (!node) throw new Error(`Issue not found: ${owner}/${repo}#${number}`);

  const parent = node.parent
    ? {
        owner: node.parent.repository.owner.login,
        repo: node.parent.repository.name,
        number: node.parent.number,
      }
    : null;

  return { ...normaliseIssue(node), parent };
}

/**
 * Open siblings of an issue — every other open child of the same map, each with
 * full context so they can be re-derived without further queries.
 *
 * Closing a blocker is the only event telling us its dependents may now be free,
 * and nothing else will notify us, so this is how `Blocked -> Ready` actually
 * happens during a session. Children may live in a different repo than the map,
 * which is why each sibling carries its own owner/repo.
 */
export async function fetchOpenSiblings(issue) {
  if (!issue.parent) return [];

  const query = `
    ${ISSUE_CORE}
    query($owner: String!, $repo: String!, $number: Int!, $limit: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          subIssues(first: $limit) { nodes { ...IssueCore } }
        }
      }
    }`;

  let data;
  try {
    data = await ghGraphql(query, {
      owner: issue.parent.owner,
      repo: issue.parent.repo,
      number: issue.parent.number,
      limit: MAX_SUB_ISSUES,
    });
  } catch (error) {
    warn(
      `Could not list siblings under ${issue.parent.owner}/${issue.parent.repo}` +
        `#${issue.parent.number}: ${error.message}`,
    );
    return [];
  }

  const nodes = data?.repository?.issue?.subIssues?.nodes ?? [];

  return nodes
    .map(normaliseIssue)
    .filter(
      (sibling) =>
        sibling.state === 'open' &&
        !(
          sibling.owner === issue.owner &&
          sibling.repo === issue.repo &&
          sibling.number === issue.number
        ),
    );
}
