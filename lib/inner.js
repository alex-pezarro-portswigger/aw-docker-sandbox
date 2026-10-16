import { splitShellWords, shellQuote } from './shell.js';
import { flagValues } from './agents.js';

// Reading and rewriting core's `inner` launch command. wrapLaunch isn't told
// the agent, so it is read from the command itself: core builds
// `env -u … [NAME='v' …] claude …` or `[NAME='v' …] codex …`.

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// The agent binary `inner` runs, or null when it isn't one we recognise.
export function agentOfInner(inner) {
  const words = splitShellWords(inner);
  let i = 0;
  if (words[i] === 'env') {
    i++;
    while (i < words.length && (words[i] === '-u' || ASSIGNMENT.test(words[i]) || words[i].startsWith('-'))) {
      i += words[i] === '-u' ? 2 : 1;
    }
  }
  while (i < words.length && ASSIGNMENT.test(words[i])) i++;
  const bin = words[i] || '';
  const name = bin.split('/').pop();
  return name === 'claude' || name === 'codex' ? name : null;
}

// The wrangler's port, from the MCP url core puts in every launch. Null when
// `inner` has none (the sandbox then just never reaches the wrangler).
export function wranglerPort(inner) {
  const m = String(inner).match(/http:\/\/127\.0\.0\.1:(\d+)\//);
  return m ? Number(m[1]) : null;
}

// 127.0.0.1 inside the VM is the VM. The wrangler's MCP and PR-attach urls are
// rewritten to the host alias the sbx proxy forwards (with a per-sandbox
// policy rule). Only `http://127.0.0.1:` is touched, so an intent that merely
// mentions the address is left alone unless it is a url.
export function rewriteLoopback(inner) {
  return String(inner).replace(/http:\/\/127\.0\.0\.1:/g, 'http://host.docker.internal:');
}

// The paths `inner` grants with --add-dir (task-memory's notes dir, Codex's
// git dir, the dispatch's own grants).
export function addDirsOf(inner) {
  return flagValues(splitShellWords(inner), '--add-dir');
}

// Swap each `'<from>'` argument for `'<to>'`. Core shellQuotes every argument,
// so matching the quoted form replaces whole words only.
export function replaceArgs(inner, swaps) {
  let out = String(inner);
  for (const [from, to] of swaps) {
    if (from === to) continue;
    out = out.split(shellQuote(from)).join(shellQuote(to));
  }
  return out;
}
