# Suno Studio

A local desktop app (Electron + React) that puts a richer, more controllable
front-end on top of [Suno](https://suno.com). It drives Suno's own backend using
**your own logged-in session**, so everything runs on your account and your
credits — it is not a bypass for paywalls or wait timers.

## Features

- **Structured lyric editor** — one-click section tags (`[Verse]`, `[Chorus]`,
  `[Bridge]`, `[Drop]`, …), inline vocal/production cues, and a "re-anchor
  bridges" helper that re-states your voice descriptor at every `[Bridge]` to
  reduce mid-song vocal drift.
- **Style builder** — compose the style string from curated genre / mood /
  vocals / instruments / era / production chips instead of guessing, plus an
  exclude-styles field. Save favourite combinations as presets.
- **Controls** — model version, persona, instrumental toggle, and style-strength
  / weirdness sliders.
- **Library** — browse, play, download (MP3/WAV), and extend your generations.

## Requirements

- Node.js 18+ (built and tested on Node 22)
- A Suno account

## Run it

```bash
npm install
npm run dev
```

To build a distributable desktop app:

```bash
npm run dist        # current platform
npm run dist:linux  # AppImage + deb
```

## Connecting your Suno account

The app needs your Suno session cookie (it talks to Suno's internal API the same
way the website does):

1. Log in at [suno.com](https://suno.com).
2. Open DevTools (F12) → **Network** tab.
3. Click any request to `studio-api.prod.suno.com` or `clerk.suno.com`.
4. Copy the entire `cookie` request header.
5. Paste it into **Settings → Suno session cookie** and hit **Test connection**.

The cookie is stored encrypted on your machine (via Electron `safeStorage`) and
is only ever sent to Suno. Cookies expire periodically — if generation stops
working, paste a fresh one.

## Caveats

- This uses Suno's **unofficial** internal API. Suno can change it at any time,
  which may break the app until the endpoints are updated.
- Use it at a normal, human pace. Hammering the API with automation can get an
  account flagged. This tool is for your own music creation.

## License

MIT
