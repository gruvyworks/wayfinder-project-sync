# Wayfinder → GitHub Projects sync: the complete guide

Everything about this project in one place: what it is, how it derives board state, how the
pieces fit together, why the design landed where it did, and where the deployment stands. It
supersedes the retired operational handoff and complements the setup-focused
[README.md](../README.md); for a two-minute pitch see [intro.md](intro.md).

## 1. Intent

Keep [wayfinder](https://github.com/mattpocock/skills) map and ticket issues from multiple
repositories synchronized onto one Trello-like GitHub Project — **without modifying or vendoring
the wayfinder skill, and without the skill ever learning the board exists**.

Wayfinder charts an effort as a **map** issue plus child **decision ticket** sub-issues. It is
tracker-agnostic and drives everything through plain `gh` calls, which means it already emits an
unambiguous, machine-readable signature: `wayfinder:*` labels, assignment, sub-issue links, and
native issue dependencies. This repo consumes that signature one-way, from the GitHub side.
Issues stay owned by their source repositories; the org-owned Project is the planning surface.

The board is also a general-purpose work and personal task board. Wayfinder items are one
citizen among others, not the whole board — which shapes several decisions below (human-owned
fields, name-based field resolution, never touching non-wayfinder issues).

## 2. The contract: what the sync reads

The wayfinder skill is the producer; this sync is a pure consumer of four stable signals:

| Signal | Meaning |
|---|---|
| `wayfinder:map` / `wayfinder:<type>` label | The issue is ours to sync; the suffix is its type |
| Assignment | A session claimed the ticket (a session's first write is assigning itself) |
| Native issue dependencies | Blocking edges between tickets |
| Sub-issue parentage | Ticket → map membership; progress rolls up natively on the card |

An issue with *any* `wayfinder:*` label is synced, even if the suffix is unrecognised (a newer
skill version, a typo) — but only known types (`map`, `research`, `prototype`, `grilling`,
`task`) can be written to the `Kind` single-select, since the sync cannot write an option it
did not create. An issue with no `wayfinder:*` label is never added to the board and never
triggers project reads at all.

## 3. The derivation model

### States

The `Wayfinder` field is derived with strict precedence — closed beats assigned beats blocked:

| `Wayfinder` | Condition |
|---|---|
| `Done` | issue closed (even if still assigned or blocked) |
| `In progress` | open and assigned (even if blocked — someone is actively on it, the more useful signal) |
| `Blocked` | open, unassigned, one or more **open** blockers |
| `Ready` | open, unassigned, no open blockers — the frontier |

The open-blocker count comes from GraphQL's `issueDependenciesSummary { blockedBy }`, which
counts open blockers only (`totalBlockedBy` would be the all-states count).

### Fields and ownership

| Field | Written by | Values / notes |
|---|---|---|
| `Status` | **human only** | Built-in; left exactly as GitHub created it |
| `Wayfinder` | sync | `Ready` / `Blocked` / `In progress` / `Done` |
| `Kind` | sync | `map` / `research` / `prototype` / `grilling` / `task` |
| `Mode` | sync, **only while unset** | `HITL` / `AFK` |
| `Context` | **human only** | `personal` / `work`, for filtering views; created by setup, never written |
| `Priority`, `Size`, `Estimate`, `Start date`, `Target date` | **human only** | Created by setup because the views group and sort by them; never read or written by the sync |

Three deliberate choices:

- **Wayfinder state is its own field, not extra `Status` options.** `Status` stays simple and
  human-owned, and GitHub's built-in "closed → Done" project workflow keeps working untouched:
  it writes `Status`, the sync writes `Wayfinder`, and they never conflict. Leave the built-in
  workflow enabled.
- **`Mode` is written only while the card has no `Mode` value.** Mode is implied by type
  (`research` → AFK; `prototype`/`grilling`/`task` → HITL; maps get none), but `task` is
  genuinely ambiguous — the skill decides per ticket and does not encode it in a label. So the
  sync writes a default once and then never touches it again, preserving human overrides.
  Crucially, "unset" is determined by reading the card's *actual* current values, not by
  whether the item was just created: the issue's `projectItems` snapshot can be stale or page
  out for an issue on many projects, and getting it wrong would silently destroy the override.
- **The type field is `Kind`, not the more obvious `Type`,** because `Type` is a reserved field
  name on organisation-owned projects, where GitHub's native issue types claim it. A user-owned
  project accepts it, so this only surfaces once the board lives in an org — which it now does.

Field and option IDs are resolved at runtime **by name**, never hardcoded, because the board is
a live human board where fields may be renamed or reordered. Renaming a field to something the
sync does not know produces a warning and a skipped write, not a crash.

## 4. Architecture

Hub-and-spoke. This repo is the public hub; participating repos carry only a six-line stub.

```
participating repo                          hub (this repo, public)
──────────────────                          ───────────────────────
.github/workflows/wayfinder.yml   ──uses──▶ .github/workflows/sync.yml   (reusable workflow)
  on: issues [opened, labeled,                │  mint App installation token
      unlabeled, (un)assigned,                ▼
      closed, reopened]                     action.yml                    (composite action)
  secrets: inherit                            │
                                              ▼
                                            scripts/derive.mjs            (orchestrator)
                                              │ event | issue | reconcile
                                              ▼
              scripts/lib/derive-core.mjs   pure rules: labels+state → fields
              scripts/lib/github.mjs        GraphQL issue reads (one round trip)
              scripts/lib/project.mjs       Project resolution + field writes
              scripts/lib/gh.mjs            thin gh CLI wrapper

hub only:   .github/workflows/reconcile.yml   hourly sweep + workflow_dispatch
            scripts/setup-project.sh          idempotent board/field creation
            stub/wayfinder.yml                the file repos copy in
```

### Code map

| Path | Role |
|---|---|
| `scripts/lib/derive-core.mjs` | **The single source of truth**: given an issue, what should the card look like. Pure — no network, no `gh`, no process state — so the whole rule table is covered by fast offline tests. Everything else is plumbing. |
| `scripts/lib/github.mjs` | Issue reads via GraphQL. One `IssueCore` fragment fetches labels, state, assignees, open-blocker count, parent map, and project membership in a single round trip. Also fetches open siblings under a map. |
| `scripts/lib/project.mjs` | Project-side plumbing: resolve project and fields by name (cached per process), idempotent `addItem`, read a card's current single-select values, warn-and-skip field writes, paginated board listing. |
| `scripts/derive.mjs` | Entry point with three modes (below). Resolves the project lazily so non-wayfinder issues exit without any board reads. |
| `action.yml` | Composite action. Deliberately skips `setup-node` (the script is dependency-free ESM; runner images ship a new-enough Node) to keep runs seconds shorter against the minutes budget. Event inputs pass through the environment, never interpolated into shell, so issue payloads cannot inject commands. |
| `.github/workflows/sync.yml` | Reusable event workflow. Holds the board's identity (owner/number defaults) so adding a repo never means configuring the board. Gates on a `wayfinder:` label check *before* spending a runner. |
| `.github/workflows/reconcile.yml` | Hourly cron (`17 * * * *`, off the hour to dodge scheduler contention) plus `workflow_dispatch`, under a concurrency group so a sweep and an event sync cannot race on the same card. |
| `stub/wayfinder.yml` | What a participating repo copies to `.github/workflows/wayfinder.yml`. |
| `scripts/setup-project.sh` | One-time, idempotent: creates the board, its fields and its six views — `All maps` first, filtered to `label:"wayfinder:map"` — then prints the `gh variable set` commands the workflows need. Views go through GraphQL (`gh project` has no view commands); it creates missing views and never updates existing ones, so UI tweaks survive a re-run. Grouping and sorting have no mutation input at all and are printed as a three-click manual tail. |

### Execution modes

`derive.mjs` runs in one of three modes:

- **`event`** — from a live `issues` event (`GITHUB_EVENT_PATH`). Syncs the issue's card; on
  `closed`/`reopened` it additionally recomputes all open wayfinder siblings under the same
  map, because closing a blocker is the only signal that its dependents may now be `Ready`.
  Siblings may live in a different repo than the map, which is why the App token is minted for
  the whole installation, not just the calling repo.
- **`reconcile`** — the drift-correction sweep. Merges **two sources**, because neither alone is
  complete: an open-issue label search across the board owner's repos (finds wayfinder issues
  not yet on the board) and the board's current items (finds cards GitHub's "auto-add
  sub-issues" workflow added — a *closed* auto-added card will never see another issue event and
  is invisible to the open-issue search). One bad issue logs a warning and does not abandon the
  sweep; failures are counted and fail the run at the end.
- **`issue`** — sync a single `owner/repo#123` on demand, for debugging:
  `PROJECT_NUMBER=1 node scripts/derive.mjs issue owner/repo#123`.

### Why reconciliation exists at all

GitHub has `issue_dependencies` and `sub_issues` **webhook** events, but neither is available as
an Actions trigger — only `issues` is. Wayfinder wires blocking edges in a second pass after
creating tickets, so a freshly charted ticket briefly shows `Ready` before settling to
`Blocked`. Three mitigations, in order of importance:

1. **Sibling recompute on close/reopen** — covers `Blocked → Ready`, the transition that
   actually happens during a working session.
2. **Hourly reconcile sweep** — corrects everything else.
3. **`workflow_dispatch`** on reconcile, for "fix it now".

The cron lives **only in the hub**, and this is an economics decision: the hub is public, where
Actions minutes are unlimited (~720 runs/month at no cost). The same cron copied into six
private participating repos would be ~4,300 runs against a 2,000-minute monthly budget. Do not
make it more frequent, and do not move it into the stub.

### Failure philosophy

Configuration problems degrade; data problems fail loudly; API drift is announced.

- A missing field or option on the board → warning and a skipped write, not a crash
  (`setup-project.sh` is the fix).
- A malformed `issueDependenciesSummary` → loud warning, then treated as zero blockers, so one
  API change cannot take the whole sync down. The failure mode to watch: every card sitting in
  `Ready` with warnings in the logs.
- One failing issue in a reconcile sweep → logged, the sweep continues, and the run fails at
  the end with a count.

## 5. Authentication

An **organisation-owned GitHub App** authenticates all writes; there is no long-lived PAT
anywhere in the workflows.

- Organization permissions: **Projects — read & write**. Repository permissions: **Issues —
  read**, **Metadata — read**. No webhook. Installed across all participating repos.
- Workflows exchange `WAYFINDER_APP_ID` + `WAYFINDER_APP_PRIVATE_KEY` for an installation token
  that expires in an hour — nothing to rotate.
- **Why an App and not a PAT:** a least-privilege `Projects` permission exists only for
  organisation-owned projects (in both fine-grained PATs and Apps). A *user-owned* board can
  only be driven by a classic PAT with the broad `repo` scope. Keeping the board in an org is
  what buys least privilege.
- **Why the secrets are per-repo:** `secrets: inherit` passes the *caller's* secrets, not the
  hub's. Organisation-level secrets would avoid the copy, but they are not accessible to
  private repos on GitHub Free — that limitation is the one thing a Team plan would buy here.
- **One board per organisation is unavoidable.** An App, like a fine-grained PAT, is scoped to
  a single owner; no token can span two accounts. The board and the participating repos must
  share an owner. A second organisation creates its own App and board and passes
  `project-owner`/`project-number` as stub inputs — no fork needed. Only a fork into a
  *different hub* requires code edits: the literal `uses:` lines in `sync.yml` and
  `stub/wayfinder.yml` (`uses:` cannot be interpolated). Everything else is a variable.

## 6. Setup and operations

Full step-by-step setup is in [README.md](../README.md); in short:

1. `gh auth refresh -s project,read:project` (the `project` scope is not in a default login).
2. `PROJECT_TITLE="Board" ./scripts/setup-project.sh` — idempotent; prints the two
   `gh variable set` commands to run afterwards.
3. Create and install the GitHub App; store the two secrets in every participating repo.
4. Make the hub's workflows reachable (Settings → Actions → Access) if the hub is private.
5. Tag `v1` — stubs reference `@v1`, so the derivation is fixed once and every repo picks it up.
6. Per repo: copy `stub/wayfinder.yml` to `.github/workflows/wayfinder.yml`, add the secrets.

Day-to-day:

```sh
node --test 'scripts/lib/*.test.mjs'                     # 37 offline tests, the whole rule table
PROJECT_NUMBER=1 node scripts/derive.mjs issue o/r#123   # debug one issue without an event
gh workflow run "wayfinder reconcile"                    # force a sweep now
```

For behavior changes: add or update the lowest-seam test first (usually `derive-core.test.mjs`),
run the focused suite, then run one deployed reconciliation as end-to-end verification.

## 7. Deployment state

Implementation complete on `main`, published as `v1`.

- Hub: <https://github.com/gruvyworks/wayfinder-project-sync>
- Project: <https://github.com/orgs/gruvyworks/projects/1> (`Board`)
- Board view: <https://github.com/orgs/gruvyworks/projects/1/views/2> (`Wayfinder lanes`)

Two private multi-repository fixtures (added 2026-08-04) prove the cross-repo path:
[wayfinder-sync-test-2](https://github.com/gruvyworks/wayfinder-sync-test-2) (Atlas map) and
[wayfinder-sync-test-3](https://github.com/gruvyworks/wayfinder-sync-test-3) (Beacon map), each
with one map and four sub-issues covering `Ready`, `In progress`, `Blocked`, and `Done`. A
[deployed reconcile run](https://github.com/gruvyworks/wayfinder-project-sync/actions/runs/30905902149)
populated all ten cards, proving the hub's App can read and reconcile both repositories.

The fixtures deliberately carry no workflow stub or secrets — they participate via the hourly
hub reconciliation only. Event-driven updates for them would require committing
`stub/wayfinder.yml` and configuring the two App secrets in each.

### Open items

1. **UI-only:** the `Wayfinder lanes` view exists, but GitHub's public GraphQL API cannot set a
   view's column or grouping fields. Configure in the UI: columns = `Wayfinder`, group by =
   `Repository`.
2. Decide whether the fixtures need event-driven updates (see above); hourly reconciliation may
   be enough.
3. After the view is configured, exercise a live transition: assign a `Ready` ticket, close a
   blocker, confirm the cards move.

## 8. Decision log

Decisions and dead ends worth knowing before proposing changes:

- **Superseded: private personal hub + PAT.** The original handoff proposed one. User-owned
  Projects cannot use the least-privilege org `Projects` permission, and a private hub cannot
  be consumed across accounts. Hence: public hub, org board, GitHub App (`390d48b`).
- **Superseded: REST `issue_dependencies_summary`.** The originally proposed REST field does
  not exist on issue payloads (verified against live issues). GraphQL's
  `issueDependenciesSummary` has the intended semantics and enables the single-round-trip
  context query, so the sync is GraphQL throughout.
- **`Type` → `Kind` rename** (`390d48b`): `Type` is reserved on org-owned projects.
- **Reconcile merges search + board** (`40ab5e8`): a search-only reconcile missed closed or
  auto-added cards; the two-source merge in §4 is the fix.
- **Mode-preservation keys on the card's value, not item newness**: the `projectItems`
  snapshot is unreliable (stale, pages out), and being wrong silently destroys a human
  override.
- **Consuming wayfinder's existing signature works.** Labels, assignment, sub-issues, and the
  dependency graph form a stable one-way contract; the skill needs no Project awareness.

## 9. Out of scope

- **Two-way sync.** Strictly GitHub → Project; moving a card never writes back.
- Modifying or vendoring the wayfinder skill.
- Cross-account boards (see §5 — structurally impossible with owner-scoped tokens).
