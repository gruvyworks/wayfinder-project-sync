/**
 * Thin wrapper around the `gh` CLI.
 *
 * Authentication is entirely ambient: `gh` reads `GH_TOKEN` from the
 * environment, which the workflows populate from `WAYFINDER_PROJECT_TOKEN`.
 * Nothing here handles credentials.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Project item lists can be large; the 1 MB default is not enough. */
const MAX_BUFFER = 10 * 1024 * 1024;

export class GhError extends Error {
  constructor(args, cause) {
    const stderr = (cause.stderr ?? '').trim();
    super(`gh ${args.join(' ')}\n${stderr || cause.message}`);
    this.name = 'GhError';
    this.stderr = stderr;
    this.exitCode = cause.code;
  }
}

/** @returns {Promise<string>} stdout, trimmed */
export async function gh(args) {
  try {
    const { stdout } = await execFileAsync('gh', args, { maxBuffer: MAX_BUFFER });
    return stdout.trim();
  } catch (cause) {
    throw new GhError(args, cause);
  }
}

/** `gh` with `--format json` / `--jq`-free JSON parsing. */
export async function ghJson(args) {
  const out = await gh(args);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`gh ${args.join(' ')} did not return JSON:\n${out.slice(0, 500)}`);
  }
}

/**
 * Run a GraphQL query. Variables are passed with `-F`, which infers numbers and
 * booleans; everything else arrives as a string.
 *
 * @returns the `data` object, with GraphQL-level errors raised rather than ignored
 */
export async function ghGraphql(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push('-F', `${key}=${value}`);
  }

  const body = await ghJson(args);

  // `gh` exits non-zero for most GraphQL errors, but partial-data responses can
  // come back on a zero exit. Surface them instead of returning half a result.
  if (body?.errors?.length) {
    const detail = body.errors.map((e) => e.message).join('; ');
    throw new Error(`GraphQL error: ${detail}`);
  }
  return body?.data ?? {};
}
