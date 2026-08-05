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

Phase 1's tier gate passes: `growx-tech` is on the **team** plan, so
organisation secrets reach private repositories and private reusable workflows
are shareable.

The pinned SHA includes the paged reconcile search — `findWayfinderIssues` in
`scripts/lib/github.mjs` loops on `pageInfo.hasNextPage`. The hub's own `v1`
tag is stale at `40ab5e8` and was deliberately not used.

`Kind` rather than `Type`: `Type` is reserved on organisation-owned Projects.
`scripts/setup-project.sh` already accounts for this, so no change was needed
moving from the user-owned hub board to an organisation board.

## Outstanding

Everything below needs either the GitHub UI or an `admin:org` token; the local
`gh` token has `gist, project, read:org, repo, workflow`.

1. Project manual settings the setup script cannot apply: group `All maps` by
   `Status`, sort `Board` by `Priority` ascending, and point `Roadmap` at
   `Start date` / `Target date`.
2. The Project auto-add workflow, scoped to **the pilot repositories and
   `label:wayfinder:map`** — not the organisation. Enabling it backfills every
   existing match in one burst.
3. The `growx-tech` GitHub App: Projects read & write, Issues read, Metadata
   read. Install on the deployment repository and the pilots only.
4. Organisation variables and secrets, restricted to the pilots **and the
   deployment repository** (`reconcile.yml` reads all four there):
   `WAYFINDER_PROJECT_OWNER=growx-tech`, `WAYFINDER_PROJECT_NUMBER=6`,
   `WAYFINDER_APP_ID`, `WAYFINDER_APP_PRIVATE_KEY`.
5. Phase 4 caller workflows in two pilot repositories, and Phase 5
   verification.

Enterprise-level Actions restrictions were not readable without `admin:org` and
remain unconfirmed. The likely requirement is an allowlist entry for
`gruvyworks/wayfinder-project-sync@*` and `actions/create-github-app-token@*`.
