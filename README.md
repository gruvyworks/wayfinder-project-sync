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
| Map | issue labelled `wayfinder:map` | `Type = map`; sub-issue progress rolls up natively |
| Ticket | sub-issue of the map, labelled `wayfinder:<type>` | `Type = research \| prototype \| grilling \| task` |
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
| `Type` | sync | map / research / prototype / grilling / task |
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

Field and option IDs are resolved at runtime **by name**, so renaming a field in the UI is safe;
renaming it to something the sync does not know produces a warning and a skipped write, not a crash.

## Setup

### 1. Grant the `project` scope

A normal `gh auth login` does not include it:

```
gh auth refresh -s project,read:project
```

### 2. Create the board and its fields

Idempotent — safe to re-run.

```
PROJECT_TITLE="Board" ./scripts/setup-project.sh
```

It prints the two `gh variable set` commands to run afterwards. Those variables are what
`reconcile.yml` reads.

### 3. Create the token

A fine-grained PAT. `GITHUB_TOKEN` is **not** sufficient — it cannot write to Projects.

- Account permissions: **Projects — read & write**
- Repository permissions: **Issues — read**, **Metadata — read**

Store it as `WAYFINDER_PROJECT_TOKEN` in the hub **and in every participating repo**.
`secrets: inherit` passes the *caller's* secrets, not the hub's, so there is no way around the
per-repo copy on a personal account.

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

Do not make the cron more frequent than hourly, and do not move it into the stub. One hourly cron
is ~720 runs/month against GitHub Free's 2,000 minutes; copied into six repos it would be ~4,300.

## Forking into an organisation

Cross-account sync is not possible: the stub must live in the org's repos, a private personal hub
cannot be called by another account, and fine-grained PATs are scoped to a single owner. The
supported answer is a **second copy of this hub inside the org**, feeding an **org-owned** project.

Note that this gives you two boards, and that is inherent — an org-owned project cannot merge into
a personal one. It is not something the code can fix.

Four deltas:

1. `PROJECT_OWNER` — set the repo variable to the org login instead of `@me`.
2. Run `scripts/setup-project.sh` with `PROJECT_OWNER=<org>` to create the org-owned board.
3. `.github/workflows/sync.yml` and `stub/wayfinder.yml` — update the literal `gruvycodr/...`
   references. `uses:` cannot be interpolated, so these cannot be made dynamic.
4. Install the token as an **org-level** secret rather than per-repo.

No logic changes. Everything account-specific is either a repo variable or one of those literals.

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

HANDOFF.md suggested reading `issue_dependencies_summary.blocked_by` from the REST issue endpoint.
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
