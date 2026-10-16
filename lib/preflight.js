import fs from 'node:fs/promises';
import { agentSpec, SUPPORTED } from './agents.js';
import { defaultRun, listSandboxes, globalServiceSecrets } from './sbx.js';

// Why a dispatch can't run in a Docker Sandbox, or null. First match wins, in
// the design's order: the cheapest, most actionable answer first, and nothing
// that needs a daemon before we know there is one.

export function shareCodexSessionsOn(settings) {
  return settings?.shareCodexSessions === true;
}

export async function firstRefusal({
  cwd,
  agent = 'claude',
  settings = {},
  run = defaultRun,
  stat = (p) => fs.stat(p),
} = {}) {
  try {
    await run('sbx', ['version']);
  } catch (err) {
    if (err?.code === 'ENOENT') return 'Docker Sandboxes isn\'t installed (no `sbx` on the wrangler\'s PATH). Install it with `brew install docker/tap/sbx`.';
    // `sbx version` exits non-zero only when broken; the daemon check says why.
  }

  try {
    await listSandboxes(run);
  } catch (err) {
    const why = String(err?.stderr || err?.message || '').trim().split('\n').find(Boolean) || 'it didn\'t answer';
    return `The Docker Sandboxes daemon isn't healthy (${why}). Run \`sbx daemon restart\` in a terminal, then dispatch again.`;
  }

  const spec = agentSpec(agent);
  if (!spec) return `Docker Sandbox runs Claude and Codex only (${SUPPORTED.join(', ')}), not "${agent}".`;

  const folder = String(cwd || '').trim();
  let isDir = false;
  if (folder) {
    try { isDir = (await stat(folder)).isDirectory(); } catch { isDir = false; }
  }
  if (!isDir) return 'Docker Sandbox needs a folder to mount: pick a folder that exists on this machine.';

  let secrets;
  try {
    secrets = await globalServiceSecrets(run);
  } catch {
    secrets = new Set();
  }
  if (!secrets.has(spec.secret)) {
    return `No global "${spec.secret}" sbx secret, so the sandboxed ${agent === 'codex' ? 'Codex' : 'Claude'} couldn't sign in. Run \`sbx secret set ${spec.secret}\` in a terminal.`;
  }

  if (agent === 'codex' && !shareCodexSessionsOn(settings)) {
    return 'Codex in a Docker Sandbox needs "Share Codex sessions" on (Settings → Extensions → Docker Sandbox). '
      + 'The wrangler reads Codex transcripts from ~/.codex/sessions, so that whole folder is mounted into the sandbox, '
      + 'and the sandboxed agent can read and change every Codex session on this machine.';
  }

  return null;
}
