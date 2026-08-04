/**
 * Project field resolution and writes.
 *
 * Field and option IDs are always resolved at runtime **by name**, never
 * hardcoded — the board is a human's general-purpose work board and they may
 * rename or reorder things (HANDOFF.md §10).
 *
 * Everything is resolved once per process and cached: a sibling recompute can
 * touch dozens of items, and re-fetching the field map for each would be both
 * slow and pointless.
 */

import { ghGraphql } from './gh.mjs';
import { warn } from './github.mjs';

/** Projects cap at 50 fields, so one page always covers it. */
const MAX_FIELDS = 50;

/** Resolve `@me` (and any other alias) to a concrete login. */
export async function resolveOwnerLogin(owner) {
  if (owner && owner !== '@me') return owner;
  const data = await ghGraphql(`{ viewer { login } }`);
  const login = data?.viewer?.login;
  if (!login) throw new Error('Could not resolve @me to a login');
  return login;
}

/**
 * The project's node ID and a name-keyed map of its fields.
 *
 * `repositoryOwner` is used rather than `user`/`organization` so the same code
 * works for a personal board and for an org-owned one after a fork.
 */
export async function resolveProject(owner, number) {
  const login = await resolveOwnerLogin(owner);

  const query = `
    query($login: String!, $number: Int!, $limit: Int!) {
      repositoryOwner(login: $login) {
        ... on ProjectV2Owner {
          projectV2(number: $number) {
            id
            title
            fields(first: $limit) {
              nodes {
                ... on ProjectV2FieldCommon { id name }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options { id name }
                }
              }
            }
          }
        }
      }
    }`;

  const data = await ghGraphql(query, { login, number, limit: MAX_FIELDS });
  const project = data?.repositoryOwner?.projectV2;
  if (!project) {
    throw new Error(`Project #${number} not found for owner ${login}`);
  }

  const fields = new Map();
  for (const node of project.fields?.nodes ?? []) {
    if (!node?.name) continue; // fields with no common interface selection
    fields.set(node.name, {
      id: node.id,
      options: new Map((node.options ?? []).map((o) => [o.name, o.id])),
    });
  }

  return { id: project.id, number, title: project.title, login, fields };
}

/**
 * Add the issue to the project, returning the item ID.
 *
 * `addProjectV2ItemById` is idempotent — it returns the existing item if the
 * issue is already on the board — so no pre-check is needed. The caller still
 * needs to know whether the item is *new*, because `Mode` must only be written
 * on creation; that is what `knownItemId` is for.
 *
 * @returns {{itemId: string, isNew: boolean}}
 */
export async function addItem(project, issue) {
  const knownItemId = issue.projectItems?.find(
    (item) => item.projectId === project.id,
  )?.id;

  if (knownItemId) return { itemId: knownItemId, isNew: false };

  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`;

  const data = await ghGraphql(mutation, {
    projectId: project.id,
    contentId: issue.nodeId,
  });

  const itemId = data?.addProjectV2ItemById?.item?.id;
  if (!itemId) throw new Error(`Failed to add #${issue.number} to the project`);

  return { itemId, isNew: true };
}

/**
 * The card's current single-select values, keyed by field name.
 *
 * This is what makes "write `Mode` only once" actually safe. Deciding it from
 * whether we just created the item is unreliable: the issue's `projectItems`
 * snapshot can be stale between the read and the mutation, and it pages out for
 * an issue that belongs to many projects — in which case every sync would look
 * like a creation and overwrite the human's `Mode`.
 *
 * @returns {Promise<Map<string,string>>} field name -> selected option name
 */
export async function readSingleSelectValues(itemId) {
  const query = `
    query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2Item {
          fieldValues(first: 50) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }`;

  const data = await ghGraphql(query, { id: itemId });
  const nodes = data?.node?.fieldValues?.nodes ?? [];

  const values = new Map();
  for (const node of nodes) {
    if (node?.field?.name && node.name) values.set(node.field.name, node.name);
  }
  return values;
}

/**
 * Write one single-select field value.
 *
 * A missing field or option is a configuration problem, not a data problem —
 * warn and skip rather than throwing, so one unconfigured field cannot stop the
 * rest of the card from syncing. `setup-project.sh` is what fixes these.
 *
 * @returns {Promise<boolean>} whether the write happened
 */
export async function setSingleSelect(project, itemId, fieldName, optionName) {
  const field = project.fields.get(fieldName);
  if (!field) {
    warn(`Project field "${fieldName}" not found — run scripts/setup-project.sh`);
    return false;
  }

  const optionId = field.options.get(optionName);
  if (!optionId) {
    warn(
      `Field "${fieldName}" has no option "${optionName}" ` +
        `(has: ${[...field.options.keys()].join(', ') || 'none'})`,
    );
    return false;
  }

  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }`;

  await ghGraphql(mutation, {
    projectId: project.id,
    itemId,
    fieldId: field.id,
    optionId,
  });

  return true;
}

/** Write a whole `{fieldName: optionName}` map, skipping what cannot be written. */
export async function applyFields(project, itemId, fields) {
  const written = [];
  for (const [name, value] of Object.entries(fields)) {
    if (await setSingleSelect(project, itemId, name, value)) {
      written.push(`${name}=${value}`);
    }
  }
  return written;
}
