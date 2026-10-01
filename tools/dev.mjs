// `npm run dev` – game server (with auto-restart) + Vite client dev server.
// Open http://localhost:5173 (Vite proxies /ws and /api to the server on :3000).
import { spawn } from 'node:child_process';
const procs = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT || '3000' } }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--config', 'client/vite.config.js'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { console.error('process exited with', code); stop(); } }));
