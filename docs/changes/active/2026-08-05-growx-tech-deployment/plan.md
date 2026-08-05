# Growx-tech deployment plan

## Intended outcome

Deploy the complete Wayfinder-to-GitHub-Projects sync in `growx-tech` without
forking or copying the personal hub's implementation. The work organisation
owns its Project, credentials, scheduling, and reusable workflow entry point;
the generic implementation is consumed from `gruvyworks/wayfinder-project-sync`
at an explicitly reviewed, immutable commit SHA.

The deployment must support both event-driven updates and scheduled
reconciliation while keeping repository onboarding identical and free of
repository-specific configuration.

## Architecture

```text
growx-tech repositories
        |
        | identical workflow stub
        v
growx-tech/wayfinder-project-sync-deploy
        |-- reusable event workflow
        |-- scheduled reconciliation workflow
        |
        | reviewed, immutable action SHA
        v
gruvyworks/wayfinder-project-sync
        |
        | ephemeral growx-tech App token
        v
growx-tech GitHub Project
```

The `growx-tech` GitHub App ID and private key remain inside `growx-tech`.
The deployment workflows mint short-lived installation tokens and pass only
those tokens to the shared action.

The deployment repository calls the hub's **composite action** directly, not the
hub's own `.github/workflows/sync.yml`. That is what makes the SHA pin possible —
`uses:` cannot be interpolated, so a reusable workflow reference could not carry
a reviewed SHA chosen by `growx-tech`. The accepted cost is that the deployment's
`sync.yml` re-implements roughly twenty lines of the hub's: the `wayfinder:`
label gate and the token minting. Do not "simplify" this by chaining to the hub's
reusable workflow; that silently discards the pin.

This design also supersedes any proposal to add a `workflow_call` trigger to the
hub's `reconcile.yml`. The deployment owns its own schedule, so the hub needs no
change to support this deployment.

## Guardrails

- Do not fork, vendor, or maintain a work-specific derivation implementation.
- Do not pass the App private key to the shared action.
- Pin the external composite action to a full commit SHA.
- Limit the App installation and organisation secrets to participating
  repositories.
- Keep Project identity in organisation variables, not workflow source.
- Keep every participating repository's caller workflow byte-identical.
- Do not customise label vocabulary, field semantics, derivation precedence,
  or Wayfinder itself without a demonstrated incompatible work requirement.
- If `growx-tech` policy prohibits executing code from a personal public
  repository, stop and replace this design with a reviewed internal mirror.

## Phase 1: validate organisation policy

Confirm that `growx-tech` permits:

- private reusable workflows shared across repositories;
- the required GitHub-authored Actions;
- `gruvyworks/wayfinder-project-sync` as an external action;
- full-SHA pinning of that action; and
- organisation-level Actions secrets and variables in participating private
  repositories.

Confirm the **plan tier** separately from policy. Organisation secrets reaching
private repositories, and private reusable workflows shared across repositories,
both require Team or above; neither is available on Free. The personal hub works
around the first with per-repository secrets, and this deployment does not.

Record any enterprise-level Actions restrictions before provisioning. A policy
failure at this gate changes the distribution mechanism, not the derivation
model. The likeliest outcome is not a prohibition but an allowlist entry for
`gruvyworks/wayfinder-project-sync@*` and `actions/create-github-app-token@*`.

## Phase 2: provision growx-tech resources

1. Create an organisation-owned GitHub Project.
2. Run `scripts/setup-project.sh` against `growx-tech` to create the standard
   fields and views.
3. Apply the manual Project settings printed by the setup script.
4. Enable the Project auto-add workflow, **scoped to the pilot repositories and
   to `label:wayfinder:map`** — not to the organisation at large. Enabling
   auto-add backfills every existing match in a single burst, which is a
   convenient way to seed a small board and an unrecoverable way to flood a
   shared one. Widen the scope only after Phase 5 passes.
5. Create a `growx-tech` GitHub App with:
   - Projects: read and write;
   - Issues: read; and
   - Metadata: read.
6. Install the App only on the deployment repository and participating
   repositories.
7. Create organisation variables, restricted to those repositories:
   - `WAYFINDER_PROJECT_OWNER=growx-tech`
   - `WAYFINDER_PROJECT_NUMBER=<project number>`
8. Create organisation secrets with the same repository restriction:
   - `WAYFINDER_APP_ID`
   - `WAYFINDER_APP_PRIVATE_KEY`

The restriction in steps 7 and 8 must include **the deployment repository
itself**, not only the participating repositories. `reconcile.yml` runs in the
deployment repository and reads both the variables and the secrets there; a
restriction covering only participating repositories leaves the scheduled sweep
permanently broken while event-driven syncs appear healthy.

Omitting a participating repository from the variable grant fails loudly rather
than silently: `readConfig()` in `derive.mjs` rejects an empty
`WAYFINDER_PROJECT_NUMBER` with `PROJECT_NUMBER must be a positive integer`.
Expect that error during rollout and read it as a missing grant, not a bug.

## Phase 3: create the deployment repository

Create a small private repository named
`growx-tech/wayfinder-project-sync-deploy` containing only the deployment
surface and its operating instructions:

```text
.github/workflows/sync.yml
.github/workflows/reconcile.yml
README.md
```

Configure the repository so its private reusable workflow is callable by the
participating `growx-tech` repositories.

### Event workflow

The reusable `sync.yml` workflow must:

1. expose `workflow_call`;
2. accept the two App secrets from the caller;
3. skip non-Wayfinder issue events before spending a runner;
4. mint a short-lived installation token with
   `actions/create-github-app-token` set to **`owner: growx-tech`**;
5. invoke `gruvyworks/wayfinder-project-sync@<full-commit-sha>` in `event`
   mode; and
6. read the Project owner and number from organisation variables.

The `owner:` input in step 4 is not optional. Its default scopes the token to
the calling repository alone, which breaks sibling recompute the moment a map
and its tickets live in different repositories — the exact cross-repository path
Phase 5 exists to exercise. The failure is partial and easy to misread as
working. See the hub's `.github/workflows/sync.yml` for the same input and its
rationale.

### Reconciliation workflow

The `reconcile.yml` workflow must:

1. run hourly across the organisation's working hours only, off the hour;
2. expose `workflow_dispatch` for immediate repair;
3. prevent overlapping reconciliation runs;
4. mint a short-lived installation token, again with `owner: growx-tech`;
5. invoke the same pinned action in `reconcile` mode; and
6. read the same organisation variables.

Do not copy the hub's cron. The hub is public, where Actions minutes are free;
the deployment repository is private, so every sweep bills the organisation.
Round-the-clock hourly is roughly 720 runs per month for no benefit. The hub
currently runs `17 4-18 * * *`, a window derived from one operator's hours in
Europe/Amsterdam under both DST offsets — re-derive it for `growx-tech`'s actual
timezones rather than inheriting it. If the board is only read during the working
week, `17 6-16 * * 1-5` is roughly 240 runs per month and is the better default
for a shared board. Overnight and weekend drift is repaired by the next scheduled
sweep or by `workflow_dispatch`.

Publish the deployment repository through a `v1` tag protected by a **repository
ruleset** (tag protection rules are superseded by rulesets; the legacy setting no
longer exists). Participating repositories use that stable internal reference;
only the deployment repository contains the external action SHA.

That reference is deliberately mutable while the external action is pinned to an
immutable SHA, and the asymmetry is intentional: the `v1` tag lives inside the
`growx-tech` trust boundary and under its review process, and mutability is what
makes a fleet-wide fix a single merge instead of a change to every participating
repository. The consequence to accept is that write access to the deployment
repository is effectively write access to every participating repository's
Wayfinder workflow, which is what the ruleset protects.

## Phase 4: add the caller workflow

Add the same minimal workflow to each participating repository:

```yaml
name: wayfinder

on:
  issues:
    types: [opened, labeled, unlabeled, assigned, unassigned, closed, reopened]

jobs:
  sync:
    uses: growx-tech/wayfinder-project-sync-deploy/.github/workflows/sync.yml@v1
    secrets: inherit
```

No repository-specific Project identity, App identity, field mapping, or
business rule belongs in this workflow.

## Phase 5: pilot

Pilot with two non-critical repositories so the cross-repository path is
exercised. Create a map and tickets that cover the complete derivation table.

Verify that:

- non-Wayfinder issues are ignored;
- the auto-add rule imported no non-Wayfinder issues;
- the `wayfinder:*` labels resolve in a repository that has never run a
  Wayfinder session;
- maps and tickets appear on the Project;
- an unassigned ticket without blockers becomes `Ready`;
- an unassigned ticket with an open blocker becomes `Blocked`;
- assignment produces `In progress`;
- closing a ticket produces `Done`;
- closing a blocker releases its dependent ticket;
- a human `Mode` override survives later syncs;
- cross-repository siblings can be read and updated;
- manual reconciliation repairs deliberately introduced drift;
- the scheduled reconciliation completes successfully; and
- workflow logs do not expose credentials.

Do not broaden the rollout until the event-driven and reconciliation paths
both pass.

## Known limits at organisation scale

The pinned SHA must include the paged reconcile search. Before that fix the
sweep read a single page of 100 issues and discarded the rest with nothing in
the logs — harmless at personal scale, and a silent loss of drift correction at
organisation scale. Confirm `findWayfinderIssues` in
`scripts/lib/github.mjs` pages before choosing the SHA to pin.

One ceiling survives that fix: GitHub's search API returns at most 1,000 results
for any single query, however many pages are requested. Beyond that, issues
already on the board are still reconciled through `listItemIssues`, which pages
without that cap; only Wayfinder issues **not yet on the board** would be
missed. Splitting the search per label is the next move if the board ever
approaches that size. Track open Wayfinder issue count as the signal.

## Phase 6: rollout

For each additional repository:

1. add it to the GitHub App installation;
2. grant it access to the organisation variables and secrets;
3. grant it access to the private reusable workflow;
4. commit the identical caller workflow; and
5. verify one Wayfinder issue reaches the Project correctly.

No application-code change or repository-specific workflow edit should be
required.

## Maintenance and updates

For each upstream update:

1. review the changes in `gruvyworks/wayfinder-project-sync`;
2. run its offline derivation tests at the proposed commit;
3. update the pinned SHA in both deployment workflows;
4. run a manual reconciliation against the pilot repositories;
5. exercise one live issue transition; and
6. merge through the normal `growx-tech` review process.

Rollback consists of restoring the previously accepted SHA. If urgent
containment is needed, disable the two deployment workflows or revoke the App
installation until the prior version is restored.

## Completion criteria

This change is complete when:

- two pilot repositories pass every verification above;
- event-driven updates and scheduled reconciliation are healthy;
- the Project, GitHub App, variables, secrets, and schedules are owned by
  `growx-tech`;
- all participating repositories use the identical caller workflow;
- the external implementation is pinned to a reviewed full commit SHA that
  includes the paged reconcile search;
- the App private key never crosses the `growx-tech` trust boundary; and
- the deployment requires no fork or work-specific derivation code.
