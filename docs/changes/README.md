# Repository Documentation

This repository uses the documentation layout defined in this file.

## Change records

Keep durable lifecycle documentation for one bounded release, feature, or
non-trivial bug fix together in one dated directory. Routine changes represented
adequately by issue and Git history do not need a change record.

### Naming and contents

- Store change records under
  `docs/changes/{active,archive}/YYYY-MM-DD-<change>/`.
- Use the idea's first-capture date. The complete directory name stays
  byte-identical for the record's whole life; a state change moves the directory
  between `active/` and `archive/` without renaming it.
- The earliest maintained `idea.md` or `design.md` states the intended outcome
  clearly. Optional classification (`type`, `labels`) is YAML frontmatter in
  that file, never a separate manifest or storage location.
- Use `idea.md`, `design.md`, `plan.md`, and `handoff.md` when unambiguous.
  Multiple files with the same role use purpose-specific names without role
  subdirectories. Create only files that are needed.

### State

- `active`: any intended scope remains unresolved. Partial implementation,
  inactivity, and deferral remain active.
- `archive`: work reached a terminal result recorded in `outcome.md`.

The terminal result lives only in `outcome.md`, never in the path. A terminal
transition moves the complete change record to `archive/`, creates `outcome.md`,
and updates every live repository reference in the same change. Every archived
change record has this minimal outcome:

```md
# Outcome

Date: YYYY-MM-DD
Result: implemented | rejected | abandoned | superseded
Evidence: <default-branch and verification evidence, closure reason, or successor link>
```

`implemented` requires the complete intended outcome on the relevant default
branch with required verification passing; deployment or activation is required
only when the acceptance criteria require it. `rejected`, `abandoned`, and
`superseded` record work that ended without completing that outcome.

Active change records do not have `outcome.md`. Archived records do not
reactivate except to correct a classification mistake. Later enhancements and
post-acceptance regressions receive new linked records. A defect found before
the original intended outcome is complete leaves that record active.

A release record archives as implemented only after its scope is frozen, every
linked required feature record is archived, integrated verification passes on
the relevant default branch, and completion is recorded in `outcome.md`.
Relationships use links rather than directory nesting.

### Namespace ownership

This layout owns `docs/changes/` exclusively. When unrelated content already
occupies that path, adoption fails closed. Adopting anyway requires a committed
repository-specific exception that names a replacement root for the complete
layout or precisely bounds the coexisting content.

## Other documentation

- Approved PRDs live directly under `docs/product/`.
- Task-oriented instructions, handbooks, and runbooks live under `docs/guides/`.
- Stable factual lookup material lives under `docs/reference/`.
- ADRs live under `docs/decisions/` and retain stable identifiers.
- Implementation-facing behavioral specifications remain under repository-root
  `openspec/`.
- Create directories only when populated. Numbered documentation directories,
  change-type subdirectories, `docs/brainstorm/`, per-record archives,
  generated indexes, aliases, compatibility copies, and empty scaffolding are
  not part of this layout.
- Preserve raw transcripts and immutable evidence rather than rewriting them
  for naming or path consistency.
- Rules in a separate `Repository-specific exceptions` section override this
  layout in this repository.
