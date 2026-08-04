# Wayfinder → GitHub Projects sync: operational handoff

## Goal

Keep Wayfinder map and ticket issues from multiple repositories synchronized into one
Trello-like GitHub Project without modifying or vendoring the Wayfinder skill. Issues remain
owned by their source repositories; the shared Project is the planning surface.

The authoritative implementation and setup documentation is [README.md](README.md). Read it
before changing authentication, field semantics, reconciliation, or repository onboarding.

## Current progress

The implementation is complete on `main`, published as `v1`, and matches `origin/main` at
`40ab5e8`.

- `169369c` built the composite action, reusable event workflow, hourly reconciliation,
  idempotent project setup, pure derivation core, and tests.
- `390d48b` moved the design to an organization-owned Project authenticated by a GitHub App,
  and renamed `Type` to `Kind` because `Type` is reserved on organization Projects.
- `40ab5e8` fixed reconciliation to merge search results with existing Project items, ensuring
  closed or auto-added cards are not missed.

The deployed target is:

- Hub: <https://github.com/gruvyworks/wayfinder-project-sync>
- Project: <https://github.com/orgs/gruvyworks/projects/1> (`Board`)
- Board view: <https://github.com/orgs/gruvyworks/projects/1/views/2> (`Wayfinder lanes`)
- Authentication: organization-owned GitHub App; no long-lived PAT in workflows
- Derived fields: `Wayfinder`, `Kind`, and initially-unset `Mode`; human-owned fields such as
  `Status` and `Context` are preserved

Two private multi-repository fixtures were added on 2026-08-04:

- <https://github.com/gruvyworks/wayfinder-sync-test-2> contains the Atlas map.
- <https://github.com/gruvyworks/wayfinder-sync-test-3> contains the Beacon map.

Each fixture has one map and four sub-issues representing `Ready`, `In progress`, `Blocked`,
and `Done`. Both repositories are linked to Project #1. Manual reconciliation populated all
ten cards, and deployed workflow run
<https://github.com/gruvyworks/wayfinder-project-sync/actions/runs/30905902149> completed
successfully, proving the hub's GitHub App can read and reconcile both repositories.

The focused suite currently has 37 passing tests:

```sh
node --test 'scripts/lib/*.test.mjs'
```

## What worked

- Consuming Wayfinder's existing `wayfinder:*` labels, assignment, sub-issues, and dependency
  graph provides a stable one-way contract; the skill needs no Project awareness.
- GitHub GraphQL exposes the open blocker count, parent relationship, issue state, and Project
  membership needed by the sync in one issue-context query.
- Combining open label search with items already on the board makes reconciliation cover both
  newly discovered open issues and closed/auto-added cards.
- Keeping Wayfinder state separate from GitHub's built-in `Status` avoids automation fighting
  the human-facing workflow.
- Reading a card's current `Mode` before deriving fields preserves human HITL/AFK overrides.
- A public hub gives cross-organization callers access and free scheduled Actions minutes,
  while each organization still owns its own board and GitHub App.

## What did not work / constraints

- The original handoff proposed a private personal hub and PAT. That was superseded: user-owned
  Projects cannot use the least-privilege organization `Projects` permission, and private hubs
  cannot be consumed across accounts.
- REST issue payloads do not contain the proposed `issue_dependencies_summary`; the
  implementation uses GraphQL `issueDependenciesSummary`.
- GitHub Actions has no `issue_dependencies` or `sub_issues` trigger. Dependency wiring can
  therefore drift until sibling recomputation, hourly reconciliation, or manual dispatch.
- GitHub's public GraphQL API can create a board view but cannot set its column or horizontal
  grouping fields. The `Wayfinder lanes` view exists, but its final layout must be configured in
  the GitHub UI: columns = `Wayfinder`, group by = `Repository`.
- No browser was available in the session that created the view, so that UI-only step remains.
- The two new fixtures intentionally have no committed reusable-workflow stub or per-repository
  secrets. They participate through the working hourly hub reconciliation. Immediate event-driven
  updates require explicitly committing `stub/wayfinder.yml` and configuring the two App secrets
  in each repository.
- The connected Codex GitHub app did not immediately see the newly created private fixtures;
  authenticated `gh` calls were used to seed them. This did not affect the deployed sync App,
  which was verified by the successful reconciliation run above.

## Next steps

1. Open the `Wayfinder lanes` view and set columns to `Wayfinder` and grouping to `Repository`.
2. Decide whether the two fixtures need event-driven updates. If hourly reconciliation is enough,
   do nothing. Otherwise, explicitly authorize commits, add the reusable workflow stub to both
   repositories, and configure `WAYFINDER_APP_ID` plus `WAYFINDER_APP_PRIVATE_KEY` in each.
3. Exercise a live transition after the view is configured: assign a Ready ticket, close a
   blocker, and confirm the cards move as expected.
4. If code changes are needed, add or update the lowest-seam automated test first, run the focused
   suite, then run one deployed reconciliation for end-to-end verification.

## Suggested skills

- Use `github:github` for inspecting the shared Project, fixture issues, and deployed workflow
  state.
- Use `diagnosing-bugs` if a card derives the wrong state or a reconciliation run fails.
- Use `tdd` for any derivation or reconciliation behavior change.
- Use `github:gh-fix-ci` only if a GitHub Actions check or reconciliation workflow fails.
- Use `handoff` after materially changing deployment, fixture, or operational state.
