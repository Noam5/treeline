import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function run(dir, args) {
  const { stdout } = await exec('git', args, { cwd: dir });
  return stdout;
}

export async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'gwc-'));
  await run(dir, ['init', '-b', 'main']);
  await run(dir, ['config', 'user.email', 'test@example.com']);
  await run(dir, ['config', 'user.name', 'Test User']);
  return dir;
}

export async function commitFile(dir, name, content, message) {
  await writeFile(join(dir, name), content);
  await run(dir, ['add', name]);
  await run(dir, ['commit', '-m', message]);
}

export async function cleanup(dir) {
  await rm(dir, { recursive: true, force: true });
}

// A repo stopped mid-merge with two conflicts: `both.txt` changed on both
// sides (UU) and `gone.txt` deleted on main but changed on `feat` (DU). The
// merge's own non-zero exit is expected, so it is not allowed to throw.
export async function makeConflict() {
  const dir = await makeRepo();
  await writeFile(join(dir, 'both.txt'), 'base\n');
  await writeFile(join(dir, 'gone.txt'), 'base\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-m', 'init']);
  await run(dir, ['checkout', '-b', 'feat']);
  await commitFile(dir, 'both.txt', 'theirs\n', 'feat edits both');
  await commitFile(dir, 'gone.txt', 'theirs\n', 'feat edits gone');
  await run(dir, ['checkout', 'main']);
  await commitFile(dir, 'both.txt', 'ours\n', 'main edits both');
  await run(dir, ['rm', '-q', 'gone.txt']);
  await run(dir, ['commit', '-m', 'main deletes gone']);
  await exec('git', ['merge', '--no-edit', 'feat'], { cwd: dir }).catch(() => {});
  return dir;
}

// A linear history of `count` empty commits on main, each with a one-line
// message `subjectBytes` long, and the root commit tagged `root`. Long
// messages make the formatted log as big as a deep history's without making
// tens of thousands of commits. One fast-import process writes it all.
export async function makeBigHistory(dir, { count, subjectBytes }) {
  const parts = [];
  for (let i = 1; i <= count; i++) {
    const msg = `${i} ${'x'.repeat(subjectBytes)}\n`;
    parts.push(`commit refs/heads/main\nmark :${i}\n`
      + `committer Test User <test@example.com> ${1600000000 + i} +0000\n`
      + `data ${Buffer.byteLength(msg)}\n${msg}`
      + (i > 1 ? `from :${i - 1}\n` : '') + '\n');
  }
  parts.push('reset refs/tags/root\nfrom :1\n\n');
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['fast-import', '--quiet'], { cwd: dir, stdio: ['pipe', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`fast-import exited ${code}`))));
    child.stdin.end(parts.join(''));
  });
}
