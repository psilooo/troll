# Troll — Design Spec

**Date:** 2026-05-12
**Status:** Draft, pending user approval

## Goal

A single-page web experience that:

1. Autoplays a silent, seamlessly looping video as a full-bleed backdrop.
2. Listens for a click on an invisible circular hotspot at a configurable spot in the viewport.
3. On hotspot click, crossfades to a second video that plays once through.
4. When the second video ends, fades to a pure white screen and stays there indefinitely.
5. On mobile, replaces everything with a "desktop only" message.

Deployed as a static site on Vercel, with encoded video files hosted on Vercel Blob.

## Non-goals

- Audio anywhere in the experience.
- Mobile UX beyond the blocker.
- Restart, back button, navigation, copy, branding, SEO.
- Server-side logic of any kind.
- Analytics, error tracking, telemetry.

## Source assets

| File | Size | Spec |
|---|---|---|
| `videos/looper.mov` | 152 MB | 3840×2160 @ 60fps, H.264 @ 60 Mbit/s, 20.1s, unused AAC track, no faststart |
| `videos/on_click.mp4` | 3.5 MB | 1920×1080 @ 24fps, H.264 @ 5.5 Mbit/s, 5.04s, no audio, no faststart |

Both source files need processing: looper is far too big for the web; on_click just needs faststart added so the browser can begin playback before the file is fully downloaded.

## Encoding pipeline

`scripts/encode.sh` re-encodes the masters to web-ready MP4s. Idempotent — re-runnable when masters change.

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p encoded

# Loop: 4K60 master → 1080p60 H.264 CRF 22, no audio, faststart
ffmpeg -y -i videos/looper.mov \
  -vf "scale=1920:1080:flags=lanczos" \
  -r 60 \
  -c:v libx264 -preset slow -crf 22 -profile:v high -level 4.2 -pix_fmt yuv420p \
  -an -movflags +faststart \
  encoded/looper.mp4

# Reveal: 1080p24 master, already small — just remux to add faststart
ffmpeg -y -i videos/on_click.mp4 \
  -c copy -movflags +faststart \
  encoded/on_click.mp4

du -h encoded/*
```

Expected outputs: `looper.mp4` ≈ 12–20 MB; `on_click.mp4` ≈ 3.5 MB.

## File layout

```
troll/
├── index.html              # Markup
├── style.css               # Layout, crossfade transitions, mobile blocker
├── main.js                 # State machine, hotspot config, preload, click handling
├── videos/                 # Source masters (gitignored)
│   ├── looper.mov
│   └── on_click.mp4
├── scripts/
│   └── encode.sh           # ffmpeg pipeline
├── encoded/                # Encoded outputs (gitignored; uploaded to Blob)
├── docs/superpowers/
│   ├── specs/              # This file
│   └── plans/              # Implementation plan goes here next
├── vercel.ts               # framework: null, static deploy
├── .env.local              # BLOB_READ_WRITE_TOKEN (gitignored)
├── .gitignore
└── README.md
```

The deployed site is `index.html` + `style.css` + `main.js` only — total under ~5 KB. Videos are served from Vercel Blob URLs referenced from `main.js`.

## DOM structure

```html
<body>
  <div id="white"></div>
  <video id="reveal" muted playsinline      preload="auto"></video>
  <video id="loop"   muted playsinline loop preload="auto" autoplay></video>
  <div id="loading"></div>
  <div id="mobile-blocker">This experience is desktop only.</div>
</body>
```

Z-order (bottom → top): `#white` → `#reveal` → `#loop` → `#loading` → `#mobile-blocker`.

The crossfade is implemented by transitioning `#loop`'s opacity from 1 → 0, revealing `#reveal` (which has already started playing) underneath. Single opacity transition, no double-tween.

`<link rel="preload" as="video" fetchpriority="high" href="<loop url>">` and a matching low-priority preload for the reveal go in `<head>`.

## State machine

```
LOADING ──loop canplaythrough──▶ IDLE ──hotspot click──▶ REVEAL ──reveal ended──▶ WHITE
```

| State | Visible | Listeners active |
|---|---|---|
| LOADING | `#loading` black overlay | `canplaythrough` on both videos |
| IDLE | `#loop` playing, looping | `pointerdown` on `document.body` (hotspot hit-test) |
| REVEAL | `#loop` fading out, `#reveal` playing | `ended` on `#reveal` |
| WHITE | `#white` only | none — terminal state |

Transitions:

- **LOADING → IDLE**: when `#loop` fires `canplaythrough`. Remove `#loading` overlay. Bind hotspot handler only after `#reveal` also reports `canplaythrough` (in practice this races but loop almost always finishes first).
- **IDLE → REVEAL**: on `pointerdown` inside the hotspot circle. Call `reveal.play()`, then on the next animation frame transition `#loop` opacity 1 → 0 over 500ms ease-out. Unbind the pointer handler so further clicks are no-ops.
- **REVEAL → WHITE**: on `#reveal`'s `ended` event. Transition `#reveal` opacity 1 → 0 over 500ms ease-out, revealing `#white` underneath.

## Hotspot hit-test

The hotspot is a circle in normalized viewport coordinates. One JS constant — the only thing to retune once we eyeball the right spot in the loop.

```js
const HOTSPOT = { x: 0.5, y: 0.5, r: 0.08 }; // x, y, r as viewport fractions
```

Hit test on `pointerdown`:

```js
function isInHotspot(e) {
  const dx = (e.clientX / window.innerWidth) - HOTSPOT.x;
  const dy = (e.clientY / window.innerHeight) - HOTSPOT.y;
  const aspect = window.innerWidth / window.innerHeight;
  return Math.hypot(dx, dy / aspect) < HOTSPOT.r;
}
```

The `dy / aspect` correction keeps the hotspot visually circular regardless of viewport aspect ratio.

## Mobile blocker

At the very top of `main.js`:

```js
const isMobile = window.matchMedia('(pointer: coarse)').matches
              || window.innerWidth < 900;
if (isMobile) {
  document.body.classList.add('mobile');
  // Skip all video init. The mobile blocker div is shown by CSS.
} else {
  initExperience();
}
```

CSS:

```css
#mobile-blocker { display: none; }
.mobile #mobile-blocker { display: flex; align-items: center; justify-content: center; }
.mobile #loop, .mobile #reveal, .mobile #loading { display: none; }
```

Triggers on touch-primary devices OR a viewport narrower than 900px. The Blob CDN never serves the videos to mobile users (the `<video>` `src` attributes are set in JS, not the HTML).

## Hosting

- **Static site**: `index.html` + `style.css` + `main.js` deployed via Vercel from `main` branch.
- **Videos**: Vercel Blob, public access. Upload via `vercel blob put encoded/<file> --access public`. URLs from the upload response are pasted into the `VIDEOS` constant in `main.js`.
- **Repo**: GitHub `troll`, public.

## Deployment steps

1. Init git, write `.gitignore` (excludes `videos/`, `encoded/`, `.env.local`, `node_modules/`, `.DS_Store`).
2. Build static site (`index.html`, `style.css`, `main.js` with placeholder URLs).
3. `gh repo create troll --public --source=. --remote=origin --push`.
4. `vercel link` to create a Vercel project named `troll`.
5. Provision Vercel Blob via the Marketplace dashboard or `vercel storage create`.
6. `bash scripts/encode.sh` produces `encoded/looper.mp4` and `encoded/on_click.mp4`.
7. `vercel blob put encoded/looper.mp4 --access public` and same for `on_click.mp4`. Paste the returned URLs into the `VIDEOS` constant in `main.js`.
8. Commit the URL update, push, Vercel deploys.

## Verification checklist

Success criteria, in order:

1. **Local static load**: `vercel dev` serves `index.html` and the loop video starts playing within ~2s on a fast connection. No console errors.
2. **Hotspot precision**: clicking inside the configured circle triggers the crossfade. Clicking outside (top corners, edges) does nothing.
3. **Crossfade quality**: no flash of black, no frozen frame, no audible click. Loop → reveal transition is smooth at 60fps.
4. **End state**: when the reveal video fires `ended`, the screen fades to pure white in 500ms. No further interaction is possible.
5. **Throttled connection (DevTools Fast 3G)**: loop autoplays within ~5s; hotspot click before reveal is `canplaythrough` is a no-op; once reveal is ready, click works smoothly.
6. **Mobile blocker**: iPhone Safari, Android Chrome, and a desktop viewport narrowed to <900px all show "This experience is desktop only." `<video>` elements never load.
7. **Cross-browser**: Chrome, Safari, Firefox (latest stable). All autoplay-muted, all play inline. No autoplay-policy prompts.
8. **Lighthouse Performance > 90** on the static page (videos themselves aren't in LCP since the page is essentially HTML + CSS + 3KB JS).

## Risks and open items

- **Seam in the loop**: master may not be perfectly seamless. If a visible gap appears at the loop boundary, escalate to a double-buffered swap (two `<video>` elements crossfading at boundary). Deferred until verified.
- **Hotspot coordinates**: `{ x: 0.5, y: 0.5, r: 0.08 }` is a placeholder; calibrate by eye against the encoded loop video before final deploy.
- **Blob URL hashing**: Vercel Blob URLs include a content hash. If `looper.mp4` is re-encoded, its URL changes — `main.js` must be updated and redeployed. Acceptable given the manual workflow.
