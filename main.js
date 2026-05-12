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

// ---------- Video sources (filled in after Blob upload) ----------
const VIDEOS = {
  loop:   'PASTE_LOOP_URL_HERE',
  reveal: 'PASTE_REVEAL_URL_HERE',
};

// ---------- State machine ----------
const STATE = { LOADING: 'LOADING', IDLE: 'IDLE', REVEAL: 'REVEAL', WHITE: 'WHITE' };
let state = STATE.LOADING;

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
  const loop    = document.getElementById('loop');
  const reveal  = document.getElementById('reveal');
  const loading = document.getElementById('loading');

  // Defensive: when imported from a test harness page that lacks these DOM
  // elements, bail without setting anything up. This keeps tests/hotspot.html
  // working without modification.
  if (!loop || !reveal || !loading) return;

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
        // user doesn't get stuck on a frozen first frame. Hide reveal
        // immediately (no transition) so its frozen frame can't show through
        // the loop's fade; then fade only the loop to expose #white.
        reveal.style.display = 'none';
        loop.style.opacity = '0';
        state = STATE.WHITE;
      });
  }

  reveal.addEventListener('ended', () => {
    if (state !== STATE.REVEAL) return;
    state = STATE.WHITE;
    reveal.style.opacity = '0';
  }, { once: true });
}

function ensureReady(video, onReady) {
  if (video.readyState >= 4) { onReady(); return; }
  video.addEventListener('canplaythrough', onReady, { once: true });
}
