import { runGit } from './runner.js';

// List stash entries as { ref: 'stash@{0}', message: 'WIP on main: ...' }.
export async function listStashes(cwd) {
  const { stdout } = await runGit(['stash', 'list', '--format=%gd%x1f%gs'], cwd);
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [ref, message] = line.split('\x1f');
    return { ref, message: message || '' };
  });
}
