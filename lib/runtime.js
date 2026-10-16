import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { planLaunch, paneScript } from './launch.js';
import { firstRefusal } from './preflight.js';
import { defaultRun, sandboxName, sandboxExists, stopSandbox, removeSandbox } from './sbx.js';

// The `sbx` runtime entry and the session hooks. THIS FILE IS THE CONTRACT
// GLUE: everything it calls is a plain library function, and every assumption
// about what core passes in is here.
//
// HOST API runtime contract (core binds every fn with `{ ...args, host,
// settings }`, settings = host.settings.all()):
//   wrapLaunch({ inner, cwd, sessionId, parentId, worktree, workflow, launchContext })
//     -> the pane command. `inner` is the agent's full command (env prefix,
//        argv, shell-quoted); `sessionId` is the card id, a fork's own new id.
//        Called for dispatch, resume and fork alike.
//   preflight({ cwd, agent, workflow, worktree, ext })
//     -> refusal message (shown as a toast) | null.
//   liveByTmux (1.34.0): the pane runs `sbx exec`, which process discovery
//     can't see as an agent, so core keeps the card live while its tmux is.
// Session hooks get `{ sessionId, entry?, host }` only, so settings come from
// host.settings.all().

const exec = promisify(execFile);

const settingsFrom = ({ settings, host }) => (settings && typeof settings === 'object'
  ? settings
  : (typeof host?.settings?.all === 'function' ? host.settings.all() : {}));

async function realpathOrNull(p) {
  try { return await fs.realpath(p); } catch { return null; }
}

async function gitCommonDirOf(cwd) {
  try {
    const { stdout } = await exec('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeout: 5000 });
    const dir = String(stdout).trim();
    return dir ? await realpathOrNull(dir) : null;
  } catch {
    return null;
  }
}

export const RUNTIME_ID = 'sbx';

export function createSbxRuntime({
  run = defaultRun,
  realpath = realpathOrNull,
  gitCommonDir = gitCommonDirOf,
  ensureDir = (p) => fs.mkdir(p, { recursive: true }),
  env = process.env,
  home = os.homedir(),
} = {}) {
  return {
    id: RUNTIME_ID,
    label: 'Docker Sandbox',
    resumable: true,
    // Transcripts land on the host, so core's resume guard applies as on local.
    skipsHostResumeGuard: false,
    liveByTmux: true,

    async preflight({ cwd, agent, host, settings } = {}) {
      return firstRefusal({ cwd, agent, settings: settingsFrom({ settings, host }), run });
    },

    async wrapLaunch({ inner, cwd, sessionId } = {}) {
      const dir = path.resolve(String(cwd || ''));
      const name = sandboxName(sessionId);
      const plan = await planLaunch({ inner, cwd: dir, sessionId, realpath, gitCommonDir, ensureDir, env, home });
      // A failed `sbx ls` reads as "absent": the pane's create then fails
      // visibly with sbx's own error rather than this throwing a bare one.
      let exists = false;
      try { exists = await sandboxExists(name, run); } catch { exists = false; }
      return paneScript({ name, cwd: dir, exists, ...plan });
    },
  };
}

// Archive stops the sandbox (it keeps its disk, so a Resume picks up where it
// left off: `sbx exec` starts a stopped sandbox). Purge removes it, and sbx
// drops its per-sandbox policy rules with it.
export function createSessionHooks({ run = defaultRun } = {}) {
  return {
    async onArchive({ sessionId, entry, host } = {}) {
      if (!sessionId || entry?.runtime !== RUNTIME_ID) return;
      if (settingsFrom({ host }).keepRunningOnArchive === true) return;
      await stopSandbox(sandboxName(sessionId), run);
    },
    // The entry is gone by now, so this can't check the runtime: `sbx rm` of a
    // sandbox that never existed fails quietly.
    async onPurge({ sessionId } = {}) {
      if (!sessionId) return;
      await removeSandbox(sandboxName(sessionId), run);
    },
  };
}
