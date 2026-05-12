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
