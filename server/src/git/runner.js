import { spawn } from 'node:child_process';

// How long a git command may run before it is killed. Local commands are
// bounded by the disk, but can still be slow on a huge repo or behind a commit
// hook; network ops get far longer, since a large fetch over a slow link is
// legitimate. Either way a stalled command ends with an error, not a UI that
// waits forever.
export const LOCAL_TIMEOUT_MS = 2 * 60 * 1000;
export const REMOTE_TIMEOUT_MS = 10 * 60 * 1000;

const MAX_BUFFER = 50 * 1024 * 1024;

// `input`, when given, is written to git's stdin. Stdin is always closed, with
// or without input: a git command that reads it (e.g. `apply -`) would
// otherwise wait forever for an EOF that never comes.
//
// Output is held in memory, up to `maxBuffer` bytes; a command that prints
// more is killed and fails, rather than returning a part of it as if it were
// all. A caller with more to read than that (a deep history's log) passes
// `onStdout`, which receives stdout chunk by chunk as it arrives; stdout is
// then neither held here nor capped, and the result's stdout is empty.
//
// Never rejects. A command that exceeds `timeout` (ms) resolves with ok:false
// and timedOut:true.
export function runGit(args, cwd, {
  env, input, timeout = LOCAL_TIMEOUT_MS, maxBuffer = MAX_BUFFER, onStdout,
} = {}) {
  return new Promise((resolve) => {
    // Its own process group, so a timeout can kill what git started too (ssh,
    // a remote helper, a hook). Those inherit git's stdout; killing git alone
    // would leave them holding the pipe open, and the result would never come.
    let child;
    try {
      child = spawn('git', args, { cwd, env: { ...process.env, ...env }, detached: true });
    } catch (e) {
      // Some failures (E2BIG, an argument list past ARG_MAX) throw here rather
      // than arriving as an 'error' event.
      resolve({ ok: false, code: 1, stdout: '', stderr: e.message });
      return;
    }
    const out = [], err = [];
    let size = 0;
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out).toString(), ...result });
    };
    const killTree = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const collect = (chunks) => (chunk) => {
      size += chunk.length;
      if (size > maxBuffer) {
        killTree();
        finish({ ok: false, code: 1, stderr: `git ${gitCommand(args)}: output too large` });
        return;
      }
      chunks.push(chunk);
    };

    const timer = setTimeout(() => {
      killTree();
      finish({ ok: false, code: 1, timedOut: true,
        stderr: `git ${gitCommand(args)} timed out after ${formatMs(timeout)}` });
    }, timeout);

    child.stdout.on('data', onStdout ?? collect(out));
    child.stderr.on('data', collect(err));
    // Spawn failures (a missing cwd, no git on PATH) arrive here, not as an exit.
    child.on('error', (e) => finish({ ok: false, code: 1, stderr: e.message }));
    child.on('close', (code) => {
      const stderr = Buffer.concat(err).toString();
      finish({ ok: code === 0, code: code ?? 1, stderr });
    });

    // A child that exits before the write lands makes stdin emit EPIPE; the
    // exit is already being reported by the close handler, so ignore it.
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

// The subcommand, for messages: `-c key=value` pairs come before it.
function gitCommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '-C') { i++; continue; }
    if (!args[i].startsWith('-')) return args[i];
  }
  return args[0] ?? '';
}

function formatMs(ms) {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms >= 1000) return `${Math.round(ms / 1000)}s`;
  return `${ms}ms`;
}
