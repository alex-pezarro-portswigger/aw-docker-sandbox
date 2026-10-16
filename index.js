import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSbxRuntime, createSessionHooks } from './lib/runtime.js';

// Docker Sandbox: an `sbx` runtime in the dispatch dialog. Dispatching with it
// runs the card's agent (Claude Code or Codex) inside a local Docker Sandboxes
// microVM named aw-<cardId>, with the card's folder mounted at the same path
// and the agent's transcripts written to the host, so cost, resume and fork
// work as on local. Archive stops the sandbox; purge removes it.
//
// Contract-dependent pieces: the `runtimes` entry (lib/runtime.js, 1.19.0),
// wrapLaunch's `parentId` (1.29.0) and `liveByTmux` (1.34.0), without which a
// running card reads as dormant.

export const dir = path.dirname(fileURLToPath(import.meta.url));

export default {
  id: 'docker-sandbox',
  label: 'Docker Sandbox',
  description: 'Adds a Docker Sandbox runtime to the dispatch dialog: the card\'s Claude or Codex runs inside a local sbx microVM instead of on this machine.',
  help: 'Adds "Docker Sandbox" to the dispatch dialog\'s runtime picker. Each card gets its own sandbox (aw-<card id>) with the card\'s folder mounted. Needs Docker Sandboxes (`sbx`) installed, signed in, and a global anthropic (Claude) or openai (Codex) secret. Archiving a card stops its sandbox; purging it removes the sandbox.',
  author: 'Alex Pezarro',
  dir,
  defaultEnabled: true,
  // Must equal package.json's wranglerExtension.requires. Nothing is needed:
  // a runtime and session hooks are ungated, and settings are the extension's own.
  requires: [],
  // 1.34.0: a wrapLaunch runtime's `liveByTmux`. An older server ignores the
  // key and shows a running sandboxed card as dormant, so only the range can
  // say this won't work there.
  engines: { wranglerApi: '^1.34.0' },
  settings: [
    {
      key: 'shareCodexSessions',
      type: 'toggle',
      label: 'Share Codex sessions',
      help: 'Codex cards need this. The wrangler reads Codex transcripts from ~/.codex/sessions, so the whole folder is mounted into each Codex sandbox: the sandboxed agent can read and change every Codex session on this machine. Off by default; Claude only mounts its own project folder.',
    },
    {
      // Inverted from the design's `stopOnArchive` (default on): a toggle has no
      // default, so an unset value has to mean the default behaviour.
      key: 'keepRunningOnArchive',
      type: 'toggle',
      label: 'Keep sandbox running on archive',
      help: 'Off (the default): archiving a card stops its sandbox, and Resume starts it again. On: the sandbox keeps running after archive. Purging a card always removes its sandbox.',
    },
  ],
  runtimes: [createSbxRuntime()],
  session: createSessionHooks(),
};
