# Growx-tech deployment handoff

State of the deployment as of 2026-08-05. Provisioned identifiers live here
because they exist only in `growx-tech`, not in this repository's history.

## Provisioned

| Resource | Identity |
| -------- | -------- |
| Project | `growx-tech` **Wayfinder**, number **6** |
| Deployment repository | `growx-tech/wayfinder-project-sync-deploy` (private) |
| Reusable-workflow access | `organization` |
| Tag ruleset | `protect v1` (#20442368) — blocks update and deletion of `refs/tags/v1`, org admins bypass |
| Published reference | `v1` → `a42dc78` |
| Pinned action SHA | `660d040e4e36d43c948e8ebdd1b104f67f5374ef` |

Phase 1 passes in full. `growx-tech` is on the **team** plan, so organisation
secrets reach private repositories and private reusable workflows are
shareable; organisation Actions policy is `enabled_repositories: all` with
`allowed_actions: all`, so neither the shared action nor
`actions/create-github-app-token` needs an allowlist entry, and SHA pinning is
permitted but not required.

Both organisation variables exist, scoped to the deployment repository
(`1323808407`) alone. Each pilot must be added to
`selected_repository_ids` as it onboards.

The pinned SHA includes the paged reconcile search — `findWayfinderIssues` in
`scripts/lib/github.mjs` loops on `pageInfo.hasNextPage`. The hub's own `v1`
tag is stale at `40ab5e8` and was deliberately not used.

`Kind` rather than `Type`: `Type` is reserved on organisation-owned Projects.
`scripts/setup-project.sh` already accounts for this, so no change was needed
moving from the user-owned hub board to an organisation board.

## Participating repositories

| Repository | Id | Role |
| ---------- | -- | ---- |
| `growx-tech/wayfinder-project-sync-deploy` | `1323808407` | deployment, runs the sweep |
| `growx-tech/growy-ml-lab` | `1318371793` | pilot |
| `growx-tech/growy-datalake-agent` | `1321857004` | pilot |

Both organisation variables are scoped to exactly these three. The GitHub App
is `growy-wayfinder-sync`, installation `151425579`, `selected` scope.

Phase 4 caller workflows are open as `growx-tech/growy-ml-lab#20` and
`growx-tech/growy-datalake-agent#14`, both byte-identical.

## Verification so far

A dispatched `reconcile.yml` run
([30999810200](https://github.com/growx-tech/wayfinder-project-sync-deploy/actions/runs/30999810200))
completed green and proved the whole credential path: token minted at
`owner: growx-tech`, the pinned SHA executed, the board resolved as
`Wayfinder (growx-tech/#6)` from the organisation variables, and both pilots
were read and written by a single token — the cross-repository path. No
credentials appear in the logs.

It also backfilled the board with the 25 pre-existing Wayfinder issues in the
two pilots. That was not anticipated; the sweep is not a read-only operation
and any dispatch against a populated organisation will add cards.

The same run confirmed that installation scope bounds the sweep. Thirty-six
Wayfinder issues exist across `growx-tech`; the eleven in `growy-seed-counter`
were excluded because the App is not installed there. Installing on "All
repositories" would have put them on the board, hourly, without that repository
opting in.

The caller workflow is byte-identical in both pilots, confirmed by blob SHA
`4dc4b102a0f5e58c1f62185a66025e4e42b6aa72` rather than by reading.

The event path was then verified end to end with temporary
`[deployment smoke test]` issues, since removed from the board:

| Criterion | Evidence |
| --------- | -------- |
| non-Wayfinder issues ignored | unlabelled issue → job `skipped` |
| unassigned, unblocked → `Ready` | adding `wayfinder:task` added the card as `Ready` |
| assignment → `In progress` | verified |
| open blocker → `Blocked` | verified |
| closing → `Done` | verified |
| closing a blocker releases its dependent | `Recomputing 1 sibling(s) after closed` → dependent `Blocked` → `Ready` |
| `Mode` override survives | hand-set `AFK` survived a re-derivation that changed `Wayfinder` |
| reconciliation repairs drift | a stale `Blocked` card repaired to `Ready` by a dispatched sweep |
| logs expose no credentials | verified across both workflows |

Sibling recompute walks the **sub-issues of a shared parent map**
(`fetchOpenSiblings` in `scripts/lib/github.mjs:189` returns `[]` without a
parent), not arbitrary dependency edges. Two orphan issues joined only by a
`blocked_by` edge will not recompute each other on close; that drift waits for
the sweep. This is by design, and worth knowing before reading a "release"
failure as a bug.

Still unevidenced: a cron-triggered sweep. Only `workflow_dispatch` has run, and
verifying the schedule unattended was deliberately skipped.

## Deviations from the plan

**Phase 2 step 4, the Project auto-add workflow, was deliberately not enabled.**
The plan specified it before the deployment existed; the verification above
supersedes its rationale.

It adds nothing. The event path already adds a map the moment it is opened or
labelled, and the sweep adds every Wayfinder issue within the hour. Auto-add's
only unique coverage is a repository holding the App and the variables but no
caller workflow — a state Phase 6 never produces.

It also degrades what it adds. Auto-add can add a card but cannot write fields,
so a map arriving that way lands with `Wayfinder`, `Kind`, and `Mode` empty
until a later sweep fills them. In the one race auto-add wins, the result is a
blank card where the event path would have produced a complete one.

Finally it splits the definition of what belongs on the board between the
derivation in this repository and a filter maintained in the Projects UI —
outside review, outside git history, and silent when the two disagree.

Revisit only if a repository is ever expected to feed the board without a
caller workflow. Phase 5's "the auto-add rule imported no non-Wayfinder issues"
is satisfied vacuously.

## Related

Routing different repositories to different boards was never considered by this
plan, and is not possible without an upstream change — the reconcile search is
scoped by owner, not by repository set. See
[`2026-08-05-per-repository-board-routing`](../../active/2026-08-05-per-repository-board-routing/idea.md).

## Outstanding

1. Confirm one cron-triggered sweep. Only `workflow_dispatch` has run.
   `reconcile.yml` fires `17 6-16 * * 1-5` UTC; any run in the deployment
   repository with event `schedule` settles this.

## Deferred

**Phase 2 step 3, the manual Project view settings, was not applied**: group
`All maps` by `Status`, sort `Board` by `Priority` ascending, and point
`Roadmap` at `Start date` / `Target date`. Confirmed unset — `groupByFields`
and `sortByFields` are empty on all five views.

These have no mutation API, so they are UI-only, and the current Projects
interface did not expose the controls where expected. Deferred as a
forward-fix: they affect only how a human reads the board, never what the sync
derives or writes. Nothing else in this deployment depends on them.

`Priority`, `Start date`, and `Target date` are not written by the sync at all,
so a `Board` sorted by `Priority` and a populated `Roadmap` both stay empty
until someone fills those fields by hand regardless.
