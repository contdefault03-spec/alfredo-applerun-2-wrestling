// Browser end-to-end test (needs a running server: `npm run build && npm start`).
//   E2E_URL=http://localhost:3000 CHROMIUM_PATH=/path/to/chrome npm run test:e2e
// Covers: boot + menu, local match (strikes, grab, slam, pin), Ajan crush + Ajan.mp3,
// and online play between two browsers via a room-code invite link.
import { chromium } from 'playwright-core';

const URL = process.env.E2E_URL || 'http://localhost:3000';
const exe = process.env.CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? undefined : undefined);
const browser = await chromium.launch({ executablePath: exe || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? '✔' : '✘'} ${msg}`); if (!cond) failures++; };

async function page(settings = {}) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log('[pageerror]', e.message); failures++; });
  await p.addInitScript((s) => localStorage.setItem('ringkings.settings.v1', JSON.stringify({ voice: 'off', quality: 'low', showControls: false, ...s })), settings);
  return p;
}
const simWait = async (p, secs) => { const t0 = await p.evaluate(() => window.__game.session.world.time); await p.waitForFunction((t) => window.__game.session.world.time >= t, t0 + secs, { timeout: 120000 }); };

// 1. boot + menu + portraits from the GLBs
{
  const p = await page();
  await p.goto(URL);
  await p.waitForFunction("window.__game?.state === 'menu'", null, { timeout: 180000 });
  check(true, 'game boots to the main menu');
  check(await p.evaluate(() => Object.keys(window.__game.ui.portraits).length === 7), 'portraits rendered for all 7 GLB wrestlers');
  await p.click('[data-a=chars]');
  check(await p.$$eval('.card', (c) => c.length) === 7, 'character select shows 7 wrestlers');
  await p.context().close();
}
// 2. local match – strikes, grapple, slam, pin
{
  const p = await page();
  await p.goto(URL + '/?autostart=1&char=rise&opp=masked&diff=easy');
  await p.waitForFunction("window.__game?.session?.world?.match?.phase === 'live'", null, { timeout: 180000 });
  await p.evaluate(() => { const w = window.__game.session.world; const op = w.byId(2); op.isAI = false; op.input.mx = op.input.mz = 0; });
  const place = () => p.evaluate(() => { const w = window.__game.session.world; const me = w.byId(1), op = w.byId(2); op.x = me.x + Math.sin(me.yaw); op.z = me.z + Math.cos(me.yaw); op.state = 'idle'; op.vx = op.vz = 0; });
  const hp = () => p.evaluate(() => window.__game.session.world.byId(2).hp);
  await place(); const h0 = await hp();
  await p.keyboard.press('KeyJ'); await simWait(p, 0.5);
  check(await hp() < h0, 'punch (J) damages the opponent');
  await place(); await p.keyboard.press('KeyE'); await simWait(p, 0.5);
  check(await p.evaluate(() => window.__game.session.world.byId(1).state === 'hold'), 'grab (E) holds the opponent');
  await p.keyboard.press('KeyK'); await simWait(p, 1.5);
  check(await p.evaluate(() => ['down', 'getup'].includes(window.__game.session.world.byId(2).state)), 'slam (K) puts the opponent down');
  await p.evaluate(() => { const w = window.__game.session.world; const me = w.byId(1), op = w.byId(2); me.x = op.x - 0.5; me.z = op.z; op.downTimer = 5; });
  await p.keyboard.press('KeyF'); await simWait(p, 3.5);
  check(await p.evaluate(() => window.__game.session.world.match.method === 'pinfall'), 'pin (F) wins by pinfall after the referee’s 3-count');
  await p.context().close();
}
// 3. Ajan special + Ajan.mp3
{
  const p = await page();
  await p.goto(URL + '/?autostart=1&char=ajan&opp=lucky&diff=easy');
  await p.waitForFunction("window.__game?.session?.world?.match?.phase === 'live'", null, { timeout: 180000 });
  await p.keyboard.press('KeyH'); // user gesture → unlock audio
  await p.evaluate(() => { const w = window.__game.session.world; const me = w.byId(1), op = w.byId(2); me.meter = 100; op.isAI = false; op.input.mx = op.input.mz = 0; op.x = me.x + 4; op.z = me.z + 1; op.state = 'idle'; });
  await p.keyboard.press('KeyX');
  await simWait(p, 2.2);
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ hp: window.__game.session.world.byId(2).hp, sample: window.__audioLog.find((l) => l.name === 'sample:Ajan.mp3') }));
  check(r.hp < 500, `Ajan crush deals massive damage (Lucky hp ${r.hp})`);
  check(!!r.sample && r.sample.duration > 1, 'Ajan.mp3 decoded and played when the crush landed');
  await p.context().close();
}
// 4. online: invite link + room code, authoritative sync
{
  const A = await page({ name: 'Alice', lastChar: 'ajan' }), B = await page({ name: 'Bob', lastChar: 'lucky' });
  await A.goto(URL);
  await A.waitForFunction("window.__game?.state === 'menu'", null, { timeout: 180000 });
  await A.click('[data-a=friend]'); await A.click('[data-a=create]');
  await A.waitForFunction(() => document.querySelector('#rc')?.textContent?.length === 5, null, { timeout: 20000 });
  const code = await A.textContent('#rc');
  check(/^[A-Z2-9]{5}$/.test(code), `room code ${code}`);
  await B.goto(URL + '/?room=' + code);
  await B.waitForFunction("window.__game?.state === 'friend'", null, { timeout: 180000 });
  await B.click('[data-a=join]');
  await B.waitForFunction("window.__game?.state === 'lobby'", null, { timeout: 20000 });
  await A.waitForFunction(() => document.querySelectorAll('#slots .slot').length === 2, null, { timeout: 10000 });
  await A.click('[data-a=start]');
  await Promise.all([A, B].map((p) => p.waitForFunction("window.__game?.session?.match?.phase === 'live'", null, { timeout: 60000 })));
  await A.keyboard.down('KeyW'); await A.waitForTimeout(1500); await A.keyboard.up('KeyW'); await A.waitForTimeout(1200);
  const pos = (p) => p.evaluate(() => { const f = window.__game.session.view().fighters.find((x) => x.charId === 'ajan'); return [f.x, f.z]; });
  const [pa, pb] = [await pos(A), await pos(B)];
  check(Math.hypot(pa[0] + 2.2, pa[1] + 2.2) > 0.3, 'host moved their wrestler online');
  check(Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 0.3, `both browsers agree on positions (${pa.map((v) => v.toFixed(2))} vs ${pb.map((v) => v.toFixed(2))})`);
  await A.context().close(); await B.context().close();
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll end-to-end checks passed');
process.exit(failures ? 1 : 0);
