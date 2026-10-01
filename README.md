# RING KINGS — 3D Multiplayer Wrestling (browser)

A small-scale but fully playable modern 3D wrestling game that runs in the browser.
Your seven GLB characters — **Max, Masked, Ajan, Rise, Cave, Rot and Lucky** — are the
playable wrestlers. Fight AI or real people online (authoritative server, room codes,
invite links), in five match types, in a lit arena with a reacting crowd, referee,
commentators, LED screens and ringside weapons.

```
npm install
npm run dev          # http://localhost:5173  (game server + client with hot reload)
```

---

## Contents
1. [Quick start](#quick-start) · 2. [Controls](#controls) · 3. [What's in the game](#whats-in-the-game)
4. [Deploying to Render](#deploying-to-render) · 5. [Gemini AI commentary (optional)](#gemini-ai-commentary-optional)
6. [Project structure](#project-structure) · 7. [Configuration (characters, attacks, modes…)](#configuration)
8. [Adding a character](#adding-a-character) · 9. [Testing](#testing) · 10. [How it works](#how-it-works) · 11. [Known limitations](#known-limitations)

---

## Quick start

Requirements: **Node 18+** (20 recommended), a WebGL2 browser (Chrome, Edge, Firefox, Safari 15+).

| Command | What it does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | game server on :3000 (auto-restart) + Vite client on **:5173** (proxies `/ws` and `/api`) |
| `npm run build` | build the production client into `dist/` |
| `npm start` | production: one Node process serves `dist/` **and** the WebSocket game server on `$PORT` (default 3000) |
| `npm test` | 29 automated tests (simulation, multiplayer, Gemini mock) |
| `npm run test:e2e` | browser end-to-end test against a running server (needs Chromium – see [Testing](#testing)) |
| `npm run assets` | re-generate the optimized character GLBs from `assets/source/` |

Play with a friend locally: run `npm run build && npm start`, open `http://localhost:3000`,
**PLAY WITH FRIEND → CREATE ROOM**, and open the invite link (`/?room=CODE`) in a second browser/tab
(or on another machine on your network using your IP).

## Controls

| Keyboard / mouse | Gamepad | Action |
|---|---|---|
| WASD | left stick | move (camera-relative) |
| Shift (hold) | RT | run (running + J = clothesline, + K = dropkick) |
| Space | A | jump (J/K in the air = aerial attack) |
| J / left click | X | punch – press repeatedly for a combo |
| K / right click | Y | kick |
| U (or J+K) | | heavy attack (breaks blocks) |
| E / L | B | grab — then **J** strike · **K** slam (hold S/back = suplex) · **E** throw / Irish whip (aim with WASD) |
| Q / I (hold) | RB | block — tapping just before a hit **parries**; tapping right after being grabbed **reverses** |
| C | LB | dodge / roll |
| F | D-pad up | context action: **pin**, pick up / drop item, climb in / roll out, climb turnbuckle, climb the cell, **tag** |
| G | D-pad down | throw the held item |
| X | LT | **special ability** |
| T | Back | taunt (builds special meter, crowd pops) |
| mouse (click to lock) / ← → | right stick | rotate camera · **V** toggles broadcast/free camera |
| mash buttons | mash | escape holds, get up faster, **kick out of pins** |
| Esc | Start | pause · **H** shows/hides the controls card |

## What's in the game

**Wrestlers** (stats in `shared/config/characters.js`):

| | Identity | Special (X) |
|---|---|---|
| **Max** | His hand-held iron weights are weapons: armed jabs/hooks, double smash, iron hammer (metal impacts, weapon damage) | Iron Barrage – dash + 5 weight strikes + double smash |
| **Masked** | Balanced default wrestler | Masked Driver – grab + sit-out powerbomb |
| **Ajan** | Gorilla: 2.2 m, 260 kg, 1700 HP, slow, super-armour vs light hits, attacks with the food in his left hand | **Silverback Crush** – locks on, leaps ~4 m, crashes onto the target (290 base damage ×1.55 power, shockwave, knock-back), cinematic camera, plays **`Ajan.mp3`** only when it lands. Meter + 16 s cooldown, range 1.2–9.5 m |
| **Rise** | Balanced athlete | Rising Uppercut – launcher |
| **Cave** | Standard brawler | Cave-In spear tackle |
| **Rot** | Standard, quick feet | Rot Spin – 360° heel kick |
| **Lucky** | 1.08 m tall, fastest runner/dodger, weak hits, low HP; high punches **whiff over his head**, can't lift big wrestlers | Clover Blitz – invulnerable dash-around flurry |

**Combat:** hitbox/hurt-capsule strikes with startup/active/recovery, combos, input buffering,
blocking (chip damage, guard break), parries, grab/hold/escape/reversal, body slam / suplex /
powerbomb (weight-checked), Irish whips into the ropes, throws over the top rope, ground attacks,
pins with a referee 3-count and mash-to-kick-out, KOs, hit-stop, knock-back scaled by weight.

**Ring & arena:** deformable ropes (rebounds, over-the-top-rope falls), turnbuckles (corner stun,
climb + diving splash), apron, roll out / climb in, ringside fighting, barricades, commentary desk,
steel steps, entrance walkway + stage + titantron, stands with ~1,700 animated spectators.

**Items:** steel chairs, kendo sticks, trash cans, tables (break when bodies land on them), the ring
bell, traffic cones — pick up, swing, overhead smash, throw, drop. Items Match: fans keep throwing more in.

**Modes:** Normal (1v1 or teams: player+player vs AI etc.), Free-For-All (3–6), Tag Team (2v2, legal
man + tags), Items Match, **Hell in a Cell** (steel cell with collision, climbable walls, dive off,
falls count anywhere). All modes work in single-player and online.

**Presentation:** PBR + ACES tone mapping, shadows, bloom, MSAA, vignette/impact FX, volumetric
light cones, LED ribbon boards, reacting crowd (stand/cheer/arms/camera flashes), referee and two
commentators (auto-rigged procedural NPCs), broadcast camera with shake/zoom and a cinematic Ajan
cam, synthesized spatial audio (impacts, ropes, bells, cage, crowd murmur/cheers/boos, grunts),
commentary subtitles + voice.

## Deploying to Render

The repo contains a **Render Blueprint** (`render.yaml`). One **Web Service** runs the
authoritative game server *and* serves the built client from the same origin — the most reliable
setup for WebSockets (no CORS, one URL to share).

### Option A — Blueprint (recommended)
1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. In Render: **New → Blueprint**, pick the repo. Render reads `render.yaml` and creates the
   `ring-kings` web service (`npm ci && npm run build`, start `npm start`, health check `/healthz`).
3. (Optional) In the service's **Environment** tab set `GEMINI_API_KEY` (see below). Leave it empty to
   use the built-in fallback commentary.
4. Deploy. Open `https://<your-service>.onrender.com` → share **PLAY WITH FRIEND** links.

### Option B — manual Web Service
**New → Web Service** → your repo, then:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Environment | `NODE_VERSION=20` (+ optional `GEMINI_API_KEY`, `GEMINI_TTS`, `ALLOWED_ORIGINS`) |

Render provides `PORT` automatically; WebSockets work on Render web services out of the box
(the server pings every 25 s so idle sockets aren't dropped).

**Free plan note:** free web services sleep after ~15 min idle; the first visit then takes about a
minute to wake up and in-progress rooms are lost on restart. Use a paid instance (Starter) for an
always-on game. Rooms live in memory, so run **one instance** (don't scale horizontally without
adding a shared room store).

### Option C — client as a separate Static Site (optional)
If you prefer the client on a Render Static Site: build command `npm ci && npm run build`,
publish directory `dist`, and set **`VITE_SERVER_URL=https://<your-game-server>.onrender.com`**
on the static site (build-time). On the server set `ALLOWED_ORIGINS=https://<your-static-site>.onrender.com`.

## Gemini AI commentary (optional)

The game always works without any API: a commentary engine turns game events into lines from a
built-in bank, voiced with the browser's speech synthesis (Settings → Voice commentary).

To let **Gemini** write the lines, set on the **server** (Render dashboard or `.env` locally):

```
GEMINI_API_KEY=your-key          # never put this in client code – the browser never sees it
GEMINI_MODEL=gemini-2.5-flash    # any generateContent text model
GEMINI_TTS=1                     # optional: AI voice via Gemini TTS (extra cost), then pick "AI voice" in Settings
GEMINI_RPM=40                    # optional: global requests/minute budget
```

Pipeline: game event → `CommentaryEngine` (filters to meaningful moments, cooldowns, priority queue —
never per frame) → server `/api/commentary` (rate-limited per client and globally, 3.5 s timeout,
circuit breaker) → Gemini → text; on any failure the fallback line is used. Voice: `/api/tts`
(Gemini TTS → WAV) or browser speech. In online matches the **server** generates the commentary
once and broadcasts it to everyone in the room. Example: `AJAN_SPECIAL_HIT` →
*"Ajan just crushed him! What an impact!"*

## Project structure

```
client/                 browser game (Vite + Three.js)
  index.html            page shell
  src/main.js           entry
  src/core/             Game (orchestrator/frame loop), AssetManager, Input, Settings
  src/anim/             AutoRig (skeleton + skin weights for the unrigged GLBs), PoseSolver (IK),
                        Clips (procedural animation library), Animator (state → pose, springs)
  src/render/           Renderer (post FX), ArenaBuilder, CrowdSystem, FighterView, NPCs (referee/
                        commentators), Effects (particles), ItemMeshes/ItemViews, ScreenDirector, Textures
  src/camera/           CameraSystem (broadcast camera, shake, cinematics)
  src/audio/            AudioSystem (synthesized SFX, crowd, spatial audio, samples)
  src/commentary/       CommentarySystem (subtitles, AI text, TTS / browser voice)
  src/net/              NetClient (WebSocket), endpoints
  src/sessions/         LocalSession (vs AI, runs the sim in-browser), OnlineSession (interpolation + prediction)
  src/ui/               UIManager (menus, character select, lobby, HUD, results)
  public/assets/        optimized character GLBs + Ajan.mp3
server/                 Node game server
  index.js              HTTP (static + API) + WebSocket entry
  LobbyManager.js       room codes, quick match, cleanup
  Room.js               lobby state + authoritative match loop (60 Hz sim, 20 Hz snapshots)
  gemini.js             optional Gemini text + TTS proxy (rate limits, breaker)
shared/                 runs on BOTH server and client
  config/               characters, attacks, abilities, items, gameModes, ai, arena  ← tweak here
  sim/                  World, FighterController, CombatSystem, GrappleSystem, ItemSystem,
                        AbilitySystem, MatchSystem (+referee), AISystem, Arena (physics), constants
  net/protocol.js       compact snapshot encoding
  commentary/           CommentaryEngine (events → commentary moments, fallback lines, prompts)
assets/source/          ORIGINAL uploaded GLBs + Ajan.mp3 (untouched)
tools/                  asset pipeline, dev runner, e2e test
tests/                  node:test suites
render.yaml             Render Blueprint
```

## Configuration

Everything gameplay-related is data in `shared/config/` (used by both server and client):

| File | Contents |
|---|---|
| `characters.js` | per-wrestler stats: health, height, radius, weight, walk/run speed, jump, attack power/speed, defense, grab strength, knock-back resistance, dodge speed/cooldown, stamina, special + cooldown + cost, moveset overrides, rig landmarks, stance overrides |
| `attacks.js` | every move: timings, damage, reach/height/radius of the hitbox, knock-back, launch, reaction, stun, hit-stop, sound, animation clip, combo chain; grapple paths |
| `abilities.js` | specials (Ajan's crush: range, lock time, air time, height, damage, radius, splash, cooldown via character, sound file, event name) |
| `items.js` | props: damage when swung/thrown, mass, bounce, durability, two-handed, breakable |
| `gameModes.js` | rules per mode: fighters, teams, win conditions, pins in-ring only, time limit, items, cage, tag |
| `ai.js` | Easy / Normal / Hard: reaction time, aggression, block/dodge/parry, combos, grabs, specials, items, pins, mash rate |
| `arena.js` | ring size/height/rope heights, rebound speeds, barricade/cage/desk/stands dimensions, spawns |

## Adding a character

1. Put the GLB in `assets/source/` and add it to the `MAP` in `tools/process-assets.mjs`, run `npm run assets`.
2. Copy an entry in `shared/config/characters.js` (new `id`, `name`, `model`, stats, `special`).
3. Rig landmarks (`rig`) are in the GLB's own normalized space; omit them and AutoRig estimates the
   joints automatically, or tune them with `client/tools/rigtest.html?ids=<id>&weights=1` and
   `client/tools/animtest.html?char=<id>` (open via `npm run dev`).

## Testing

* `npm test` — 29 tests: Lucky small & fast, Ajan heavy, no falling through ring/floor, rope/ring/apron
  collision, rope rebounds, hitboxes (incl. high attacks whiffing over Lucky), block/parry, weight-based
  knock-back, grapples & weight checks, escapes, Irish whips, **Ajan crush (damage, knock-back,
  `AJAN_SPECIAL_HIT` with `Ajan.mp3`, meter + cooldown, range check)**, items, pinfall & kick-out,
  climbing, every mode playing to a finish with AI, AI behaviour coverage, protocol round-trip,
  **real server: room codes, join, host rules, authoritative sync between two clients, disconnect
  hand-off to AI, quick match**, commentary engine, **Gemini text + TTS via a mock API**.
* `npm run test:e2e` — drives real Chromium against a running server: boot, portraits from the GLBs,
  character select, keyboard combat (punch, grab, slam, pin → pinfall), Ajan crush + `Ajan.mp3`
  playback, two browsers joining by room-code invite link and agreeing on positions.
  Set `E2E_URL` (default `http://localhost:3000`) and `CHROMIUM_PATH` to your Chrome/Chromium binary
  (`npm i -D playwright-core` is already a dev dependency).

## How it works

* **Unrigged models → animated wrestlers.** The supplied GLBs are static meshes with no skeleton.
  `AutoRig` builds a 17-bone skeleton from landmarks (`rig` in the character config, or estimated)
  and computes skin weights from distance-to-bone normalised by measured limb thickness, with
  anatomical masks; props held in the hands (Max's weights, Ajan's food) are weighted rigidly to the
  hand. Animation is procedural: two-bone IK limbs + FK torso driven by a clip library in
  body-relative units (so the same punch works for 1.08 m Lucky and 2.2 m Ajan), with a
  spring-damper on the pose for blending, floppy limbs when airborne and physical hit jolts.
* **One simulation everywhere.** `shared/sim` is plain JS. Vs-AI runs it in the browser; online,
  the server runs it at 60 Hz and clients only send inputs (`{mx, mz, held, pressed}` + sequence).
  Snapshots (~0.5–2 KB) go out at 20 Hz; remote wrestlers are interpolated ~100 ms in the past,
  your own wrestler is predicted locally with the shared locomotion code and reconciled against the
  server's acknowledged input. Events (hits, specials, pins…) ride along with snapshots and drive
  audio, effects, crowd, camera and commentary.
* **Physics** is controlled rather than fully ragdoll for reliable combat: capsule bodies,
  gravity, weight-scaled knock-back, rope springs/rebounds, apron/barricade/cage/desk collisions,
  item rigid bodies — plus spring-driven secondary motion on the rendered body.

## Known limitations

* The characters have no hand-authored animations (the GLBs contain none); all motion is procedural
  IK. It reads well at game camera distances but is not motion-captured quality.
* Ragdolls are approximated (controlled falls + spring physics), not full rigid-body ragdolls.
* Rooms are in-memory on a single server instance (fine for Render's single web service).
* AI voice (Gemini TTS) is opt-in and adds latency/cost; browser voices vary by OS.
* The default quality is **auto**: it steps down (ultra → high → medium → low) when the frame rate
  stays below 40 FPS. Low-end integrated GPUs should use *medium* or *low* in Settings.
