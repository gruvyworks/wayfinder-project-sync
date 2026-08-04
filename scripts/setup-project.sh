  #!/usr/bin/env bash
#
# One-time, idempotent project setup.
#
# Creates the board (if absent) and the single-select fields the sync writes.
# Safe to re-run: every step checks for what it is about to create.
#
#   PROJECT_OWNER="@me" PROJECT_TITLE="Board" ./scripts/setup-project.sh
#
# Requires the `project` scope, which a normal `gh auth login` does not grant:
#
#   gh auth refresh -s project,read:project
#
set -euo pipefail

PROJECT_OWNER="${PROJECT_OWNER:-@me}"
PROJECT_TITLE="${PROJECT_TITLE:-Board}"

# Field name -> comma-separated single-select options.
#
# `Status` is deliberately absent. It ships with every new project, belongs to
# the human, and is left exactly as GitHub created it — wayfinder state lives in
# its own `Wayfinder` field so the human-facing columns stay simple.
#
# `Context` is created here but never written by the sync; it exists so views can
# separate personal work from everything else.
FIELDS=(
  "Wayfinder:Ready,Blocked,In progress,Done"
  # Named `Kind`, not `Type`: `Type` is a reserved field name on organisation-owned
  # projects, where GitHub's native issue types claim it. It is accepted on a
  # user-owned project, so this only bites once the board moves to an org.
  "Kind:map,research,prototype,grilling,task"
  "Mode:HITL,AFK"
  "Context:personal,work"
)

die() { echo "error: $*" >&2; exit 1; }

command -v gh >/dev/null || die "gh is not installed"

if ! gh auth status >/dev/null 2>&1; then
  die "not logged in; run: gh auth login"
fi

if ! gh auth status 2>&1 | grep -q "project"; then
  die "token lacks the 'project' scope; run: gh auth refresh -s project,read:project"
fi

echo "Owner:  ${PROJECT_OWNER}"
echo "Title:  ${PROJECT_TITLE}"

# --- the project itself -------------------------------------------------------

project_number="$(
  gh project list --owner "${PROJECT_OWNER}" --format json \
    | jq -r --arg t "${PROJECT_TITLE}" '.projects[] | select(.title == $t) | .number' \
    | head -n1
)"

if [[ -z "${project_number}" ]]; then
  echo "Creating project..."
  project_number="$(
    gh project create --owner "${PROJECT_OWNER}" --title "${PROJECT_TITLE}" \
      --format json | jq -r '.number'
  )"
  echo "Created project #${project_number}"
else
  echo "Project #${project_number} already exists; leaving it alone."
fi

# --- fields -------------------------------------------------------------------

existing="$(gh project field-list "${project_number}" --owner "${PROJECT_OWNER}" --format json)"

for entry in "${FIELDS[@]}"; do
  name="${entry%%:*}"
  options="${entry#*:}"

  if jq -e --arg n "${name}" '.fields[] | select(.name == $n)' <<<"${existing}" >/dev/null; then
    echo "  field '${name}' exists; skipping."
    continue
  fi

  echo "  creating field '${name}' (${options})"
  gh project field-create "${project_number}" \
    --owner "${PROJECT_OWNER}" \
    --name "${name}" \
    --data-type SINGLE_SELECT \
    --single-select-options "${options}" >/dev/null
done

# Options on an *existing* field cannot be edited by `gh project field-create`,
# so a partially-configured field is reported rather than silently tolerated —
# the sync warns and skips any option it cannot find.
echo
echo "Done. Set this on the hub repo so the workflows can find the board:"
echo
echo "  gh variable set PROJECT_NUMBER --body '${project_number}'"
echo "  gh variable set PROJECT_OWNER  --body '${PROJECT_OWNER}'"
echo
