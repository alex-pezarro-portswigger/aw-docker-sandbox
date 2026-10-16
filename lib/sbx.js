import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Thin wrappers around the `sbx` CLI. `run` is a promisified execFile, injected
// in tests so nothing touches a real daemon.

const exec = promisify(execFile);
const TIMEOUT_MS = 15_000;

export const defaultRun = (cmd, args) => exec(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });

// One sandbox per card.
export function sandboxName(cardId) {
  return `aw-${cardId}`;
}

// The local sandboxes, or throws with sbx's own message (a stopped or
// out-of-date daemon fails here).
export async function listSandboxes(run = defaultRun) {
  const { stdout } = await run('sbx', ['ls', '--json']);
  const parsed = JSON.parse(String(stdout || '[]'));
  return Array.isArray(parsed) ? parsed : [];
}

export async function sandboxExists(name, run = defaultRun) {
  return (await listSandboxes(run)).some((s) => s?.name === name);
}

// The names of the global service secrets (`sbx secret ls -g`): rows of
// `(global)  service  <name>  <state>`.
export async function globalServiceSecrets(run = defaultRun) {
  const { stdout } = await run('sbx', ['secret', 'ls', '-g']);
  const names = new Set();
  for (const line of String(stdout || '').split('\n')) {
    if (/^\s*CUSTOM SECRETS/.test(line)) break;
    const m = line.match(/^\s*\(global\)\s+service\s+(\S+)/);
    if (m) names.add(m[1]);
  }
  return names;
}

// Best effort: a missing sandbox, or no sbx at all, is not an error here.
export async function stopSandbox(name, run = defaultRun) {
  try { await run('sbx', ['stop', name]); return true; } catch { return false; }
}

export async function removeSandbox(name, run = defaultRun) {
  try { await run('sbx', ['rm', '--force', name]); return true; } catch { return false; }
}
