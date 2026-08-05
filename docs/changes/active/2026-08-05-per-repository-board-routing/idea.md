---
type: feature
labels: [reconcile, multi-tenancy, deferred]
---

# Per-repository board routing

## Intended outcome

Allow one installation of the sync to feed more than one GitHub Project, with
each participating repository routed to a named board, without repository-specific
derivation code and without a sweep on one board claiming another board's issues.

Not yet justified. This record exists so the constraint is written down rather
than rediscovered, and so the deployment in
[`2026-08-05-growx-tech-deployment`](../../archive/2026-08-05-growx-tech-deployment/plan.md)
is not read as having considered and rejected it. It had not considered it at
all.

## Why it is not already possible

The event path very nearly supports this today, by accident. Repository
variables take precedence over organisation variables of the same name, and the
`vars` context in a called workflow resolves against the **calling** repository.
A participating repository that sets its own `WAYFINDER_PROJECT_NUMBER` would
therefore already override the organisation value, with no change to the caller
stub and no change to any workflow.

The reconcile sweep is what makes that unsafe. `findWayfinderIssues` in
`scripts/lib/github.mjs` searches:

```text
is:issue is:open owner:<login> label:wayfinder:map,wayfinder:task,…
```

The scope is the **owner**, never a repository set, and every result is added to
whichever board `PROJECT_NUMBER` names. Two boards sweeping the same owner
therefore converge on the union of all Wayfinder issues in the installation.

The failure mode is the dangerous kind: the event path routes each repository to
its correct board immediately, so the split looks right for up to an hour, and
the first scheduled sweep then cross-contaminates both boards with no error in
any log. This is the same shape as the `owner:`-input failure the deployment
plan warns about.

## What a real solution needs

A repository filter on the reconcile search, so a sweep can be told *these
repositories, this board*. That is a change to this repository — the action and
`derive.mjs` — not to any deployment. Reconcile would need the repository set as
configuration, which reintroduces exactly the per-repository configuration the
deployment's guardrails exclude, so the design question is where that set lives:
derived from the board's own contents, passed as an action input, or implied by
a narrower installation.

## The cheaper alternative

A second deployment repository with its own GitHub App installation and its own
participating set. The installation already bounds the sweep — verified during
the `growx-tech` rollout, where eleven Wayfinder issues in a repository outside
the installation were correctly excluded from the board. No code change is
required, and the trust boundary is a real one rather than a naming convention.

Prefer this unless the number of boards grows past what separate installations
can reasonably carry.

## Signals that this becomes worth building

- A team asks for its own board and separate installations are judged too heavy.
- Boards outnumber the deployment repositories anyone wants to maintain.
- A repository legitimately needs to appear on two boards at once, which
  neither approach above supports.
