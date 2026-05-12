# Troll — Design Spec

**Date:** 2026-05-12
**Status:** Draft, pending user approval

## Goal

A single-page web experience that:

1. Autoplays a silent, seamlessly looping video as a full-bleed backdrop.
2. Listens for a click on an invisible rectangular hotspot at a configurable spot in the viewport. The cursor flips to `pointer` while hovering over the hotspot, otherwise stays default.
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

Expected outputs: `looper.mp4` ≈ 12–20 MB; `on_click.mp4` ≈ 3.5 MB.

The color flags on the loop assume an SDR BT.709 source (most common for camera and screen-capture .mov files). If the source turns out to be Display P3 (e.g. iPhone HEVC re-wrapped) and color drift is visible after encoding, swap the `-vf` filter to include a `zscale` conversion step.

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
├── vercel.json             # framework: null, static deploy, security headers
├── .env.local              # BLOB_READ_WRITE_TOKEN (gitignored)
├── .gitignore
└── README.md
```

The deployed site is `index.html` + `style.css` + `main.js` only — total under ~5 KB. Videos are served from Vercel Blob URLs referenced from `main.js`.

## `vercel.json`

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

Chose `vercel.json` over the newer `vercel.ts` deliberately: the latter would add `@vercel/config` as a Node dependency and a `package.json` for a project that otherwise has no build step. There is no dynamic config to compute, so the TS form would be pure overhead.

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

Stacking order is set by explicit `z-index` (see CSS contract below), not DOM order: `#white` (1) → `#reveal` (2) → `#loop` (3) → `#loading` (4). The mobile blocker is its own overlay shown only when `.mobile` is on the body.

The crossfade is implemented by transitioning `#loop`'s opacity from 1 → 0, revealing `#reveal` (which has already started playing) underneath. Single opacity transition, no double-tween.

A `<link rel="preconnect" href="https://<store-id>.public.blob.vercel-storage.com">` in `<head>` warms the TCP/TLS handshake to the Blob CDN before the `<video>` elements begin their range requests. The preconnect intentionally omits `crossorigin`: the `<video>` elements have no `crossorigin` attribute, so they issue no-CORS range requests. Browsers keep separate connection pools per CORS mode, so a `crossorigin` preconnect would warm a connection the videos can't reuse — the optimization would silently no-op. Match the request mode and the warmed connection gets reused. (We also do not use `<link rel="preload" as="video">` — that `as` value is not in the documented preload destination list and is at best ignored, at worst duplicates bytes. `<video preload="auto">` is the canonical way to preload video.)

## Styling contract

The CSS is small enough to spell out in full as the implementation contract:

```css
html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }

#loop, #reveal {
  position: fixed; inset: 0;
  width: 100vw; height: 100vh;
  object-fit: cover;                       /* full-bleed; may crop edges */
  transition: opacity 500ms ease-out;
  will-change: opacity;
}
#loop    { z-index: 3; opacity: 1; }
#reveal  { z-index: 2; opacity: 1; }
#white   { position: fixed; inset: 0; background: #fff; z-index: 1; }
#loading { position: fixed; inset: 0; background: #000; z-index: 4; }

/* Mobile blocker */
#mobile-blocker {
  display: none;
  position: fixed; inset: 0;
  align-items: center; justify-content: center;
  background: #000; color: #fff;
  font: 16px/1.5 system-ui, -apple-system, sans-serif;
  text-align: center; padding: 1rem;
  z-index: 10;
}
.mobile #mobile-blocker { display: flex; }
.mobile #loop, .mobile #reveal, .mobile #loading { display: none; }
```

Key points:

- `object-fit: cover` is mandatory: the default `fill` stretches video and breaks aspect, which would also misalign the hotspot.
- Explicit `z-index` instead of relying on DOM order — more robust once any element has `position: fixed`.
- `transition` on both video elements means a single property change in JS drives the fade in either direction.
- `will-change: opacity` hints the compositor to promote the videos to their own layers, eliminating repaint cost during the fade.

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
- **IDLE → REVEAL**: on `pointerdown` inside the hotspot rectangle. Call `reveal.play()` — which returns a Promise. On success, transition `#loop` opacity 1 → 0 over 500ms ease-out, revealing `#reveal` playing underneath. Unbind the pointer handler so further clicks are no-ops. On rejection (rare: some Firefox configs or managed Chrome can block even muted autoplay), fall forward: transition `#loop` AND `#reveal` opacity to 0 simultaneously, going straight to WHITE without flashing the reveal's frozen first frame.
- **REVEAL → WHITE**: on `#reveal`'s `ended` event. Transition `#reveal` opacity 1 → 0 over 500ms ease-out, revealing `#white` underneath. Terminal.

## Hotspot hit-test

The hotspot is anchored to the **video content**, not the viewport. Because the videos render with `object-fit: cover`, the visible content shifts (cropped symmetrically) as the viewport aspect ratio changes; a viewport-anchored hotspot would drift off the intended spot at non-16:9 viewports. Video-anchored coords let us calibrate once and have it land correctly everywhere.

The hotspot is an axis-aligned rectangle. `HOTSPOT.x` and `HOTSPOT.y` are the top-left corner; `HOTSPOT.w` and `HOTSPOT.h` are the dimensions — all in normalized coordinates of the intrinsic 1920×1080 video frame.

```js
const VIDEO_W = 1920, VIDEO_H = 1080;
const HOTSPOT = { x: 0.34, y: 0.12, w: 0.31, h: 0.22 }; // the lit monitor
```

Hit test on `pointerdown` (and the same predicate drives the cursor flip on `pointermove`) — invert the cover transform to map screen pixels back to video pixels, then bounds-check the rectangle:

```js
function isInHotspot(e) {
  const vw = window.innerWidth, vh = window.innerHeight;
  // cover: scale is whichever axis fills the viewport last
  const scale = Math.max(vw / VIDEO_W, vh / VIDEO_H);
  const sw = VIDEO_W * scale, sh = VIDEO_H * scale;
  // cover centers the scaled image and crops symmetrically
  const ox = (sw - vw) / 2, oy = (sh - vh) / 2;
  // Click in video-pixel coords
  const px = (e.clientX + ox) / scale;
  const py = (e.clientY + oy) / scale;
  // Rect bounds in video pixels
  const x1 = HOTSPOT.x * VIDEO_W;
  const y1 = HOTSPOT.y * VIDEO_H;
  const x2 = (HOTSPOT.x + HOTSPOT.w) * VIDEO_W;
  const y2 = (HOTSPOT.y + HOTSPOT.h) * VIDEO_H;
  return px >= x1 && px <= x2 && py >= y1 && py <= y2;
}
```

Calibrate `HOTSPOT.x/y/w/h` once against the encoded 1920×1080 loop video; values then work at any viewport aspect ratio.

The same `isInHotspot()` predicate also runs on `pointermove` to toggle `document.body.style.cursor` between `'pointer'` (when inside the hotspot in IDLE state) and `''` (default). The toggle is gated on a `cursorIsPointer` boolean so we only mutate the style on transitions, not every move event.

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

CSS rules live in the styling contract above. Triggers on touch-primary devices OR a viewport narrower than 900px. The Blob CDN never serves the videos to mobile users because the `<video>` `src` attributes are set in JS, not in the HTML, and the JS bails before assigning them when `.mobile` is active. (`display: none` on a `<video>` does not reliably suppress preload — only an absent `src` does.)

## Hosting

- **Static site**: `index.html` + `style.css` + `main.js` deployed via Vercel from `main` branch.
- **Videos**: Vercel Blob, public access, treated as immutable. Upload via `vercel blob put encoded/<file> --access public --add-random-suffix --cache-control-max-age 31536000` (see Deployment steps for details). The returned URLs are pasted into the `VIDEOS` constant in `main.js`.
- **Repo**: GitHub `troll`, public.

## Deployment steps

1. Init git, write `.gitignore` (excludes `videos/`, `encoded/`, `.env.local`, `node_modules/`, `.DS_Store`).
2. Build static site (`index.html`, `style.css`, `main.js` with placeholder URLs).
3. `gh repo create troll --public --source=. --remote=origin --push`.
4. `vercel link` to create a Vercel project named `troll`.
5. Provision Vercel Blob via the Marketplace dashboard or `vercel storage create`.
6. `bash scripts/encode.sh` produces `encoded/looper.mp4` and `encoded/on_click.mp4`.
7. `vercel blob put encoded/looper.mp4 --access public --add-random-suffix --cache-control-max-age 31536000` and same for `on_click.mp4`. Paste the returned URLs into the `VIDEOS` constant in `main.js`.
   - `--add-random-suffix` makes each upload a fresh, immutable URL (Vercel's documented best practice for Blob is "treat blobs as immutable"). Re-encoding the loop yields a new URL — exactly what we want for cache busting.
   - `--cache-control-max-age 31536000` (1 year) means cold cache misses survive a long time; this is safe because URLs change on re-upload.
   - Exact flag spelling should be verified with `vercel blob put --help` at implementation time; CLI flags occasionally rename between releases.
8. Commit the URL update, push, Vercel deploys.

## Verification checklist

Success criteria, in order:

1. **Local static load**: `vercel dev` serves `index.html` and the loop video starts playing within ~2s on a fast connection. No console errors.
2. **Hotspot precision**: clicking inside the configured rectangle triggers the crossfade. Clicking outside (top corners, edges) does nothing. The cursor changes to `pointer` while hovering inside.
3. **Hotspot stability across aspect ratios**: with the same `HOTSPOT` constant, the hit lands on the same visible video feature at 1920×1080 (16:9), 2560×1080 (21:9 ultrawide), and 1366×768 (~16:9 laptop). Resize the browser window during verification.
4. **Crossfade quality**: no flash of black, no frozen frame, no audible click. Loop → reveal transition is smooth at 60fps.
5. **End state**: when the reveal video fires `ended`, the screen fades to pure white in 500ms. No further interaction is possible.
6. **Throttled connection (DevTools Fast 3G)**: loop autoplays within ~5s; hotspot click before reveal is `canplaythrough` is a no-op; once reveal is ready, click works smoothly.
7. **Mobile blocker — real devices**: iPhone Safari (real device) and Android Chrome (real device) show "This experience is desktop only." A narrowed desktop viewport (<900px) does the same. Verify with real iOS Safari, not just Chrome DevTools mobile emulation — `(pointer: coarse)` matches diverge between the two.
8. **Cross-browser**: Chrome, Safari, Firefox (latest stable). All autoplay-muted, all play inline. No autoplay-policy prompts.
9. **Cold autoplay**: open the deployed URL in a fresh Chrome profile that has never visited the deployment. Confirm the loop autoplays without user interaction (i.e. we're not relying on a per-domain media engagement index).
10. **Autoplay rejection fallback**: in Firefox with `media.autoplay.default=1` (or DevTools "Block media autoplay"), verify the page still progresses gracefully to WHITE on hotspot click rather than freezing.
11. **Lighthouse Performance > 90** on the static page (videos themselves aren't in LCP since the page is essentially HTML + CSS + 3KB JS).

## Risks and open items

| Risk | Likelihood | Mitigation |
|---|---|---|
| Loop seam visible at boundary | Medium | Trust native `<video loop>` first. If a gap is visible, escalate to a two-buffer crossfade (two `<video>` elements swapping opacity at the boundary). Documented escalation; not implemented in v1. |
| Hotspot drifts at extreme aspect ratios | Low (after cover-aware math) | Hit-test is now in video-pixel space, so the hotspot is locked to video content rather than viewport. Edge case: viewports so narrow/wide that the hotspot's cropped region falls off-screen — calibrate `HOTSPOT.x/y` away from the extreme edges of the 16:9 frame to leave headroom. |
| Autoplay blocked despite muted | Low | `reveal.play()` Promise rejection falls forward to WHITE (both videos fade simultaneously). Loop autoplay failure leaves a frozen first frame in IDLE; user click still works to trigger fall-forward. |
| Slow connection causes long LOADING | Low | `canplaythrough` gate prevents hotspot binding until both videos are ready; pre-binding clicks are no-ops. |
| Browser caches stale video after re-encode | Mitigated | `--add-random-suffix` produces a fresh URL on every upload; `main.js` updates with it, busting cache. |
| Vercel Blob bandwidth bill | Low (traffic-dependent) | Each video < 20 MB; revisit if traffic and cost become material. |

**Open calibration item:** `HOTSPOT = { x: 0.5, y: 0.5, r: 0.08 }` is a placeholder. Calibrate by eye against the encoded 1920×1080 loop video before final deploy.
