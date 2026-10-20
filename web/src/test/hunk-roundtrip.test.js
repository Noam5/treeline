// The seam the unit tests on either side cannot cover: a patch the diff pane
// builds from what it rendered, handed to real git in a real repository.
// Everything here is the production code path except the HTTP hop.
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { splitDiff, parseFileSection, hunkPatch } from '../components/DiffPane.jsx';
import { applyPatch } from '../../../server/src/git/ops.js';

const exec = promisify(execFile);
const git = async (dir, args) => (await exec('git', args, { cwd: dir })).stdout;

const dirs = [];
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

async function repoWith(name, committed, edited) {
  const dir = await mkdtemp(join(tmpdir(), 'gwc-hunk-'));
  dirs.push(dir);
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test User']);
  await writeFile(join(dir, name), committed);
  await git(dir, ['add', name]);
  await git(dir, ['commit', '-m', 'init']);
  await writeFile(join(dir, name), edited);
  return dir;
}

// Exactly what the pane does: split the patch, parse the file, rebuild one hunk.
function pickHunk(patch, index) {
  const file = splitDiff(patch).files[0];
  return hunkPatch(file, parseFileSection(file.lines).hunks[index]);
}

describe('a hunk patch built by the diff pane, applied by real git', () => {
  it('stages the chosen hunk and leaves the other in the working tree', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n') + '\n';
    const dir = await repoWith('a.txt', ten, ten.replace('l1\n', 'L1\n').replace('l10\n', 'L10\n'));
    const shown = await git(dir, ['diff', '--', 'a.txt']);

    const res = await applyPatch(dir, pickHunk(shown, 0), { cached: true });

    expect(res.stderr).toBe('');
    expect(res.ok).toBe(true);
    const staged = await git(dir, ['diff', '--cached']);
    expect(staged).toMatch(/^\+L1$/m);
    expect(staged).not.toMatch(/^\+L10$/m);
    expect(await git(dir, ['diff'])).toMatch(/^\+L10$/m);
  });

  it('survives a file with no newline at the end, marker and all', async () => {
    // The "\ No newline at end of file" marker rides inside the hunk body; get
    // it wrong and git calls the whole patch corrupt.
    const dir = await repoWith('b.txt', 'one\ntwo\nthree', 'one\ntwo\nTHREE');
    const shown = await git(dir, ['diff', '--', 'b.txt']);
    expect(shown).toMatch(/No newline at end of file/);

    const res = await applyPatch(dir, pickHunk(shown, 0), { cached: true });

    expect(res.stderr).toBe('');
    expect(res.ok).toBe(true);
    expect(await git(dir, ['diff', '--cached'])).toMatch(/^\+THREE$/m);
  });

  it('reverses cleanly, discarding that hunk from the working tree', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n') + '\n';
    const dir = await repoWith('c.txt', ten, ten.replace('l1\n', 'L1\n').replace('l10\n', 'L10\n'));
    const shown = await git(dir, ['diff', '--', 'c.txt']);

    const res = await applyPatch(dir, pickHunk(shown, 1), { reverse: true });

    expect(res.ok).toBe(true);
    const left = await git(dir, ['diff']);
    expect(left).toMatch(/^\+L1$/m);
    expect(left).not.toMatch(/^\+L10$/m);
  });
});
