# wayfinder-project-sync — project intro

Makes [wayfinder](https://github.com/mattpocock/skills) issues appear and move themselves on a
shared GitHub Project board — without the skill ever knowing the board exists.

## The idea

Wayfinder charts an effort as a **map** issue with child **decision ticket** sub-issues, using
plain `gh` calls and `wayfinder:*` labels. That already forms an unambiguous, machine-readable
signature. This repo reacts to it from the GitHub side: issues stay owned by their source
repositories, the org-owned Project is the planning surface, and the skill is never modified or
vendored. The board doubles as a general work/personal task board — wayfinder items are one
citizen among others.

## What gets derived

| Wayfinder concept | Signal on GitHub | On the board |
|---|---|---|
| Map / ticket | `wayfinder:map` / `wayfinder:<type>` label | `Kind` field |
| Claimed | issue assigned | `Wayfinder = In progress` |
| Blocked | open native issue dependencies | `Wayfinder = Blocked` |
| Frontier | open, unassigned, no open blockers | `Wayfinder = Ready` |
| Resolved | issue closed | `Wayfinder = Done` |

Precedence: closed beats assigned beats blocked. The sync writes only its own fields
(`Wayfinder`, `Kind`, and `Mode` while unset); `Status` and `Context` stay human-owned, so
GitHub's built-in "closed → Done" workflow and manual triage keep working untouched.

## Design decisions worth knowing

- **One public hub, many repos.** Participating repos add a tiny workflow stub referencing the
  hub `@v1`; derivation logic lives in one place. The hourly reconcile sweep also runs in the
  hub because a public repo has unlimited Actions minutes.
- **GitHub App, not a PAT.** An org-owned board is the only kind that supports a least-privilege
  `Projects` permission. The App's short-lived installation tokens mean no credential rotation.
  One consequence: a token can't span two accounts, so it's one board per organisation — a second
  org points the stub at its own board via inputs, no fork needed.
- **Events plus reconciliation.** GitHub Actions has no trigger for dependency or sub-issue
  changes, so event-driven updates are backstopped by sibling recompute on close/reopen, an
  hourly reconcile that merges label search with existing board items, and manual dispatch.
- **Pure derivation core.** The rule table lives in `scripts/lib/derive-core.mjs` with no
  network or process state, covered by a fast offline test suite
  (`node --test 'scripts/lib/*.test.mjs'`).

## Out of scope

Strictly one-way GitHub → Project (moving a card never writes back), no changes to the wayfinder
skill, no cross-account boards.

## Current state

Deployed and verified end-to-end: the hub at
[gruvyworks/wayfinder-project-sync](https://github.com/gruvyworks/wayfinder-project-sync) syncs
into [org Project #1](https://github.com/orgs/gruvyworks/projects/1), with two multi-repo test
fixtures reconciling successfully via the App. Full setup and API notes are in the repo's
README; architecture, operational status, and next steps in [guide.md](../guides/guide.md).
