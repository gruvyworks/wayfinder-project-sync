# wayfinder-project-sync

Makes [wayfinder](https://github.com/mattpocock/skills) issues appear and move themselves on a
GitHub Project board.

Wayfinder charts an effort as a **map** issue plus child **decision ticket** sub-issues. It is
tracker-agnostic and drives everything through plain `gh` calls, which means it already emits an
unambiguous, machine-readable signature. This repo reacts to that signature from the GitHub side.
**The skill is never modified or vendored, and never learns the board exists.**

The board is also a general-purpose work and personal task board — wayfinder items are one citizen
among others, not the whole board.

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

Precedence is: closed beats assigned beats blocked. An assigned-but-blocked ticket reads
`In progress`, because someone is actively on it and that is the more useful signal.

### Fields

| Field | Written by | Notes |
|---|---|---|
| `Status` | **human only** | Built-in. Left exactly as GitHub created it. |
| `Wayfinder` | sync | Ready / Blocked / In progress / Done |
| `Kind` | sync | map / research / prototype / grilling / task |
| `Mode` | sync, **only while unset** | HITL / AFK |
| `Context` | **human only** | personal / work — for filtering views |

Two deliberate choices worth knowing:

- **Wayfinder state is its own field, not extra `Status` options.** `Status` stays simple and
  human-owned, and the built-in "closed → Done" project workflow keeps working untouched. It
  writes `Status`; we write `Wayfinder`. They do not conflict, so leave it enabled.
- **`Mode` is written only while the card has no `Mode` value.** `task` is genuinely ambiguous
  between HITL and AFK — the skill decides per ticket and does not encode it in a label — so it
  gets a default you can override on the card, and once any value is set the sync stops touching
  it. Note this keys on the card's actual value, not on whether the item was just created:
  inferring "new" from the issue's project membership is unreliable, because that snapshot can be
  stale and pages out for an issue on many projects. Getting it wrong silently destroys the
  override, so it is checked directly. `Context` is never written at all.

The type field is called `Kind` rather than the more obvious `Type` because **`Type` is a reserved
field name on organisation-owned projects**, where GitHub's native issue types claim it. A
user-owned project accepts it, so this only surfaces once the board lives in an org.

Field and option IDs are resolved at runtime **by name**, so renaming a field in the UI is safe;
renaming it to something the sync does not know produces a warning and a skipped write, not a crash.

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

It creates the four fields the sync writes (`Wayfinder`, `Kind`, `Mode`, `Context`), the five it
does not (`Priority`, `Size`, `Estimate`, `Start date`, `Target date`), and six views. Then it
prints the two `gh variable set` commands to run afterwards. Those variables are what
`reconcile.yml` reads.

| View | Shows |
|---|---|
| `All maps` | The landing view: one row per effort, filtered to `label:"wayfinder:map"`, sub-issue progress rolling up natively. The label is quoted because the value contains a colon. |
| `All items` | Everything, flat and ungrouped |
| `Board` | Cards in `Status` columns, sorted by `Priority`. Not called `Backlog`: `Status` already has an option by that name. `Priority` is a card field here rather than a swimlane — nothing writes it, so a swimlane axis would be empty for most of the board |
| `Roadmap` | Dates |
| `My items` | `assignee:@me` |
| `Wayfinder lanes` | The wayfinder-native board: `Repository`, `Kind`, `Mode`, `Parent issue` |

**Three clicks are left over, and always will be.** `createProjectV2View` takes a name, a layout
and a set of visible fields; `updateProjectV2View` adds a filter. That is the entire writable
surface. A view's grouping and sorting are readable over the API but have **no mutation input**,
so the script prints them instead:

| View | Set by hand |
|---|---|
| `All maps` | group by `Status` |
| `Board` | sort by `Priority`, ascending |
| `Roadmap` | dates from `Start date` / `Target date` |

Board *columns* need no click: a new `BOARD_LAYOUT` view defaults to grouping by `Status`.

Two things the script deliberately does not do:

- **It never updates a view that already exists**, only creates missing ones. Enforcing the
  configuration on every run would stomp any column you added in the UI — same posture as `Mode`,
  which is written only while unset. Drift is therefore yours to keep, not the script's to correct.
- **It leaves `Status` alone**, so a board it creates has GitHub's default `Todo / In Progress /
  Done` rather than the richer set a template ships. `Status` is human-owned; see above.

The auto-add rule is also not provisionable — only `deleteProjectV2Workflow` exists, with no
create or update counterpart. Set it under *Project → ⚙️ → Workflows → Auto-add to project*.
Enabling it backfills every existing match in one burst, which is a fine way to seed a new board.

### 3. Create the token

`GITHUB_TOKEN` is **not** sufficient — it cannot write to Projects.

Create a **GitHub App** owned by the organisation
(*Settings → Developer settings → GitHub Apps → New*):

- Organization permissions: **Projects — read & write**
- Repository permissions: **Issues — read**, **Metadata — read**
- No webhook needed
- Install it on the organisation, across all repositories that will participate

Generate a private key, then store two secrets in **every participating repo**:
`WAYFINDER_APP_ID` and `WAYFINDER_APP_PRIVATE_KEY`. The workflows exchange them for an
installation token that expires in an hour, so there is no long-lived credential to rotate.

Two things worth knowing:

- **Why an App and not a PAT.** A `Projects` permission exists only for organisation-owned
  projects, in both fine-grained PATs and Apps. A *user-owned* board cannot be driven by either,
  and needs a classic PAT with the broad `repo` scope. Keeping the board in an org is what buys
  least privilege here.
- **Why the secrets are per-repo.** `secrets: inherit` passes the *caller's* secrets, not the
  hub's. Organisation secrets would fix this, but they are not accessible to private repos on
  GitHub Free — that specific limitation is the one thing a Team plan would buy this project.

### 4. Make the hub reachable

Settings → Actions → General → Access → **"Accessible from repositories owned by the user"**.
Required for a private hub to be callable by your other repos.

### 5. Tag it

```
git tag v1 && git push origin v1
```

Stubs reference `@v1`. This is the whole payoff over copy-pasting workflows: fix the derivation
once, every repo picks it up.

### 6. Add a repo

Copy `stub/wayfinder.yml` to `.github/workflows/wayfinder.yml`, add the secret. That's it.

## Reconciliation

GitHub has `issue_dependencies` and `sub_issues` **webhook** events, but **neither is available as
an Actions trigger** — only `issues` is. Since wayfinder wires blocking edges in a second pass
after creating tickets, a freshly charted ticket briefly shows `Ready` before settling to
`Blocked`.

Three mitigations, in order of how much they matter:

1. **Sibling recompute on close/reopen** — covers `Blocked → Ready`, the transition that actually
   happens during a working session. Closing a blocker is the only signal we get.
2. **Hourly reconcile sweep** — corrects everything else.
3. **`workflow_dispatch`** on reconcile, for "fix it now".

Do not move the cron into the stub. It runs here, in a **public** repo, where Actions minutes are
unlimited — roughly 720 runs a month at no cost. Copied into six *private* participating repos it
would be ~4,300 runs against a 2,000 minute budget. That asymmetry is the whole reason reconcile
lives in the hub.

## Using this from another organisation

This hub is public precisely so any organisation can call it — a *private* hub cannot be used
across accounts at all, and public repos also get unlimited Actions minutes, which is what makes
the hourly reconcile free.

**One board per organisation is unavoidable.** A GitHub App, like a fine-grained PAT, is scoped to
a single owner, so a token cannot span two accounts. This is not something the code can fix; it is
why the board and the participating repos must share an owner.

To point a second organisation at its own board:

1. Create its App and board — same permissions, `scripts/setup-project.sh` with
   `PROJECT_OWNER=<org>`.
2. In its stub, pass `project-owner` and `project-number` as inputs to override this hub's
   defaults. No fork required.
3. Add `WAYFINDER_APP_ID` and `WAYFINDER_APP_PRIVATE_KEY` to each participating repo.

Only a fork into a *different hub* needs code edits, and then only the literal `uses:` references
in `.github/workflows/sync.yml` and `stub/wayfinder.yml` — `uses:` cannot be interpolated.
Everything else is a variable.

## Development

```
node --test 'scripts/lib/*.test.mjs'
```

Derivation logic lives in `scripts/lib/derive-core.mjs` and is pure — no network, no `gh`, no
process state — so the whole rule table is covered by fast offline tests. Everything else is
plumbing around it.

Debug a single issue without waiting for an event:

```
PROJECT_NUMBER=1 node scripts/derive.mjs issue owner/repo#123
```

### A note on the API

The original design handoff suggested reading `issue_dependencies_summary.blocked_by` from the
REST issue endpoint.
That field is not actually present on REST issue payloads. GraphQL's
`issueDependenciesSummary { blockedBy }` has exactly the intended semantics — open blockers only,
with `totalBlockedBy` as the all-states count — so the sync uses GraphQL throughout. That also lets
one query fetch labels, state, assignees, blocker count, parent map and project membership
together, so a sync event costs a single round trip.

If GitHub ever changes that field's shape, the sync warns loudly and treats the count as zero
rather than failing — but every card would sit in `Ready`, so the warning is the thing to watch.

## Out of scope

- **Two-way sync.** Strictly GitHub → Project. Moving a card never writes back.
- Modifying or vendoring the wayfinder skill.
- Cross-account support. See "Forking into an organisation".
