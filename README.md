# aw-docker-sandbox

An [Agent Wrangler](https://github.com/PortSwigger/agent-wrangler) extension that adds a
**Docker Sandbox** runtime. A dispatched card's agent (Claude Code or Codex) runs inside a
local [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`) microVM instead of
on the host.

Requires an Agent Wrangler server serving host API **^1.34.0**, the version that added a
runtime's `liveByTmux` flag. Without it a running sandboxed card reads as dormant, so an
older server refuses to load the extension.

You also need:

- `sbx` on the wrangler's `PATH` (`brew install docker/tap/sbx`), signed in, with a healthy
  daemon.
- A global `anthropic` sbx secret for Claude (`sbx secret set anthropic`), or a global
  `openai` one for Codex (`sbx secret set openai`).
- Optional: a global `github` sbx secret, so `gh` and `git push` work inside the sandbox.

## Install

Settings → Extensions → Install, with this repo's URL. It asks for no capabilities.

## How it works

- Pick **Docker Sandbox** as the runtime under *Advanced options* in the dispatch dialog, or
  pass `runtime: "sbx"` to `spawn_session`.
- Each card gets its own sandbox, `aw-<card id>`. The first launch creates it with these
  mounts, each at the same absolute path as on the host:
  - the card's folder (read-write);
  - the agent's transcript folder on the host (read-write): for Claude, its project folder
    `~/.claude/projects/<folder>`, and for Codex, `~/.codex/sessions`;
  - each `--add-dir` grant, such as task memory (read-write, at its real path);
  - for a git worktree, the main checkout's `.git` folder (read-write);
  - the wrangler's skills and Claude's PR-attach hook (read-only).
- The card's pane then runs the agent's usual command with
  `sbx exec -it -w <folder> aw-<card id> sh -lc '<command>'`. The wrangler's MCP and
  PR-attach URLs are rewritten from `127.0.0.1` to `host.docker.internal`, and a
  per-sandbox network rule allows the wrangler's port through the sbx proxy.
- Because transcripts land on the host, the wrangler's cost, resume, fork, Search and live-id
  discovery work as they do for a local card. Resume reuses the card's sandbox, and a
  stopped sandbox starts again on the next `sbx exec`. A fork is a new card, so it gets its
  own sandbox, which mounts the same transcript folder.
- For Codex, the card's folder is marked as trusted in the sandbox's `config.toml` before
  launch, so Codex doesn't stop on its trust prompt.
- Archiving a card stops its sandbox. Purging the card removes the sandbox, along with its
  network rules.

Settings:

- **Share Codex sessions** (off by default). Codex cards need it on. See the risks below.
- **Keep sandbox running on archive** (off by default). Turn it on to leave a card's sandbox
  running after you archive the card.

## Refusals

A Docker Sandbox dispatch is refused with a toast, in this order, when:

1. `sbx` isn't installed;
2. the sbx daemon isn't healthy, for example after an upgrade that needs
   `sbx daemon restart`;
3. the agent is neither Claude nor Codex;
4. the folder doesn't exist on this machine (a sandbox needs a folder to mount);
5. the agent's global sbx secret (`anthropic` or `openai`) is missing;
6. the agent is Codex and **Share Codex sessions** is off.

Only local sandboxes are used. `--cloud` is never passed.

## Limitations

- **The dispatch dialog offers Docker Sandbox for Claude only.** Core's dialog makes every
  non-local runtime Claude-only. To run a Codex card in a sandbox, use `spawn_session` with
  `agent: "codex", runtime: "sbx"`.
- **Mounts are fixed when the sandbox is created.** A skill or extension added after a card
  first launched isn't visible in that card's sandbox. Purge the card and dispatch a new one
  to pick it up.
- **The agent CLI is the sandbox image's,** not the host's, so its version can differ from
  the host's.
- **Old sandboxes aren't cleaned up automatically.** A sandbox whose card was removed without
  a purge stays until you remove it with `sbx rm`.

## Risks

- **Share Codex sessions exposes every Codex session on this machine.** The wrangler reads
  Codex transcripts from `~/.codex/sessions`, so that folder is mounted read-write into each
  Codex sandbox. A sandboxed Codex can read and change all of them. Claude's sandbox mounts
  only its own project's transcript folder.
- **The sandbox can reach the wrangler.** Its MCP server answers on the allowed port, as it
  does for a local card. The sandbox's other network access follows your sbx policy.
- **Mounted folders are writable from inside the sandbox.** This includes the card's
  folder, the main checkout's `.git` for a worktree, and the extensions' `--add-dir`
  grants.

## Tests

```
npm test
```

## License

MIT
