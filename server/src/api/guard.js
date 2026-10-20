// Listening on loopback keeps other machines out, but not other web pages: any
// site open in the user's browser can send requests to 127.0.0.1. This turns
// those away, so only the app's own window (or a non-browser client, which
// already runs as the user) gets answered.
//
// - Host: a page that rebinds its own DNS name to 127.0.0.1 counts as
//   same-origin to the browser and can read every response. Its requests
//   still carry that name in Host, so anything but a loopback name is refused.
// - Sec-Fetch-Site: set by the browser on every request it sends. A request
//   from any other site, including another port on localhost, is not
//   'same-origin'. 'none' is a navigation the user started themselves.
// - Origin: catches cross-site requests from browsers too old to send
//   Sec-Fetch-Site. Only a loopback origin is allowed, not this exact one:
//   in dev the window is Vite's (port 5173) and Vite proxies /api here.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const ALLOWED_SITES = new Set(['same-origin', 'none']);

const hostnameOf = (host) => (host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]);

function originIsLoopback(origin) {
  try { return LOOPBACK.has(new URL(origin).hostname); } catch { return false; }
}

export function localOnly(req, res, next) {
  const host = req.headers.host ?? '';
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  const allowed = LOOPBACK.has(hostnameOf(host))
    && (site === undefined || ALLOWED_SITES.has(site))
    && (origin === undefined || originIsLoopback(origin));
  if (allowed) return next();
  res.status(403).json({ ok: false, error: 'Forbidden' });
}
