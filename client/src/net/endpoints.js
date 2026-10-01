// Where the game server lives.
//  • Same origin (default, recommended on Render: one Web Service serves both)
//  • VITE_SERVER_URL at build time, e.g. https://ring-kings-server.onrender.com
//    (when the client is deployed separately as a Render Static Site)
//  • ?server=… query parameter override (handy for testing)
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const configured = qs.get('server') || import.meta.env.VITE_SERVER_URL || '';

export function httpBase() {
  if (configured) return configured.replace(/\/$/, '');
  return typeof location !== 'undefined' ? location.origin : 'http://localhost:3000';
}

export function wsUrl() {
  const base = httpBase();
  return base.replace(/^http/, 'ws') + '/ws';
}

export function apiUrl(path) { return httpBase() + path; }
