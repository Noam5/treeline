import { runGit } from './runner.js';

// Every tag in the repository, newest first.
//
// `creatordate` is the tag's own date for an annotated tag and the tagged
// commit's date for a lightweight one, so both kinds sort together on the one
// date a reader would expect. Sorting by name instead would put v10 before v9.
export async function getTags(cwd) {
  const r = await runGit(['tag', '--list', '--sort=-creatordate', '--format=%(refname:short)'], cwd);
  return { tags: r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) };
}
