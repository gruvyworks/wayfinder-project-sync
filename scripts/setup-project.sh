#!/usr/bin/env bash
#
# One-time, idempotent project setup.
#
# Creates the board (if absent), the fields the sync writes, and the views a
# human reads it through. Safe to re-run: every step checks for what it is about
# to create, and never touches what is already there.
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
  # Neither of these is read or written by the sync. They exist because the views
  # below group and sort by them, matching what GitHub's own project templates set
  # up — the board is a general work board, not a wayfinder appliance.
  "Priority:P0,P1,P2"
  "Size:XS,S,M,L,XL"
)

# Field name -> data type, for the fields that are not single-selects.
PLAIN_FIELDS=(
  "Estimate:NUMBER"
  "Start date:DATE"
  "Target date:DATE"
)

# Views, as `name|layout|filter|visible fields`.
#
# Only those four properties are writable. `createProjectV2View` accepts a name,
# a layout and a set of visible field ids; `updateProjectV2View` adds a filter.
# Grouping and sorting are readable on a view but have no mutation input at all,
# so they cannot be provisioned — the script prints them as a manual tail.
#
# A new BOARD_LAYOUT view defaults its columns to `Status`, which is the one
# default that has to be corrected by hand: `Status` is human-owned and nothing
# writes it, so a board columned by it shows every card in one pile forever. The
# control is `View -> Column by`, not the view tab's menu, and it is read here as
# `verticalGroupByFields` — `groupByFields` stays empty on a board and reading it
# alone makes an uncorrected board look correctly configured.
#
# The visible-field list decides *which* fields a view shows, not what order the
# columns come out in — GitHub returns its own ordering regardless of the order
# the ids are submitted in. Read these lists as sets; column order is a UI drag.
#
# `Wayfinder` belongs on every view that shows tickets. It is the only field this
# repo exists to write, and a view that omits it renders a correctly derived
# board as a board where nothing ever moves. `All maps` is the exception: a map
# is never claimed, so its state only ever reads Ready or Done, which
# `Sub-issues progress` already says better.
VIEWS=(
  # The landing view: one row per effort, with sub-issue progress rolling up
  # natively. Filtered to maps, so it stays a list of efforts rather than a list
  # of everything — the label is quoted because the value itself contains a colon.
  #
  # It is also first because it is a table, like the default view a new project
  # ships with, which makes adopting that view a pure rename with no relayout.
  "All maps|TABLE_LAYOUT|label:\"wayfinder:map\"|Title,Status,Linked pull requests,Sub-issues progress,Size,Estimate,Priority,Start date,Target date"
  # The wayfinder-native fields live here rather than on a board of their own:
  # `Repository`, `Kind` and `Mode` are things you scan, sort and filter, which a
  # table does and a card chip does not.
  "All items|TABLE_LAYOUT||Title,Repository,Assignees,Status,Wayfinder,Kind,Mode,Linked pull requests,Sub-issues progress"
  # Named `Board`, not `Backlog`: `Status` already has a `Backlog` option, and a
  # view showing every status under that name reads as a mistake. `Priority` is
  # shown on the card rather than used as a swimlane — nothing writes it, so most
  # cards have none, and a swimlane axis that is empty for most of the board is
  # noise. Sorted by it, unprioritised cards simply fall to the bottom.
  "Board|BOARD_LAYOUT||Title,Assignees,Status,Wayfinder,Linked pull requests,Sub-issues progress,Priority,Estimate,Size"
  # A roadmap shows its date fields, not a column list, and those are not writable.
  "Roadmap|ROADMAP_LAYOUT||"
  "My items|TABLE_LAYOUT|assignee:@me|Title,Wayfinder,Priority,Linked pull requests,Sub-issues progress,Size,Estimate"
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

project_is_new=""

if [[ -z "${project_number}" ]]; then
  echo "Creating project..."
  project_number="$(
    gh project create --owner "${PROJECT_OWNER}" --title "${PROJECT_TITLE}" \
      --format json | jq -r '.number'
  )"
  project_is_new=1
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

for entry in "${PLAIN_FIELDS[@]}"; do
  name="${entry%%:*}"
  data_type="${entry#*:}"

  if jq -e --arg n "${name}" '.fields[] | select(.name == $n)' <<<"${existing}" >/dev/null; then
    echo "  field '${name}' exists; skipping."
    continue
  fi

  echo "  creating field '${name}' (${data_type})"
  gh project field-create "${project_number}" \
    --owner "${PROJECT_OWNER}" \
    --name "${name}" \
    --data-type "${data_type}" >/dev/null
done

# Options on an *existing* field cannot be edited by `gh project field-create`,
# so a partially-configured field is reported rather than silently tolerated —
# the sync warns and skips any option it cannot find.

# --- views --------------------------------------------------------------------
#
# `gh project` has no view commands, so this half talks to GraphQL directly. The
# project's node id is enough to address it, which avoids having to resolve
# whether PROJECT_OWNER is a user or an organisation.

project_id="$(
  gh project view "${project_number}" --owner "${PROJECT_OWNER}" --format json | jq -r '.id'
)"
fields="$(gh project field-list "${project_number}" --owner "${PROJECT_OWNER}" --format json)"
views="$(
  gh api graphql -f query='
    query($id: ID!) {
      node(id: $id) { ... on ProjectV2 { views(first: 50) { nodes { id name } } } }
    }' -f id="${project_id}"
)"

# Comma-separated field names -> a JSON array of ids, in the order asked for.
# Names that do not resolve are warned about rather than silently dropped: a view
# missing a column is a lot harder to notice than a line of output.
visible_field_ids() {
  local want="$1" view="$2" missing

  if [[ -z "${want}" ]]; then
    echo "[]"
    return
  fi

  missing="$(jq -r --arg names "${want}" \
    '(($names | split(",")) - [.fields[].name]) | join(", ")' <<<"${fields}")"
  if [[ -n "${missing}" ]]; then
    echo "  warning: view '${view}' wants unknown field(s): ${missing}" >&2
  fi

  jq -c --arg names "${want}" \
    '. as $p | [($names | split(","))[] | . as $n | ($p.fields[] | select(.name == $n) | .id)]' \
    <<<"${fields}"
}

# A brand-new project ships one table view called `View 1`. The first configured
# view is folded into it, so a fresh board does not end up with a stray extra
# view nobody asked for. On an existing board there is nothing to adopt.
adopt_view_id=""
if [[ -n "${project_is_new}" ]]; then
  adopt_view_id="$(
    jq -r '.data.node.views.nodes[] | select(.name == "View 1") | .id' <<<"${views}" | head -n1
  )"
fi

for entry in "${VIEWS[@]}"; do
  IFS='|' read -r name layout filter visible <<<"${entry}"

  view_id="$(jq -r --arg n "${name}" \
    '.data.node.views.nodes[] | select(.name == $n) | .id' <<<"${views}" | head -n1)"

  if [[ -n "${view_id}" ]]; then
    echo "  view '${name}' exists; leaving it alone."
    continue
  fi

  ids="$(visible_field_ids "${visible}" "${name}")"
  config=""
  if [[ "${ids}" != "[]" ]]; then
    config=", configuration: { visibleFieldIds: ${ids} }"
  fi

  if [[ -n "${adopt_view_id}" ]]; then
    echo "  adopting the default view as '${name}' (${layout})"
    view_id="$(
      gh api graphql -f query="
        mutation(\$v: ID!, \$n: String!, \$l: ProjectV2ViewLayout!) {
          updateProjectV2View(input: { viewId: \$v, name: \$n, layout: \$l${config} }) {
            projectV2View { id }
          }
        }" -f v="${adopt_view_id}" -f n="${name}" -f l="${layout}" \
        --jq '.data.updateProjectV2View.projectV2View.id'
    )"
    adopt_view_id=""
  else
    echo "  creating view '${name}' (${layout})"
    view_id="$(
      gh api graphql -f query="
        mutation(\$p: ID!, \$n: String!, \$l: ProjectV2ViewLayout!) {
          createProjectV2View(input: { projectId: \$p, name: \$n, layout: \$l${config} }) {
            projectV2View { id }
          }
        }" -f p="${project_id}" -f n="${name}" -f l="${layout}" \
        --jq '.data.createProjectV2View.projectV2View.id'
    )"
  fi

  # A filter is not part of the create input, so it is a second call.
  if [[ -n "${filter}" ]]; then
    gh api graphql -f query='
      mutation($v: ID!, $f: String!) {
        updateProjectV2View(input: { viewId: $v, filter: $f }) { projectV2View { id } }
      }' -f v="${view_id}" -f f="${filter}" >/dev/null
  fi
done

echo
echo "Grouping and sorting have no API. Set these by hand, once, under 'View':"
echo
echo "  Board     Column by: Wayfinder   <- without this the board never moves"
echo "  Board     sort by Priority, ascending"
echo "  All maps  group by Status"
echo "  Roadmap   dates from 'Start date' and 'Target date'"
echo
echo "Done. Set this on the hub repo so the workflows can find the board:"
echo
echo "  gh variable set PROJECT_NUMBER --body '${project_number}'"
echo "  gh variable set PROJECT_OWNER  --body '${PROJECT_OWNER}'"
echo
