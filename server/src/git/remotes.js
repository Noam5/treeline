import { runGit, REMOTE_TIMEOUT_MS } from './runner.js';

// --end-of-options: a remote named --upload-pack=<cmd> would otherwise run
// <cmd>. See ops.js.
const EOO = '--end-of-options';
const noPrompt = { GIT_TERMINAL_PROMPT: '0' };

// Network ops get the long timeout: a big fetch over a slow link is legitimate,
// a remote that stops answering is not, and either way the request must end.
async function run(cwd, args, { timeout = REMOTE_TIMEOUT_MS } = {}) {
  const r = await runGit(args, cwd, { env: noPrompt, timeout });
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr };
}

export const fetch = (cwd, remote = 'origin', opts) => run(cwd, ['fetch', EOO, remote], opts);
// pull is the exception: it drops its own --end-of-options and passes the
// remote on to an internal `git fetch` bare, where a leading dash makes it an
// option again. So a remote that looks like one is refused before git runs.
export const pull = async (cwd, remote = 'origin', opts) => (remote.startsWith('-')
  ? { ok: false, stdout: '', stderr: `'${remote}' is not a valid remote name` }
  : run(cwd, ['pull', EOO, remote], opts));
export const push  = (cwd, remote = 'origin', opts) => run(cwd, ['push', EOO, remote, 'HEAD'], opts);
