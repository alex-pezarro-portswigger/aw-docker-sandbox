import path from 'node:path';
import { shellQuote, splitShellWords } from './shell.js';
import { agentSpec } from './agents.js';
import { agentOfInner, wranglerPort, rewriteLoopback, addDirsOf, replaceArgs } from './inner.js';

// Building the pane script that runs core's `inner` inside the card's sandbox.
// Pure apart from the injected fs/git probes, so it is tested without sbx.

// Drop every mount already covered by another: a path inside a rw mount is
// readable and writable there, and one inside a ro mount only needs reading.
// Nested mounts are what the sbx docs warn against, so they are never made.
export function collapseMounts(mounts) {
  const byPath = new Map();
  for (const m of mounts) {
    if (!m?.path) continue;
    const p = path.resolve(m.path);
    const prev = byPath.get(p);
    byPath.set(p, { path: p, ro: prev ? prev.ro && m.ro : Boolean(m.ro) });
  }
  const sorted = [...byPath.values()].sort((a, b) => a.path.length - b.path.length);
  const kept = [];
  for (const m of sorted) {
    const parent = kept.find((k) => m.path === k.path || m.path.startsWith(k.path.endsWith('/') ? k.path : `${k.path}/`));
    if (parent && (!parent.ro || m.ro)) continue;
    kept.push(m);
  }
  return kept;
}

// `sbx create` workspace args: the cwd first (the primary workspace), then
// every other mount at its own absolute path, `:ro` where read-only.
export function createArgs({ name, agent, cwd, mounts }) {
  const spec = agentSpec(agent);
  const rest = collapseMounts([{ path: cwd, ro: false }, ...mounts]).filter((m) => m.path !== path.resolve(cwd));
  return ['create', '--name', name, '--no-progress', spec.sbxAgent, path.resolve(cwd),
    ...rest.map((m) => (m.ro ? `${m.path}:ro` : m.path))];
}

// Everything a launch needs, read from `inner` and the host:
//   realpath(p)        -> resolved path, or null when it doesn't exist
//   gitCommonDir(cwd)  -> absolute git common dir, or null outside a repo
//   ensureDir(p)       -> mkdir -p on the host (the transcript dir must exist
//                         before it can be mounted)
export async function planLaunch({ inner, cwd, sessionId, realpath, gitCommonDir, ensureDir, env, home }) {
  const agent = agentOfInner(inner);
  const spec = agentSpec(agent);
  if (!spec) throw new Error('The Docker Sandbox runtime runs Claude and Codex only.');
  const words = splitShellWords(inner);

  const hostDir = spec.transcriptDir({ cwd, env, home });
  await ensureDir(hostDir);

  // Add-dirs are grants to write (task-memory's notes). A symlinked one is
  // mounted at its real path and the argument swapped to match, since a
  // symlink to a host path means nothing in the VM.
  const swaps = [];
  const rw = [{ path: hostDir }];
  for (const d of addDirsOf(inner)) {
    const real = await realpath(d);
    if (!real) continue;
    rw.push({ path: real });
    if (real !== d) swaps.push([d, real]);
  }
  // A worktree's .git points into the main checkout's .git, which must be
  // mounted for git to work at all.
  const common = await gitCommonDir(cwd);
  if (common) rw.push({ path: common });

  const ro = [];
  for (const p of spec.readOnlyMounts(words)) {
    const real = await realpath(p);
    if (real) ro.push({ path: real, ro: true });
  }

  // Folders Codex should trust in the VM: the cwd, and for a worktree the
  // main checkout (core trusts `repoRoot` on the host for the same reason).
  const trustDirs = [cwd];
  if (common && path.basename(common) === '.git') trustDirs.push(path.dirname(common));

  return {
    agent,
    port: wranglerPort(inner),
    hostDir,
    trustDirs,
    mounts: [...rw.map((m) => ({ ...m, ro: false })), ...ro],
    inner: rewriteLoopback(replaceArgs(inner, swaps)),
  };
}

// The pane script, one `&&` chain:
//   1. create the sandbox (only when it doesn't exist yet; mounts are fixed then)
//   2. allow the wrangler's port through the sandbox proxy, once
//   3. prepare the VM: link the agent's transcript dir to the host mount (and
//      trust the folder, for Codex)
//   4. exec the agent in the sandbox, in the card's cwd
export function paneScript({ name, agent, cwd, mounts, port, hostDir, trustDirs = [], inner, exists }) {
  const spec = agentSpec(agent);
  const steps = [];
  if (!exists) steps.push(['sbx', ...createArgs({ name, agent, cwd, mounts })].map(shellQuote).join(' '));
  if (port) {
    const rule = `localhost:${port}`;
    steps.push(`{ sbx policy ls ${shellQuote(name)} --wide 2>/dev/null | grep -qF ${shellQuote(rule)} || `
      + `sbx policy allow network --sandbox ${shellQuote(name)} ${shellQuote(rule)}; }`);
  }
  steps.push(`sbx exec ${shellQuote(name)} sh -lc ${shellQuote(spec.vmPrep({ cwd, hostDir, trustDirs }))}`);
  steps.push(`exec sbx exec -it -w ${shellQuote(path.resolve(cwd))} ${shellQuote(name)} sh -lc ${shellQuote(inner)}`);
  return steps.join(' && ');
}
