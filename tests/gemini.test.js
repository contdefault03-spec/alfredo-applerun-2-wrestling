// Gemini integration test against a local mock of the Gemini REST API
// (verifies request shape, response parsing, WAV wrapping, key never sent to clients).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const MOCK_PORT = 4100 + Math.floor(Math.random() * 50);
const PORT = 4200 + Math.floor(Math.random() * 50);
const seen = [];
let mock, server;

test.before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push({ url: req.url, key: req.headers['x-goog-api-key'], body: j });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('tts')) {
        const pcm = Buffer.alloc(4800); // 0.1 s of silence @ 24 kHz
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }));
      } else {
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '"Ajan just crushed him! What an impact!"' }] } }] }));
      }
    });
  }).listen(MOCK_PORT);
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: 'test-key-123', GEMINI_TTS: '1', GEMINI_API_BASE: `http://localhost:${MOCK_PORT}/v1beta`, GEMINI_TTS_MODEL: 'mock-tts' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('server on')) res(); }));
});
test.after(() => { server?.kill(); mock?.close(); });

test('AI commentary via Gemini (mocked) – key stays on the server', async () => {
  const cfg = await (await fetch(`http://localhost:${PORT}/api/config`)).json();
  assert.deepEqual([cfg.ai, cfg.tts], [true, true]);
  assert.ok(!JSON.stringify(cfg).includes('test-key'), 'key not exposed');
  const r = await fetch(`http://localhost:${PORT}/api/commentary`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'AJAN_SPECIAL_HIT', ctx: { a: 'AJAN', b: 'LUCKY', aChar: 'ajan', bChar: 'lucky' } }) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.text, 'Ajan just crushed him! What an impact!');
  const req = seen.find((s) => s.url.includes(':generateContent') && !s.url.includes('tts'));
  assert.equal(req.key, 'test-key-123');
  assert.match(req.body.contents[0].parts[0].text, /AJAN_SPECIAL_HIT/);
});

test('AI voice via Gemini TTS (mocked) returns a WAV', async () => {
  const r = await fetch(`http://localhost:${PORT}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'What an impact!', speaker: 1 }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/wav');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.slice(0, 4).toString(), 'RIFF');
  assert.equal(buf.readUInt32LE(24), 24000);
});

test('commentary endpoint rate-limits a single client', async () => {
  let ok = 0, limited = 0;
  for (let i = 0; i < 25; i++) {
    const r = await fetch(`http://localhost:${PORT}/api/commentary`, { method: 'POST', body: JSON.stringify({ key: 'BIG_HIT', ctx: {} }) });
    if (r.status === 200) ok++; else limited++;
  }
  assert.ok(limited > 0 && ok > 0, `ok ${ok} limited ${limited}`);
});
