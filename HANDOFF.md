# Wayfinder → GitHub Projects sync: build brief

Handoff from a design session. Everything below is decided unless marked **OPEN**.
Build this in a new private repo `wayfinder-project-sync` on the personal account.

---

## 1. Goal

Wayfinder (`mattpocock/skills`, `/wayfinder`) charts big efforts as a map issue plus
child "decision ticket" issues on GitHub. This project makes those issues show up and
move themselves on a single GitHub Project board — **without vendoring or modifying the
wayfinder skill**.

The board is also the user's general-purpose work + personal task board, so wayfinder
items are one citizen among others, not the whole board.

## 2. Why no skill changes are needed

Wayfinder is tracker-agnostic. Its GitHub tracker doc drives everything through plain
`gh` CLI calls, so it already emits an unambiguous, machine-readable signature. We react
to that from the GitHub side; the skill never learns the Project exists.

Reference (read these before building):
- `skills/engineering/wayfinder/SKILL.md` in `mattpocock/skills`
- `skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md` — the "Wayfinding
  operations" section is the exact contract we're consuming.

## 3. The contract wayfinder already emits

| Wayfinder concept | What lands on GitHub | Target Project state |
|---|---|---|
| Map | issue labelled `wayfinder:map` | `Type = map`; sub-issue progress rolls up natively |
| Ticket | **sub-issue** of the map, labelled `wayfinder:<type>` | `Type = research \| prototype \| grilling \| task` |
| HITL/AFK | implied by type: `research` = AFK, `prototype`/`grilling` = HITL, `task` = either | `Mode` field |
| Claimed | `gh issue edit <n> --add-assignee @me` — the session's first write | `Status = In progress` |
| Blocked | native issue dependencies (`blocked_by`) | `Status = Blocked` |
| Frontier | open + unassigned + zero open blockers | `Status = Ready` |
| Resolved | resolution comment, then `gh issue close` | `Status = Done` |

Note `task` is genuinely ambiguous between HITL and AFK — the skill decides per ticket and
does not encode it in a label. Default `Mode = HITL` for `task` and let the human override
on the card. Do not try to infer it from the body.

## 4. Architecture (decided)

**Hub-and-stub.** One private hub repo holds all logic; each participating repo gets a
~12-line caller.

```
wayfinder-project-sync/
├── action.yml                      # composite action: the derivation logic
├── .github/workflows/
│   ├── sync.yml                    # on: workflow_call — thin wrapper callers use
│   └── reconcile.yml               # on: schedule (hourly) + workflow_dispatch
├── scripts/
│   ├── setup-project.sh            # one-time: create project + fields
│   └── derive.mjs                  # status derivation, called by action.yml
├── stub/wayfinder.yml              # copy-paste into each participating repo
├── HANDOFF.md                      # this file
└── README.md
```

Rejected alternatives and why:
- *Copy workflows into every repo* — no single place to fix the derivation logic.
- *Fully central, cron-only, no per-repo files* — loses event-driven response; claiming a
  ticket wouldn't move its card until the next sweep, which makes the board feel dead
  during a session.

The hub stays **private**. Set Settings → Actions → General → Access to
"Accessible from repositories owned by `<USER>` user" — this works for personal accounts.

Tag the hub `v1` and have stubs reference `@v1`. This is the entire payoff over
copy-paste: fix the logic once, every repo picks it up.

## 5. The stub (goes in each participating repo)

```yaml
name: wayfinder
on:
  issues:
    types: [opened, labeled, unlabeled, assigned, unassigned, closed, reopened]
jobs:
  sync:
    uses: <USER>/wayfinder-project-sync/.github/workflows/sync.yml@v1
    secrets: inherit
```

`secrets: inherit` passes the **caller's** secrets, not the hub's — so the PAT must exist
as a secret in every participating repo. There is no way around this on a personal
account. Two one-time steps per repo: drop the stub, add the secret.

## 6. Derivation rules

Run on every triggering issue event, for the issue in the payload:

```
if not any label matching /^wayfinder:/ -> exit 0 (not ours)

add item to project if absent

Type  = label wayfinder:<x>  ->  x   (map | research | prototype | grilling | task)
Mode  = research -> AFK
        prototype, grilling -> HITL
        task -> HITL (default; human may override)
        map -> unset

Status:
  issue closed                     -> Done
  assignee present                 -> In progress
  open blockers > 0                -> Blocked
  otherwise                        -> Ready
```

Open blockers come from the issue's `issue_dependencies_summary.blocked_by` (open blockers
only — it is the live gate). Fetch via `gh api repos/{owner}/{repo}/issues/{n}`.

**Sibling recompute:** on `issues.closed` and `issues.reopened`, after handling the issue
itself, re-derive every open sibling under the same map — closing a blocker is what
unblocks its dependents, and nothing else will notify us.

Do not fight the built-in "closed → Done" project workflow; leave it enabled. The explicit
Done write is belt-and-braces for items whose status we also touch.

## 7. Known gap — read this before designing around it

GitHub has `issue_dependencies` and `sub_issues` **webhook** events, but **neither is
available as an Actions trigger**. Only the `issues` event is. Verified against
docs.github.com "Events that trigger workflows".

Consequence: wayfinder wires blocking edges in a deliberate *second pass* after creating
tickets, so freshly-charted tickets will briefly show as `Ready` before settling to
`Blocked`.

Mitigation, in priority order:
1. Sibling recompute on `issues.closed` covers the transition that actually matters during
   normal work (blocked → ready).
2. `reconcile.yml` on an **hourly** schedule sweeps all maps and corrects drift.
3. `workflow_dispatch` on reconcile for manual "fix it now".

Do **not** make the cron more frequent than hourly — see budgets.

## 8. Budgets and platform limits (all verified)

- GitHub Free: **2,000 Actions minutes/month** for private repos. Public repos are free.
  One hourly hub cron ≈ 720 runs/month. The same cron copied into six repos ≈ 4,300 runs
  and blows the budget — this is why reconcile lives only in the hub.
- The built-in project **auto-add workflow is limited to 1 on GitHub Free** (Pro: 5) and is
  scoped to one repo per workflow. Do not rely on it. Add items from within our own
  workflow, or use `actions/add-to-project` with
  `labeled: wayfinder:map,wayfinder:research,wayfinder:prototype,wayfinder:grilling,wayfinder:task`
  and `label-operator: OR`.
- Projects cap: 50,000 items, 50 fields. Not a concern.
- Sub-issues: 100 children per parent, 8 levels of nesting. Children **may** live in a
  different repo than the parent — the sync must not assume same-repo.

## 9. Token

Fine-grained PAT, stored as a secret (suggest `WAYFINDER_PROJECT_TOKEN`) in each
participating repo:
- Organization/account permissions: **Projects — read & write**
- Repository permissions: **Issues — read**, **Metadata — read**

Classic PAT equivalent is `project` + `repo`. Prefer fine-grained.

`GITHUB_TOKEN` is **not** sufficient — it cannot write to Projects.

## 10. One-time project setup

`scripts/setup-project.sh` should be idempotent and use the `gh` CLI. The `gh project`
commands need the `project` scope:

```bash
gh auth refresh -s project,read:project
```

Then roughly:

```bash
gh project create --owner @me --title "Board"
gh project field-create <n> --owner @me --name "Type" --data-type SINGLE_SELECT \
  --single-select-options "map,research,prototype,grilling,task"
gh project field-create <n> --owner @me --name "Mode" --data-type SINGLE_SELECT \
  --single-select-options "HITL,AFK"
```

`Status` already exists on a new project with Todo/In Progress/Done — extend it with
`Ready` and `Blocked`. `gh project field-create` cannot edit an existing field's options,
so this step needs the GraphQL API (`updateProjectV2Field`) or a documented manual step.
Decide which and say so in the README.

Field and option IDs must be resolved at runtime by name (`gh project field-list --format json`),
not hardcoded — the user may rename things.

## 11. Explicitly out of scope

- **The employer's org.** A private personal hub cannot be consumed by another account's
  repos at all, org Actions policy may block a public one, and fine-grained PAT approval by
  an org owner is the default policy. Beyond that, mirroring employer issue bodies into a
  personal-account board is a data-governance problem. If work repos are ever wanted, the
  answer is a second copy of this hub inside the employer's org, feeding an org-owned
  project. Do not build cross-account support.
- Modifying the wayfinder skill, or vendoring it.
- Two-way sync. This is strictly GitHub → Project. Moving a card must not write back.

## 12. Acceptance criteria

1. Create an issue labelled `wayfinder:grilling` in a participating repo → card appears
   with `Type = grilling`, `Mode = HITL`, `Status = Ready`.
2. Assign it → `Status = In progress`.
3. Add a blocker dependency, run reconcile → `Status = Blocked`.
4. Close the blocker → sibling recompute fires, dependent returns to `Ready`.
5. Close the ticket → `Status = Done`.
6. A non-wayfinder issue in the same repo → workflow exits without touching the project.
7. A sub-issue in a *different* repo from its map is handled correctly.

## 13. OPEN — confirm with the user before building

- Project name, and whether wayfinder items share the existing work+personal board or get
  their own.
- Whether `Status` gains `Ready`/`Blocked`, or whether wayfinder state lives in a separate
  `Wayfinder` field so the human-facing Status column stays simple.
- Which repos participate initially.
