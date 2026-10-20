// The cheap part of git's rules for branch and tag names (see `git help
// check-ref-format`), checked as a name is typed so the usual slips are caught
// before anything is sent. git still has the last word: if it refuses a name
// this lets through, its own error is shown.
//
// Returns why `raw` is not a usable name, or '' when it is. Surrounding
// whitespace does not count; the caller trims it off.
export function refNameError(raw) {
  const name = raw.trim();
  if (!name) return 'Enter a name.';
  if (/\s/.test(name)) return 'Names cannot contain spaces.';
  if (name.startsWith('-')) return 'Names cannot start with "-".';
  if (/[~^:?*[\\]/.test(name)) return 'Names cannot contain ~ ^ : ? * [ or \\.';
  if (name.includes('..')) return 'Names cannot contain "..".';
  return '';
}
