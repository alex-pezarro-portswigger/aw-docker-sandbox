import { shellQuote } from '../lib/shell.js';

// Launch commands shaped exactly like core's (server/agents/claude.js and
// codex.js at host API 1.34.0): every argument shellQuote'd, env prefix first.

export const PORT = 7777;
export const CORE = '/opt/aw';
export const CWD = '/Users/me/Projects/my-app';

export function claudeInner({ sessionId = 'card-1', addDirs = [], intent = 'fix the bug' } = {}) {
  const args = ['--session-id', 'live-1', '--permission-mode', 'auto'];
  for (const d of addDirs) args.push('--add-dir', d);
  args.push(
    '--mcp-config', JSON.stringify({ mcpServers: { 'agent-wrangler': { type: 'http', url: `http://127.0.0.1:${PORT}/mcp`, headers: { 'X-AW-Session': sessionId } } } }),
    '--allowedTools', 'mcp__agent-wrangler__list_sessions',
    '--settings', JSON.stringify({ tui: 'fullscreen', hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${CORE}/scripts/pr-attach-hook.mjs` }] }] } }),
    '--plugin-dir', `${CORE}/agent-skills`,
    '--plugin-dir', '/ext/foo/skills/foo',
  );
  return 'env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT '
    + `AW_SESSION_ID=${shellQuote(sessionId)} AW_PR_ATTACH_URL=${shellQuote(`http://127.0.0.1:${PORT}/pr-attach`)} `
    + `claude ${args.map(shellQuote).join(' ')} -- ${shellQuote(intent)}`;
}

export function codexInner({ sessionId = 'card-2', addDirs = [], intent = "it's broken" } = {}) {
  const instructions = `Skills:\n- links — attach links — ${CORE}/agent-skills/skills/links/SKILL.md\n- foo — x — /ext/foo/skills/foo/SKILL.md`;
  const args = ['-m', 'gpt-5', '--sandbox', 'workspace-write', '--ask-for-approval', 'never',
    '-c', `developer_instructions="${instructions}"`];
  for (const d of addDirs) args.push('--add-dir', d);
  args.push(
    '-c', `mcp_servers.agent-wrangler.url="http://127.0.0.1:${PORT}/mcp"`,
    '-c', 'mcp_servers.agent-wrangler.bearer_token_env_var="AW_MCP_TOKEN"',
  );
  return `AW_SESSION_ID=${shellQuote(sessionId)} AW_MCP_TOKEN=${shellQuote(sessionId)} codex ${args.map(shellQuote).join(' ')} ${shellQuote(intent)}`;
}

// A fake `sbx` for the injectable `run`: answers by subcommand, records calls.
export function fakeSbx({ sandboxes = [], secrets = ['anthropic', 'openai'], missing = false, daemonError = null } = {}) {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (missing) throw Object.assign(new Error('spawn sbx ENOENT'), { code: 'ENOENT' });
    const sub = args.join(' ');
    if (sub === 'version') return { stdout: 'sbx version v0.48.0\n' };
    if (sub === 'ls --json') {
      if (daemonError) throw Object.assign(new Error('Command failed'), { stderr: daemonError });
      return { stdout: JSON.stringify(sandboxes.map((name) => ({ name, status: 'running' }))) };
    }
    if (sub === 'secret ls -g') {
      return { stdout: `SCOPE      TYPE      NAME        SECRET\n${secrets.map((s) => `(global)   service   ${s}   (stored)`).join('\n')}\n\nCUSTOM SECRETS\n(global)   github.com   GITHUB_TOKEN   x\n` };
    }
    if (args[0] === 'stop' || args[0] === 'rm') {
      if (!sandboxes.includes(args[args.length - 1])) throw new Error('no such sandbox');
      return { stdout: '' };
    }
    throw new Error(`unexpected sbx ${sub}`);
  };
  return { run, calls };
}
