import { resolve } from 'node:path';

// Changes to a repository run one at a time. Two at once — a double-clicked
// button, a stage racing a commit — would fight over .git/index.lock, and the
// loser fails with a lock error the user did nothing to cause. Reads are not
// queued: git reads tolerate a concurrent writer, and a slow push must not
// freeze the history view.

// The last job queued per key. It never rejects, so a failed job does not
// poison the ones queued behind it.
const tails = new Map();

export function runExclusive(key, fn) {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  // Forget an idle key, unless a later job has queued behind this one.
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}

// Wraps a route handler that changes the repository named in the request
// body, so it waits its turn behind other changes to that repository. The
// turn ends when the handler finishes, not when the client stops listening:
// an aborted request's git command is still running.
export function serialized(handler) {
  return (req, res, next) => {
    const repo = req.body?.repo;
    if (typeof repo !== 'string' || !repo) return handler(req, res, next);
    return runExclusive(resolve(repo), () => handler(req, res, next));
  };
}
