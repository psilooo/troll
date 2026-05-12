# Troll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page web experience that loops a silent video, listens for a click on an invisible circular hotspot, crossfades to a second video that plays once, then fades to a pure white screen. Deploy as a static site on Vercel with the videos hosted on Vercel Blob.

**Architecture:** Plain HTML/CSS/JS, no build step. Two stacked `<video>` elements share the viewport with `object-fit: cover`. A state machine (`LOADING → IDLE → REVEAL → WHITE`) drives opacity transitions between them. Mobile (touch / narrow viewport) bypasses video entirely with a blocker message. The encoded MP4s live on Vercel Blob with immutable URLs (`--add-random-suffix`); the static page itself is < 5 KB.

**Tech Stack:** HTML, CSS, JavaScript (ES2020, no transpile), ffmpeg (libx264), Vercel CLI (`vercel`), GitHub CLI (`gh`), Vercel Blob.

**Spec:** [`docs/superpowers/specs/2026-05-12-troll-design.md`](../specs/2026-05-12-troll-design.md)

## Prerequisites

Before starting, verify these tools are available and authenticated:

```bash
which gh ffmpeg vercel npm    # all must resolve
gh auth status                 # must show "Logged in to github.com"
vercel whoami                  # must print a user/team; if not, run `vercel login`
ffmpeg -version | head -1      # 6.x or newer recommended
```

Source video files must exist at:
- `videos/looper.mov` (3840×2160 @ 60fps, ~152 MB)
- `videos/on_click.mp4` (1920×1080 @ 24fps, ~3.5 MB)

If `vercel` CLI is older than 53.4.0: `npm i -g vercel@latest`.

---

## File Map

What the finished project looks like:

| Path | Purpose |
|---|---|
| `index.html` | Markup: video elements, loading overlay, mobile blocker, preconnect to Blob origin |
| `style.css` | Full styling contract from spec — `object-fit: cover`, explicit z-index, transitions, mobile blocker |
| `main.js` | Mobile detection, hotspot hit-test, state machine, video lifecycle, autoplay fallback |
| `tests/hotspot.html` | Standalone in-browser test harness for `isInHotspot()` math |
| `scripts/encode.sh` | ffmpeg pipeline: re-encode `looper`, remux `on_click`, both with `+faststart` |
| `videos/` | Source masters (gitignored) |
| `encoded/` | Encoded outputs (gitignored; uploaded to Blob) |
| `vercel.json` | `framework: null`, security headers, clean URLs |
| `.gitignore` | Excludes videos/, encoded/, .env.local, node_modules, .DS_Store |
| `README.md` | Brief project overview + run instructions |
| `docs/superpowers/specs/2026-05-12-troll-design.md` | Approved design spec (already committed) |
| `docs/superpowers/plans/2026-05-12-troll-implementation.md` | This file |

---

## Task 1: Project scaffold

Set up all the files that don't depend on anything else. Keep them stub-shaped so the next tasks can fill in content.

**Files:**
- Create: `/Users/samsepiol/Code/troll/.gitignore`
- Create: `/Users/samsepiol/Code/troll/README.md`
- Create: `/Users/samsepiol/Code/troll/vercel.json`
- Create: `/Users/samsepiol/Code/troll/index.html` (empty shell)
- Create: `/Users/samsepiol/Code/troll/style.css` (empty)
- Create: `/Users/samsepiol/Code/troll/main.js` (empty)
- Create: `/Users/samsepiol/Code/troll/scripts/encode.sh` (empty placeholder)
- Create: `/Users/samsepiol/Code/troll/tests/hotspot.html` (empty placeholder)

- [ ] **Step 1: Write `.gitignore`**

```
# OS
.DS_Store

# Editors
.vscode/
.idea/

# Vercel
.vercel/
.env.local
.env*.local

# Project
videos/
encoded/
node_modules/
```

- [ ] **Step 2: Write `README.md`**

```markdown
# troll

Single-page video experience: looping backdrop, invisible hotspot, crossfade to a second video, fade to white.

## Local dev

    vercel dev

Open <http://localhost:3000>.

## Encoding videos

Source masters live in `videos/` (gitignored). Encode for the web:

    bash scripts/encode.sh

Outputs land in `encoded/` (gitignored). Upload to Vercel Blob:

    vercel blob put encoded/looper.mp4    --access public --add-random-suffix --cache-control-max-age 31536000
    vercel blob put encoded/on_click.mp4  --access public --add-random-suffix --cache-control-max-age 31536000

Paste the returned URLs into the `VIDEOS` constant in `main.js`.

## Design

See [`docs/superpowers/specs/2026-05-12-troll-design.md`](docs/superpowers/specs/2026-05-12-troll-design.md).
```

- [ ] **Step 3: Write `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "cleanUrls": true,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "Permissions-Policy", "value": "geolocation=(), camera=(), microphone=(), payment=()" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Create empty stubs for `index.html`, `style.css`, `main.js`, `scripts/encode.sh`, `tests/hotspot.html`**

```bash
mkdir -p scripts tests
touch index.html style.css main.js scripts/encode.sh tests/hotspot.html
```

- [ ] **Step 5: Verify the file tree**

```bash
ls -la /Users/samsepiol/Code/troll
```

Expected output includes: `.gitignore`, `README.md`, `vercel.json`, `index.html`, `style.css`, `main.js`, `scripts/`, `tests/`, `videos/`, `docs/`.

- [ ] **Step 6: Commit**

```bash
cd /Users/samsepiol/Code/troll
git add .gitignore README.md vercel.json index.html style.css main.js scripts/encode.sh tests/hotspot.html
git commit -m "scaffold: gitignore, readme, vercel.json, empty source stubs"
```

---

## Task 2: Encoding pipeline

Write the ffmpeg script per the spec, run it, verify the encoded outputs sit comfortably inside the size budget.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/scripts/encode.sh`

- [ ] **Step 1: Write `scripts/encode.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p encoded

# Loop: 4K60 master → 1080p60 H.264 CRF 22, no audio, faststart, explicit BT.709
# tagging so browsers don't drift between BT.601/BT.709 defaults.
ffmpeg -y -i videos/looper.mov \
  -vf "scale=1920:1080:flags=lanczos" \
  -r 60 \
  -c:v libx264 -preset slow -crf 22 -profile:v high -level 4.2 -pix_fmt yuv420p \
  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -map 0:v:0 -an -movflags +faststart \
  encoded/looper.mp4

# Reveal: 1080p24 master, already small — just remux to add faststart.
# -map 0:v:0 -an is defensive: if a future master gains an audio track, drop it.
ffmpeg -y -i videos/on_click.mp4 \
  -map 0:v:0 -an \
  -c copy -movflags +faststart \
  encoded/on_click.mp4

du -h encoded/*
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/encode.sh
```

- [ ] **Step 3: Run it**

```bash
bash scripts/encode.sh
```

Expected: the `looper` encode takes ~30–90 seconds (CPU-bound, `-preset slow`); the `on_click` remux is near-instant. Final `du -h` line should show `looper.mp4` between 8 MB and 25 MB and `on_click.mp4` ≈ 3.5 MB. If `looper.mp4` is above 25 MB, increase `-crf` to 24 and re-run. If it's below 8 MB, the encode is fine but worth a visual check for blockiness on flat-color regions.

- [ ] **Step 4: Verify faststart on both outputs**

```bash
ffprobe -v trace -i encoded/looper.mp4 2>&1   | grep -E "type:'(moov|mdat)'" | head -2
ffprobe -v trace -i encoded/on_click.mp4 2>&1 | grep -E "type:'(moov|mdat)'" | head -2
```

Expected for each: `moov` appears BEFORE `mdat` (lower offset). If `moov` is after `mdat`, faststart didn't apply — investigate ffmpeg flags.

- [ ] **Step 5: Commit the script (encoded outputs stay gitignored)**

```bash
git add scripts/encode.sh
git commit -m "feat: ffmpeg encode pipeline for loop + reveal"
```

---

## Task 3: HTML markup

Static markup matching the DOM structure in the spec. Use a placeholder Blob origin in the `preconnect` link for now; we'll update it in Task 8.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/index.html`

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>troll</title>
  <!-- Preconnect warms TCP/TLS to the Blob CDN before <video> ranges fetch.
       Update the href once the Blob store URL is known. -->
  <link rel="preconnect" href="https://example.public.blob.vercel-storage.com">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="white"></div>
  <video id="reveal" muted playsinline      preload="auto"></video>
  <video id="loop"   muted playsinline loop preload="auto" autoplay></video>
  <div id="loading"></div>
  <div id="mobile-blocker">This experience is desktop only.</div>
  <script src="/main.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: Verify the file parses**

```bash
# Quick syntactic check via a browser-equivalent parser; falls back to a grep
# if no parser is available. The key thing is no missing closing tags.
head -1 index.html | grep -q '<!doctype html>'
grep -c '</video>' index.html  # expect 2
grep -c '</body>' index.html   # expect 1
```

Expected: `</video>` appears 2 times, `</body>` once.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: html markup with two videos, loading overlay, mobile blocker"
```

---

## Task 4: CSS

Full styling contract from the spec — `object-fit: cover`, explicit z-index, opacity transition, mobile blocker rules.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/style.css`

- [ ] **Step 1: Write `style.css`**

```css
html, body {
  margin: 0;
  height: 100%;
  background: #000;
  overflow: hidden;
}

#loop, #reveal {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  object-fit: cover;
  transition: opacity 500ms ease-out;
  will-change: opacity;
}

#loop    { z-index: 3; opacity: 1; }
#reveal  { z-index: 2; opacity: 1; }

#white {
  position: fixed;
  inset: 0;
  background: #fff;
  z-index: 1;
}

#loading {
  position: fixed;
  inset: 0;
  background: #000;
  z-index: 4;
  transition: opacity 200ms ease-out;
}

#loading.hidden { opacity: 0; pointer-events: none; }

#mobile-blocker {
  display: none;
  position: fixed;
  inset: 0;
  align-items: center;
  justify-content: center;
  background: #000;
  color: #fff;
  font: 16px/1.5 system-ui, -apple-system, sans-serif;
  text-align: center;
  padding: 1rem;
  z-index: 10;
}

.mobile #mobile-blocker { display: flex; }
.mobile #loop, .mobile #reveal, .mobile #loading { display: none; }
```

- [ ] **Step 2: Verify in a browser (manual)**

Open `index.html` directly in a browser (`file://` is fine for this check). Expected:
- Solid black screen (since videos have no `src` yet and the `#loading` overlay is opaque black).
- No layout errors in DevTools.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: styling contract — object-fit cover, z-index, fade transitions, mobile blocker"
```

---

## Task 5: Hotspot hit-test (TDD)

The hotspot math is the one piece with pure-function semantics — write the test page first, then implement until it passes.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/tests/hotspot.html`
- Modify: `/Users/samsepiol/Code/troll/main.js`

- [ ] **Step 1: Write the failing test harness `tests/hotspot.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>hotspot tests</title>
  <style>
    body { font: 14px/1.5 ui-monospace, monospace; padding: 1rem; background: #111; color: #eee; }
    .pass { color: #5f5; } .fail { color: #f55; }
  </style>
</head>
<body>
  <h1>Hotspot hit-test cases</h1>
  <ol id="results"></ol>
  <script type="module">
    import { isInHotspot, HOTSPOT, VIDEO_W, VIDEO_H } from '/main.js';

    const results = document.getElementById('results');
    let passes = 0, fails = 0;

    function fakeEvent(clientX, clientY) { return { clientX, clientY }; }

    function check(label, viewport, hotspot, clickPx, expected) {
      // Stub the viewport size for this case
      const origW = window.innerWidth, origH = window.innerHeight;
      Object.defineProperty(window, 'innerWidth',  { value: viewport[0], configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: viewport[1], configurable: true });
      Object.assign(HOTSPOT, hotspot);
      const got = isInHotspot(fakeEvent(...clickPx));
      const ok = (got === expected);
      const li = document.createElement('li');
      li.className = ok ? 'pass' : 'fail';
      li.textContent = `${ok ? 'PASS' : 'FAIL'}  ${label} — expected ${expected}, got ${got}`;
      results.appendChild(li);
      ok ? passes++ : fails++;
      Object.defineProperty(window, 'innerWidth',  { value: origW, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: origH, configurable: true });
    }

    // Center hotspot, 16:9 viewport matching video aspect: click on center hits.
    check('center hit at 1920x1080', [1920, 1080], { x: 0.5, y: 0.5, r: 0.08 },
      [1920 * 0.5, 1080 * 0.5], true);

    // Same hotspot, ultrawide 21:9 viewport: click at video-center (which is
    // still the viewport center under cover) should still hit.
    check('center hit at 2560x1080 (21:9)', [2560, 1080], { x: 0.5, y: 0.5, r: 0.08 },
      [2560 * 0.5, 1080 * 0.5], true);

    // 21:9 viewport: the hotspot at video x=0.5 should still be at viewport
    // x=0.5 because cover centers horizontally. But a click at viewport x=0.1
    // (far-left) maps to a video x that's off the cropped-in edge — miss.
    check('far-left miss at 2560x1080', [2560, 1080], { x: 0.5, y: 0.5, r: 0.08 },
      [256, 540], false);

    // Hotspot in upper-left of video frame at 16:9 viewport.
    check('upper-left hit at 1920x1080', [1920, 1080], { x: 0.2, y: 0.2, r: 0.05 },
      [1920 * 0.2, 1080 * 0.2], true);

    // Click just outside the hotspot radius.
    check('just outside radius', [1920, 1080], { x: 0.5, y: 0.5, r: 0.05 },
      [1920 * 0.5 + 1920 * 0.05 + 5, 1080 * 0.5], false);

    // Narrow tall viewport (vertical crop): video x=0.5 still at viewport x=0.5.
    check('narrow viewport hit at 1080x1920', [1080, 1920], { x: 0.5, y: 0.5, r: 0.08 },
      [540, 960], true);

    const summary = document.createElement('p');
    summary.textContent = `${passes} pass, ${fails} fail`;
    summary.className = fails === 0 ? 'pass' : 'fail';
    results.appendChild(summary);
  </script>
</body>
</html>
```

- [ ] **Step 2: Run the failing test**

```bash
cd /Users/samsepiol/Code/troll
python3 -m http.server 8000 &
SERVER_PID=$!
sleep 1
open "http://localhost:8000/tests/hotspot.html"
```

Expected: page loads, but every test row shows FAIL because `main.js` doesn't export `isInHotspot`, `HOTSPOT`, etc. yet. The browser console will show `SyntaxError: The requested module '/main.js' does not provide an export named 'isInHotspot'`. That's the expected "test fails for the right reason" gate.

Kill the server when done with this step: `kill $SERVER_PID`.

- [ ] **Step 3: Implement `isInHotspot` in `main.js`**

Replace the empty `main.js` with:

```js
// Hotspot is anchored to the video content (not the viewport). Calibrate against
// the encoded 1920×1080 loop video; values then work at any viewport aspect ratio.
export const VIDEO_W = 1920;
export const VIDEO_H = 1080;
export const HOTSPOT = { x: 0.5, y: 0.5, r: 0.08 }; // calibration placeholder

// Map a screen-pixel pointer event back to video-pixel coords by inverting the
// object-fit: cover transform, then do a circular hit-test in video pixels.
export function isInHotspot(e) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.max(vw / VIDEO_W, vh / VIDEO_H);
  const sw = VIDEO_W * scale, sh = VIDEO_H * scale;
  const ox = (sw - vw) / 2, oy = (sh - vh) / 2;
  const px = (e.clientX + ox) / scale;
  const py = (e.clientY + oy) / scale;
  const cx = HOTSPOT.x * VIDEO_W;
  const cy = HOTSPOT.y * VIDEO_H;
  const rpx = HOTSPOT.r * VIDEO_W;
  return Math.hypot(px - cx, py - cy) < rpx;
}
```

- [ ] **Step 4: Update `index.html` to load `main.js` as a module**

The test harness uses `import` so `main.js` must be served as a module. In `index.html`, change:

```html
<script src="/main.js" defer></script>
```

to:

```html
<script src="/main.js" type="module"></script>
```

(`type="module"` already implies deferred execution.)

- [ ] **Step 5: Re-run the test harness**

```bash
python3 -m http.server 8000 &
SERVER_PID=$!
sleep 1
open "http://localhost:8000/tests/hotspot.html"
```

Expected: all 6 rows show PASS in green; summary reads `6 pass, 0 fail`.

If any test fails: read the FAIL message, eyeball the math, fix `isInHotspot`. The most common bug is sign error in `ox`/`oy` — they should be POSITIVE because `(scaled_dim - viewport_dim)` is positive when the scaled image overflows.

Kill the server: `kill $SERVER_PID`.

- [ ] **Step 6: Commit**

```bash
git add tests/hotspot.html main.js index.html
git commit -m "feat: hotspot hit-test in video-pixel space + browser test harness"
```

---

## Task 6: Mobile blocker + bootstrap

Wire up the early-bail path for touch / narrow-viewport devices. Nothing else in `main.js` runs on mobile.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/main.js`

- [ ] **Step 1: Add the mobile guard and `initExperience` shell to `main.js`**

Append to `main.js` (below the hotspot code):

```js
// ---------- Mobile blocker ----------
const isMobile = window.matchMedia('(pointer: coarse)').matches
              || window.innerWidth < 900;

if (isMobile) {
  document.body.classList.add('mobile');
  // Don't load any video. The mobile blocker is shown by CSS.
} else {
  initExperience();
}

function initExperience() {
  // Filled in by later tasks.
  console.log('[troll] desktop init');
}
```

- [ ] **Step 2: Verify mobile blocker manually**

```bash
python3 -m http.server 8000 &
SERVER_PID=$!
sleep 1
open "http://localhost:8000/"
```

Open Chrome DevTools → device toolbar (Cmd+Shift+M) → choose "iPhone 14". The blocker message "This experience is desktop only." should be visible. Switch back to "Responsive" at a width ≥ 900 — the screen should go solid black again (videos still have no src, that's expected for now). The console should log `[troll] desktop init` only on desktop.

Kill the server: `kill $SERVER_PID`.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat: mobile blocker — bail early on (pointer: coarse) or width < 900"
```

---

## Task 7: State machine + video lifecycle

Implement the full `LOADING → IDLE → REVEAL → WHITE` flow, plus the autoplay-rejection fallback. URLs are placeholders for now; Task 8 fills them in.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/main.js`

- [ ] **Step 1: Replace the `initExperience` stub with the full implementation**

In `main.js`, replace the entire `function initExperience() { console.log('[troll] desktop init'); }` block (and only that block) with this:

```js
// ---------- Video sources (filled in after Blob upload) ----------
const VIDEOS = {
  loop:   'PASTE_LOOP_URL_HERE',
  reveal: 'PASTE_REVEAL_URL_HERE',
};

// ---------- State machine ----------
const STATE = { LOADING: 'LOADING', IDLE: 'IDLE', REVEAL: 'REVEAL', WHITE: 'WHITE' };
let state = STATE.LOADING;

function initExperience() {
  const loop    = document.getElementById('loop');
  const reveal  = document.getElementById('reveal');
  const loading = document.getElementById('loading');

  // Set sources in JS so the mobile path never preloads bytes.
  loop.src   = VIDEOS.loop;
  reveal.src = VIDEOS.reveal;

  // The <video autoplay> attribute will fire play() too; calling it here
  // explicitly lets us catch the Promise. If muted-autoplay is blocked the
  // user sees a frozen first frame — acceptable since the hotspot still works.
  loop.play().catch(() => { /* frozen first frame is acceptable */ });

  // canplaythrough may have already fired if the resource was cached, so check
  // readyState and either fire the handler immediately or wait for the event.
  let loopReady = false, revealReady = false;
  ensureReady(loop,   () => { loopReady   = true; onLoopReady(); maybeBindHotspot(); });
  ensureReady(reveal, () => { revealReady = true;                maybeBindHotspot(); });

  function onLoopReady() {
    loading.classList.add('hidden');
    setTimeout(() => { loading.style.display = 'none'; }, 250);
    state = STATE.IDLE;
  }

  function maybeBindHotspot() {
    if (loopReady && revealReady && state === STATE.IDLE) {
      document.body.addEventListener('pointerdown', handlePointerDown);
    }
  }

  function handlePointerDown(e) {
    if (state !== STATE.IDLE) return;
    if (!isInHotspot(e)) return;
    document.body.removeEventListener('pointerdown', handlePointerDown);
    startReveal();
  }

  function startReveal() {
    state = STATE.REVEAL;
    reveal.play()
      .then(() => {
        // Normal path: fade the loop out, reveal plays underneath.
        loop.style.opacity = '0';
      })
      .catch(() => {
        // Autoplay blocked even for muted — skip the reveal entirely so the
        // user doesn't get stuck on a frozen first frame.
        loop.style.opacity = '0';
        reveal.style.opacity = '0';
        state = STATE.WHITE;
      });
  }

  reveal.addEventListener('ended', () => {
    if (state !== STATE.REVEAL) return;
    state = STATE.WHITE;
    reveal.style.opacity = '0';
  });
}

function ensureReady(video, onReady) {
  if (video.readyState >= 4) { onReady(); return; }
  video.addEventListener('canplaythrough', onReady, { once: true });
}
```

Note the design: `handlePointerDown` is a named function inside `initExperience`, so `removeEventListener` works by reference. The `state !== STATE.IDLE` guard is defensive — even if removal somehow missed (e.g. event already queued), the handler is a no-op outside IDLE.

- [ ] **Step 2: Verify the file parses as a module**

```bash
node --check main.js
```

Expected: no output (silent success). If you see `SyntaxError`, fix syntax before continuing.

- [ ] **Step 3: Re-run the hotspot tests to confirm nothing regressed**

```bash
python3 -m http.server 8000 &
SERVER_PID=$!
sleep 1
open "http://localhost:8000/tests/hotspot.html"
```

Expected: still `6 pass, 0 fail`. The new code only adds new exports, doesn't change `isInHotspot`.

Kill the server: `kill $SERVER_PID`.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat: state machine, video lifecycle, autoplay-rejection fallback"
```

---

## Task 8: Vercel link + Blob upload

Interactive task — requires Vercel CLI auth. Provision a Blob store, upload the encoded videos, paste the immutable URLs into `main.js`.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/main.js` (replace placeholder URLs)
- Modify: `/Users/samsepiol/Code/troll/index.html` (replace preconnect placeholder)

- [ ] **Step 1: Link the project to Vercel**

```bash
cd /Users/samsepiol/Code/troll
vercel link
```

Answer prompts interactively:
- Set up "~/Code/troll"? → `y`
- Which scope should contain your project? → choose the personal scope (the one matching `vercel whoami`).
- Link to existing project? → `n`
- What's your project's name? → `troll`
- In which directory is your code located? → `./` (default)

Expected: a `.vercel/` directory is created (already gitignored).

- [ ] **Step 2: Provision a Blob store**

```bash
vercel storage create --type blob
```

When prompted for a name, accept the default or use `troll-blob`. When prompted to connect to the current project, choose yes. The command writes `BLOB_READ_WRITE_TOKEN` to your Vercel project environment automatically.

Pull it locally so the CLI can use it for uploads:

```bash
vercel env pull .env.local
```

Expected: `.env.local` is created (gitignored) and contains `BLOB_READ_WRITE_TOKEN=...`.

- [ ] **Step 3: Confirm exact CLI flag names**

```bash
vercel blob put --help 2>&1 | head -40
```

Expected: the help text lists flags. Verify the spelling of `--add-random-suffix` and `--cache-control-max-age`. If the flag names have changed in your CLI version, use the current spelling in the next step.

- [ ] **Step 4: Upload the encoded loop video**

```bash
vercel blob put encoded/looper.mp4 \
  --access public \
  --add-random-suffix \
  --cache-control-max-age 31536000
```

Expected: command prints a URL ending in something like `looper-<8-char-suffix>.mp4`. Copy this URL.

- [ ] **Step 5: Upload the encoded reveal video**

```bash
vercel blob put encoded/on_click.mp4 \
  --access public \
  --add-random-suffix \
  --cache-control-max-age 31536000
```

Expected: URL like `on_click-<8-char-suffix>.mp4`. Copy this URL.

- [ ] **Step 6: Paste the URLs into `main.js`**

Open `main.js` and replace the placeholder lines:

```js
const VIDEOS = {
  loop:   'PASTE_LOOP_URL_HERE',
  reveal: 'PASTE_REVEAL_URL_HERE',
};
```

with the actual URLs from steps 4 and 5:

```js
const VIDEOS = {
  loop:   'https://<store-id>.public.blob.vercel-storage.com/looper-<suffix>.mp4',
  reveal: 'https://<store-id>.public.blob.vercel-storage.com/on_click-<suffix>.mp4',
};
```

- [ ] **Step 7: Update the preconnect URL in `index.html`**

Open `index.html`. Replace:

```html
<link rel="preconnect" href="https://example.public.blob.vercel-storage.com">
```

with the actual Blob origin from your store (everything up to and including `.public.blob.vercel-storage.com`, no path):

```html
<link rel="preconnect" href="https://<store-id>.public.blob.vercel-storage.com">
```

- [ ] **Step 8: Commit**

```bash
git add main.js index.html
git commit -m "feat: wire up Vercel Blob URLs for loop and reveal videos"
```

---

## Task 9: Local smoke test

Run the full experience against `vercel dev`, walk through every state transition by hand.

- [ ] **Step 1: Start the local dev server**

```bash
cd /Users/samsepiol/Code/troll
vercel dev
```

Expected: server starts on `http://localhost:3000`. Output should mention `Ready` within a few seconds.

- [ ] **Step 2: Open the page and observe LOADING → IDLE**

Open `http://localhost:3000/` in Chrome. Expected sequence:
- Solid black screen for up to ~2 seconds (LOADING; `#loading` overlay).
- Black fades to the looping video (IDLE; loop autoplays, muted, loops).

In DevTools Console: no errors.

- [ ] **Step 3: Verify hotspot precision**

Click in each viewport corner — nothing should happen. Click in the configured hotspot region (default: viewport center) — the screen should crossfade to the reveal video.

If the default `HOTSPOT = { x: 0.5, y: 0.5, r: 0.08 }` doesn't land where you want, this is fine for now — Task 12 calibrates against the deployed loop. The goal of this step is to confirm the hit-test fires at the right viewport position, not to be content-correct.

- [ ] **Step 4: Verify REVEAL → WHITE**

After clicking the hotspot:
- Loop fades out over 500ms.
- Reveal plays through (~5 seconds).
- On `ended`, reveal fades to 0, leaving the pure white background.

Refresh and try again to confirm consistency. Click after fade-to-white — nothing should happen.

- [ ] **Step 5: Verify mobile blocker via DevTools**

Open DevTools → device toolbar (Cmd+Shift+M) → select iPhone 14. Refresh. Expected: black background with "This experience is desktop only." centered. No video network requests in the Network tab.

Switch back to Responsive at a width ≥ 900 — the desktop experience returns.

- [ ] **Step 6: Verify network behavior**

In DevTools → Network → reload the page. Expected:
- `index.html`, `style.css`, `main.js` each ≤ 5 KB.
- Two requests to `*.public.blob.vercel-storage.com` for the video files (range requests are normal).
- No requests with `as=video` from `<link rel=preload>` (we removed that).

- [ ] **Step 7: Stop the server**

Ctrl-C the `vercel dev` process.

- [ ] **Step 8: Commit nothing — this is a verification task only**

If any step above revealed a bug, fix it in the relevant file, re-verify, and commit a separate fix. Do not bundle a fix into this verification task.

---

## Task 10: GitHub repo + production deploy

Push to GitHub, let the Vercel integration deploy.

- [ ] **Step 1: Confirm the repo doesn't already exist remotely**

```bash
gh repo view 03kylewis/troll 2>&1 | head -1
```

If it returns `GraphQL: Could not resolve to a Repository ...`, you're clear to create. If the repo already exists, choose a different name or use `gh repo set-default` to point at it.

(Substitute the correct GitHub username for `03kylewis` — check with `gh api user --jq .login`.)

- [ ] **Step 2: Create the repo and push**

```bash
gh repo create troll --public --source=. --remote=origin --push
```

Expected: a series of `remote:` lines followed by `https://github.com/<you>/troll.git` confirmation. The `main` branch is pushed.

- [ ] **Step 3: Connect Vercel to the GitHub repo (if not already auto-linked)**

```bash
vercel git connect
```

Expected: prompts to confirm or pick the GitHub repo. Once connected, every push to `main` triggers a production deploy and every PR gets a preview URL.

- [ ] **Step 4: Trigger an initial production deploy**

```bash
vercel --prod
```

Expected: output includes `Production: https://troll-<hash>.vercel.app` (or your custom domain). Note the URL.

- [ ] **Step 5: Smoke-check the production URL**

Open the production URL in a fresh browser tab (or `open <url>`). Expected:
- Loop autoplays after a brief LOADING phase.
- Hotspot click triggers REVEAL.
- Reveal `ended` → WHITE.

If anything fails on prod that worked locally, the most likely cause is the Blob URL (wrong region, wrong store, wrong suffix). Re-check `VIDEOS` in `main.js` matches the production URLs from Task 8.

- [ ] **Step 6: Nothing to commit yet** — production deploys are derived from the `main` branch state, not a separate commit.

---

## Task 11: Verification checklist

Walk through all 11 items from the spec. Treat each as a pass/fail.

- [ ] **Step 1: Local static load (item 1)**

`vercel dev` locally; loop starts playing within ~2s on a fast connection; no console errors.

- [ ] **Step 2: Hotspot precision (item 2)**

Click inside the configured circle on the production URL → crossfade triggers. Click outside → nothing.

- [ ] **Step 3: Hotspot stability across aspect ratios (item 3)**

On the production URL, resize the browser window between 1920×1080, 2560×1080 (drag wide), and 1366×768. The hotspot should land on the same visible video feature in all three. If it shifts, the cover-inverse math has a bug — investigate before continuing.

- [ ] **Step 4: Crossfade quality (item 4)**

Click hotspot. Watch carefully: no flash of black between loop and reveal, no frozen frame on reveal's first frame, no audible click. Smooth 60fps fade.

- [ ] **Step 5: End state (item 5)**

Reveal plays through; on `ended`, fade to pure white. Click anywhere on the white screen — nothing happens.

- [ ] **Step 6: Throttled connection — DevTools Fast 3G (item 6)**

DevTools → Network → Throttling → Fast 3G. Reload prod URL. Expected: loop autoplays within ~5s; clicking the hotspot before reveal has buffered does nothing; once reveal is ready, click works smoothly.

- [ ] **Step 7: Mobile blocker on real devices (item 7)**

Open the production URL on a real iPhone Safari and a real Android Chrome (not just DevTools emulation — `(pointer: coarse)` matches diverge). Expected: black screen with "This experience is desktop only." Network tab shows zero video requests.

- [ ] **Step 8: Cross-browser (item 8)**

Open the production URL in Chrome, Safari, and Firefox (latest stable). All autoplay muted, all play inline, no autoplay-policy prompts, hotspot works, fade to white works.

- [ ] **Step 9: Cold autoplay (item 9)**

Open a fresh Chrome incognito window (or a profile that has never visited this domain). Navigate to the production URL. Expected: loop autoplays without any user interaction. This confirms we're not relying on a per-domain media-engagement boost.

- [ ] **Step 10: Autoplay rejection fallback (item 10)**

In Firefox, go to `about:config` and set `media.autoplay.default=1` (block autoplay). Reload the production URL. Click the hotspot. Expected: the page transitions to WHITE (no flash of frozen reveal frame, no stuck-on-loop state). After verification, reset `media.autoplay.default=0`.

- [ ] **Step 11: Lighthouse Performance > 90 (item 11)**

DevTools → Lighthouse → Performance audit on the production URL (desktop, simulated throttling). Expected: Performance score in the 90s. (Videos themselves are excluded from LCP since the page is essentially HTML + 3 KB JS + 1 KB CSS.)

- [ ] **Step 12: If any item fails, file a fix and commit it.**

Treat each failure as its own commit: `fix: <verification item>`. Do not stack fixes into one commit.

---

## Task 12: Hotspot calibration

Default `HOTSPOT = { x: 0.5, y: 0.5, r: 0.08 }` is a placeholder. Now that the deployed loop is visible, calibrate to the intended spot.

**Files:**
- Modify: `/Users/samsepiol/Code/troll/main.js`

- [ ] **Step 1: Find the target spot in the encoded loop**

Open `encoded/looper.mp4` in QuickTime (or any video player). Pause on a frame and identify the on-screen feature you want the user to click. Note its approximate position as a fraction of the 1920×1080 frame:
- x: distance from left edge / 1920
- y: distance from top edge / 1080
- r: visible radius / 1920

Example: target is at pixel (1150, 720) and you want a ~150px-wide circle of tolerance → `{ x: 0.599, y: 0.667, r: 0.078 }`.

- [ ] **Step 2: Update `HOTSPOT` in `main.js`**

Edit `main.js`:

```js
export const HOTSPOT = { x: 0.599, y: 0.667, r: 0.078 }; // calibrated 2026-05-12
```

Use your actual values.

- [ ] **Step 3: Local sanity check**

```bash
vercel dev
```

Open `http://localhost:3000/`. Click the intended feature. Crossfade should fire. Click elsewhere — nothing.

If the click misses, the most common error is reversing x and y or measuring from the wrong edge. Re-measure and retry.

- [ ] **Step 4: Re-run the hotspot test harness**

```bash
python3 -m http.server 8000 &
SERVER_PID=$!
sleep 1
open "http://localhost:8000/tests/hotspot.html"
```

Expected: still all PASS — the test stubs override `HOTSPOT` per test case, so calibration changes don't break the unit tests.

Kill the server: `kill $SERVER_PID`.

- [ ] **Step 5: Commit and deploy**

```bash
git add main.js
git commit -m "tune: calibrate hotspot to target feature in loop"
git push
```

Vercel auto-deploys. Confirm on the production URL.

- [ ] **Step 6: Final cross-aspect verification**

Resize the browser window through 1920×1080, 2560×1080, 1366×768 on the production URL. The hotspot should track the same visible feature at all three sizes.

---

## Done criteria

The project is complete when:

1. `git log --oneline` shows the commits for Tasks 1–12 in order.
2. The production URL loads, loops, fades on hotspot click, and ends on pure white.
3. All 11 items in the verification checklist (Task 11) pass.
4. Mobile devices show the blocker message and never load video bytes.
5. `HOTSPOT` is calibrated to the actual target feature in the loop.

After all of the above: the troll is live.
