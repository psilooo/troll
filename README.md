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
