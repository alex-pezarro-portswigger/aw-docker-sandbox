import os from 'node:os';
import path from 'node:path';
import { shellQuote } from './shell.js';

// The per-agent table: everything that differs between Claude and Codex in a
// sandbox. Anything not listed here is refused at preflight.
//
//   sbxAgent         the agent name `sbx create` takes (it picks the image).
//   secret           the global sbx secret the proxy injects for the agent.
//   transcriptDir    the HOST dir the agent's transcripts must land in, so core's
//                    costing, resume guard, live-id discovery and fork keep
//                    working. Mounted rw at the same path.
//   vmPrep           the in-VM shell script run before the agent: it points the
//                    agent's own transcript dir at that mount (and, for Codex,
//                    trusts the card's folder).
//   readOnlyMounts   host paths named in `inner` the agent must be able to read
//                    (plugin dirs, the PR hook, skill catalog files).

// Claude's project bucket: the cwd with every non-alphanumeric character
// replaced by `-` (matches Claude Code's naming).
export function bucket(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

// Move a real (non-symlink) in-VM path aside, then link it to the mount. A
// fresh sandbox has an empty dir there; moving rather than deleting keeps
// anything the image put in it.
// `vmPath` may use $HOME/$CODEX_HOME, so it is double-quoted (expanded in the VM).
function linkScript(vmPath, hostPath) {
  const v = `"${vmPath}"`;
  const aside = `"${vmPath}.vm-$(date +%s)"`;
  return `mkdir -p "$(dirname ${v})" && `
    + `{ if [ -e ${v} ] && [ ! -L ${v} ]; then mv ${v} ${aside}; fi; } && `
    + `ln -sfn ${shellQuote(hostPath)} ${v}`;
}

// Codex asks whether to trust a folder on first use, and the sbx image's
// config.toml trusts nothing, so the pane would sit on that dialog. Core
// pre-trusts the folder in the HOST config (codex-trust.js); this does the same
// in the VM's. A path TOML can't hold as a plain basic string is skipped (the
// dialog then shows, as it would have anyway).
export function codexTrustScript(dirs) {
  const ok = [...new Set(dirs)].filter((d) => d && !/["\\\n]/.test(d));
  if (!ok.length) return '';
  return 'C="${CODEX_HOME:-$HOME/.codex}/config.toml" && mkdir -p "$(dirname "$C")" && touch "$C" && '
    + `for d in ${ok.map(shellQuote).join(' ')}; do `
    + 'grep -qF "[projects.\\"$d\\"]" "$C" || printf \'\\n[projects."%s"]\\ntrust_level = "trusted"\\n\' "$d" >> "$C"; done';
}

export function hostCodexSessionsDir(env = process.env, home = os.homedir()) {
  return path.join(env.CODEX_HOME || path.join(home, '.codex'), 'sessions');
}

export const AGENTS = {
  claude: {
    sbxAgent: 'claude',
    secret: 'anthropic',
    transcriptDir: ({ cwd, home = os.homedir() }) => path.join(home, '.claude', 'projects', bucket(cwd)),
    vmPrep: ({ cwd, hostDir }) => linkScript(`$HOME/.claude/projects/${bucket(cwd)}`, hostDir),
    readOnlyMounts: (words) => [...flagValues(words, '--plugin-dir'), ...prHookPaths(words)],
  },
  codex: {
    sbxAgent: 'codex',
    secret: 'openai',
    transcriptDir: ({ env, home }) => hostCodexSessionsDir(env, home),
    vmPrep: ({ hostDir, trustDirs = [] }) => [linkScript('${CODEX_HOME:-$HOME/.codex}/sessions', hostDir), codexTrustScript(trustDirs)].filter(Boolean).join(' && '),
    readOnlyMounts: (words) => skillCatalogDirs(words),
  },
};

export const SUPPORTED = Object.keys(AGENTS);

export function agentSpec(agent) {
  return Object.hasOwn(AGENTS, agent) ? AGENTS[agent] : null;
}

// Every value of a repeated `--flag value` in an argv.
export function flagValues(words, flag) {
  const out = [];
  for (let i = 0; i < words.length - 1; i++) if (words[i] === flag) out.push(words[i + 1]);
  return out;
}

// Claude's `--settings` JSON carries the PR-attach PostToolUse hook, a script
// in core's scripts/ that imports ../server/pr-hook.js. Both go in read-only.
function prHookPaths(words) {
  const out = [];
  for (const raw of flagValues(words, '--settings')) {
    let settings;
    try { settings = JSON.parse(raw); } catch { continue; }
    for (const group of Object.values(settings?.hooks || {})) {
      for (const entry of Array.isArray(group) ? group : []) {
        for (const h of entry?.hooks || []) {
          const cmd = typeof h?.command === 'string' ? h.command.trim() : '';
          if (!path.isAbsolute(cmd) || /\s/.test(cmd)) continue;
          const dir = path.dirname(cmd);
          out.push(dir);
          if (path.basename(cmd) === 'pr-attach-hook.mjs') out.push(path.join(dir, '..', 'server', 'pr-hook.js'));
        }
      }
    }
  }
  return out.map((p) => path.normalize(p));
}

// Codex gets its wrangler skills as a catalog of absolute SKILL.md paths in
// developer_instructions; each skill's dir goes in read-only.
function skillCatalogDirs(words) {
  const out = new Set();
  for (const w of words) {
    for (const m of w.matchAll(/(\/[^\s'"`]+)\/SKILL\.md\b/g)) out.add(m[1]);
  }
  return [...out];
}
