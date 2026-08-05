# wayfinder-project-sync

Makes [wayfinder](https://github.com/mattpocock/skills) issues appear and move themselves on a
GitHub Project board. Strictly one-way, GitHub → Project. **The skill is never modified or
vendored, and never learns the board exists.**

Wayfinder charts an effort as a **map** issue plus child **decision ticket** sub-issues, driving
everything through plain `gh` calls — which means it already emits an unambiguous,
machine-readable signature. This repo is the public **hub** that reacts to that signature:
participating repositories carry only a six-line workflow stub, and all derivation logic lives
here. The board is also a general-purpose work and personal task board — wayfinder items are one
citizen among others, not the whole board.

## What gets derived

| Wayfinder concept | On GitHub | On the board |
|---|---|---|
| Map | issue labelled `wayfinder:map` | `Kind = map`; sub-issue progress rolls up natively |
| Ticket | sub-issue of the map, labelled `wayfinder:<type>` | `Kind = research \| prototype \| grilling \| task` |
| HITL / AFK | implied by type | `Mode` |
| Claimed | assigned — a session's first write | `Wayfinder = In progress` |
| Blocked | native issue dependencies | `Wayfinder = Blocked` |
| Frontier | open, unassigned, no open blockers | `Wayfinder = Ready` |
| Resolved | issue closed | `Wayfinder = Done` |

Precedence is: closed beats assigned beats blocked. The sync writes `Wayfinder` and `Kind`, plus
`Mode` only while the card has no `Mode` value; `Status` and `Context` are human-owned and never
written. Field and option IDs are resolved at runtime **by name**, so renaming a field in the UI
is safe. The full derivation model and the reasoning behind each of those choices are in
[docs/guides/guide.md](docs/guides/guide.md).

## Prerequisites

- [`gh`](https://cli.github.com) and `jq`, for `scripts/setup-project.sh`.
- Node.js — the scripts are dependency-free ESM with no install step (verified on Node 24). CI
  uses the runner image's Node and skips `setup-node` entirely.

## Setup

### 1. Grant the `project` scope

A normal `gh auth login` does not include it:

```
gh auth refresh -s project,read:project
```

### 2. Create the board, its fields and its views

Idempotent — safe to re-run.

```
PROJECT_OWNER="my-org" PROJECT_TITLE="Board" ./scripts/setup-project.sh
```

It creates the three fields the sync writes (`Wayfinder`, `Kind`, `Mode`), the six it never
writes (`Context`, `Priority`, `Size`, `Estimate`, `Start date`, `Target date`), and five views:

| View | Shows |
|---|---|
| `All maps` | The landing view: one row per effort, filtered to `label:"wayfinder:map"`, sub-issue progress rolling up natively |
| `All items` | Everything, flat and ungrouped, carrying the wayfinder-native fields `Repository`, `Kind` and `Mode` |
| `Board` | Cards in `Status` columns, sorted by `Priority` |
| `Roadmap` | Dates |
| `My items` | `assignee:@me` |

It then prints the two `gh variable set` commands to run afterwards, setting `PROJECT_OWNER` and
`PROJECT_NUMBER` on this repo. Those are what `reconcile.yml` reads.

Three things the script cannot or will not do:

- **Grouping and sorting have no mutation input at all**, so they stay manual. The script prints
  the three settings to apply by hand when it finishes.
- **The auto-add rule is not provisionable** either — only `deleteProjectV2Workflow` exists, with
  no create or update counterpart. Set it under *Project → ⚙️ → Workflows → Auto-add to project*.
  Enabling it backfills every existing match in one burst, a fine way to seed a new board.
- **It never updates a view that already exists**, only creates missing ones, so a column you
  added in the UI survives a re-run. Drift is yours to keep, not the script's to correct.

### 3. Create the token

`GITHUB_TOKEN` is **not** sufficient — it cannot write to Projects.

Create a **GitHub App** owned by the organisation
(*Settings → Developer settings → GitHub Apps → New*):

- Organization permissions: **Projects — read & write**
- Repository permissions: **Issues — read**, **Metadata — read**
- No webhook needed
- Install it on the organisation, across all repositories that will participate

Generate a private key, then store two secrets in **every participating repo**:
`WAYFINDER_APP_ID` and `WAYFINDER_APP_PRIVATE_KEY`. They must be per-repo because
`secrets: inherit` passes the *caller's* secrets, not the hub's. The workflows exchange them for
an installation token that expires in an hour, so there is no long-lived credential to rotate.
Why an App rather than a PAT, and why the board has to be org-owned, is in
[docs/guides/guide.md](docs/guides/guide.md).

### 4. Make the hub reachable

Only if your hub is private: Settings → Actions → General → Access →
**"Accessible from repositories owned by the user"**. Required for a private hub to be callable
by your other repos.

### 5. Tag it

```
git tag v1 && git push origin v1
```

Stubs reference `@v1`. This is the whole payoff over copy-pasting workflows: fix the derivation
once, every repo picks it up.

### 6. Add a repo

Copy `stub/wayfinder.yml` to `.github/workflows/wayfinder.yml`, add the two secrets. That's it.

## Reconciliation

GitHub has `issue_dependencies` and `sub_issues` **webhook** events, but neither is available as
an Actions trigger — only `issues` is. Since wayfinder wires blocking edges in a second pass
after creating tickets, a freshly charted ticket briefly shows `Ready` before settling to
`Blocked`. Three backstops close the gap: sibling recompute on close/reopen (the transition that
actually happens during a session), a reconcile sweep every hour through the working day, and
`workflow_dispatch` on that sweep for "fix it now".

The sweep runs `17 4-18 * * *`. Actions cron is UTC and ignores DST, so that window is picked to
land inside 05:00–20:00 Europe/Amsterdam under both offsets — 06:17–20:17 CEST, 05:17–19:17 CET.
Nothing sweeps overnight; the first morning run clears any drift, and `workflow_dispatch` covers
impatience.

The cron lives **only in the hub**, and that is an economics decision: a public repo has
unlimited Actions minutes, where the same cron copied into six private repos would be ~2,700 runs
against the 2,000-minute budget a Free plan allows (Team: 3,000). Do not make it more frequent,
and do not move it into the stub.

## Using this from another organisation

This hub is public precisely so any organisation can call it — a *private* hub cannot be used
across accounts at all. **One board per organisation is unavoidable:** a GitHub App, like a
fine-grained PAT, is scoped to a single owner, so the board and its participating repos must
share one.

1. Create its App and board — same permissions, `scripts/setup-project.sh` with
   `PROJECT_OWNER=<org>`.
2. In its stub, pass `project-owner` and `project-number` as inputs to override this hub's
   defaults. No fork required.
3. Add `WAYFINDER_APP_ID` and `WAYFINDER_APP_PRIVATE_KEY` to each participating repo.

Only a fork into a *different hub* needs code edits, and then only the literal `uses:` references
in `.github/workflows/sync.yml` and `stub/wayfinder.yml` — `uses:` cannot be interpolated.
Everything else is a variable.

## Repository layout

| Path | Role |
|---|---|
| `scripts/lib/derive-core.mjs` | The rule table: given an issue, what the card should look like. Pure — no network, no `gh`, no process state. |
| `scripts/lib/github.mjs` | GraphQL issue reads; one round trip fetches labels, state, assignees, blockers, parent and project membership. |
| `scripts/lib/project.mjs` | Project resolution and field writes, resolved by name at runtime. |
| `scripts/lib/gh.mjs` | Thin `gh` CLI wrapper. |
| `scripts/derive.mjs` | Entry point; modes `event`, `issue`, `reconcile`. |
| `scripts/setup-project.sh` | One-time, idempotent board, field and view creation. |
| `action.yml` | The composite action the workflows call. |
| `.github/workflows/sync.yml` | Reusable event workflow; holds the board's identity. |
| `.github/workflows/reconcile.yml` | Waking-hours sweep plus `workflow_dispatch`. Hub only. |
| `stub/wayfinder.yml` | The file a participating repo copies in. |
| `docs/` | Reference, guides and change records — see [Documentation](#documentation). |

## Development

```
node --test 'scripts/lib/*.test.mjs'
```

Derivation logic lives in `scripts/lib/derive-core.mjs` and is pure, so the whole rule table is
covered by fast offline tests. Everything else is plumbing around it.

Debug a single issue without waiting for an event:

```
PROJECT_OWNER=my-org PROJECT_NUMBER=1 node scripts/derive.mjs issue owner/repo#123
```

Force a reconcile sweep now:

```
gh workflow run "wayfinder reconcile"
```

## Documentation

- [docs/reference/intro.md](docs/reference/intro.md) — the two-minute pitch.
- [docs/guides/guide.md](docs/guides/guide.md) — the complete guide: derivation model, code map,
  execution modes, authentication, failure philosophy, deployment state and decision log.
- [docs/changes/README.md](docs/changes/README.md) — this repository's documentation layout and
  lifecycle rules.
- [AGENTS.md](AGENTS.md) — agent instructions.

## Out of scope

- **Two-way sync.** Strictly GitHub → Project. Moving a card never writes back.
- Modifying or vendoring the wayfinder skill.
- Cross-account boards — structurally impossible with owner-scoped tokens. See
  [Using this from another organisation](#using-this-from-another-organisation).
