---
name: playwright-cli
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
allowed-tools: Bash(playwright-cli:*)
---

# Browser Automation with playwright-cli

## Prerequisites

Install the Playwright CLI globally:

```bash
npm install -g @playwright/cli@latest
```

Verify it's working:

```bash
playwright-cli --version
```

If the global install isn't available, you can use `npx playwright-cli` as a fallback for all commands below.

**ffmpeg is required** for video generation (see Video Recording section below). Install Playwright's bundled ffmpeg once:

```bash
npx playwright install ffmpeg
```

## Working directory

All Playwright test artifacts (screenshots, snapshots, PDFs, traces, videos) go in `playwright-runs/` at the repo root. This directory is gitignored.

When running a test session, create a descriptively named subfolder for the run:

```bash
# Example: testing Numa Ops kanban board
mkdir -p playwright-runs/numa-ops-kanban/
```

Use `--filename=playwright-runs/<run-name>/<artifact>.png` when saving screenshots, PDFs, etc. This keeps artifacts organised and easy to find/clean up.

The `.playwright-cli/` directory (auto-generated snapshots, console logs) is also gitignored.

## Quick start

```bash
# open new browser
playwright-cli open
# navigate to a page
playwright-cli goto https://playwright.dev
# interact with the page using refs from the snapshot
playwright-cli click e15
playwright-cli type "page.click"
playwright-cli press Enter
# take a screenshot (rarely used, as snapshot is more common)
playwright-cli screenshot
# close the browser
playwright-cli close
```

## Commands

### Core

```bash
playwright-cli open
# open and navigate right away
playwright-cli open https://example.com/
playwright-cli goto https://playwright.dev
playwright-cli type "search query"
playwright-cli click e3
playwright-cli dblclick e7
playwright-cli fill e5 "user@example.com"
playwright-cli drag e2 e8
playwright-cli hover e4
playwright-cli select e9 "option-value"
playwright-cli upload ./document.pdf
playwright-cli check e12
playwright-cli uncheck e12
playwright-cli snapshot
playwright-cli snapshot --filename=after-click.yaml
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
playwright-cli dialog-accept
playwright-cli dialog-accept "confirmation text"
playwright-cli dialog-dismiss
playwright-cli resize 1920 1080
playwright-cli close
```

### Navigation

```bash
playwright-cli go-back
playwright-cli go-forward
playwright-cli reload
```

### Keyboard

```bash
playwright-cli press Enter
playwright-cli press ArrowDown
playwright-cli keydown Shift
playwright-cli keyup Shift
```

### Mouse

```bash
playwright-cli mousemove 150 300
playwright-cli mousedown
playwright-cli mousedown right
playwright-cli mouseup
playwright-cli mouseup right
playwright-cli mousewheel 0 100
```

### Save as

```bash
playwright-cli screenshot
playwright-cli screenshot e5
playwright-cli screenshot --filename=page.png
playwright-cli pdf --filename=page.pdf
```

### Tabs

```bash
playwright-cli tab-list
playwright-cli tab-new
playwright-cli tab-new https://example.com/page
playwright-cli tab-close
playwright-cli tab-close 2
playwright-cli tab-select 0
```

### Storage

```bash
playwright-cli state-save
playwright-cli state-save auth.json
playwright-cli state-load auth.json

# Cookies
playwright-cli cookie-list
playwright-cli cookie-list --domain=example.com
playwright-cli cookie-get session_id
playwright-cli cookie-set session_id abc123
playwright-cli cookie-set session_id abc123 --domain=example.com --httpOnly --secure
playwright-cli cookie-delete session_id
playwright-cli cookie-clear

# LocalStorage
playwright-cli localstorage-list
playwright-cli localstorage-get theme
playwright-cli localstorage-set theme dark
playwright-cli localstorage-delete theme
playwright-cli localstorage-clear

# SessionStorage
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get step
playwright-cli sessionstorage-set step 3
playwright-cli sessionstorage-delete step
playwright-cli sessionstorage-clear
```

### Network

```bash
playwright-cli route "**/*.jpg" --status=404
playwright-cli route "https://api.example.com/**" --body='{"mock": true}'
playwright-cli route-list
playwright-cli unroute "**/*.jpg"
playwright-cli unroute
```

### DevTools

```bash
playwright-cli open https://example.com
playwright-cli console
playwright-cli console warning
playwright-cli network
playwright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
playwright-cli tracing-start
playwright-cli tracing-stop
```

## Important: run-code vs eval

`run-code` only supports **single expressions** -- no `const`, `let`, `var`, semicolons, or multi-statement scripts. If you need multi-statement JS or variable declarations, use `eval` instead:

```bash
# WRONG -- run-code will throw SyntaxError
playwright-cli run-code "const el = page.locator('#btn'); await el.click();"

# RIGHT -- use eval for inline JS execution
playwright-cli eval 'document.querySelector("#my-btn").click()'

# RIGHT -- single expression works with run-code
playwright-cli run-code "await page.locator('#btn').click()"
```

For complex multi-step interactions, chain separate `eval` or `click`/`fill` commands rather than trying to put everything in one `run-code` call.

## Important: file paths

**Always use absolute paths** for `--filename` in `screenshot`, `pdf`, and `snapshot` commands. The working directory of the playwright-cli process may differ from your shell's cwd, causing `ENOENT` errors with relative paths:

```bash
# Safer -- absolute path
playwright-cli screenshot --filename=/Users/me/project/playwright-runs/screenshot.png

# Risky -- relative path depends on playwright-cli's cwd
playwright-cli screenshot --filename=playwright-runs/screenshot.png
```

## Open parameters

```bash
# Use specific browser
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
playwright-cli open --browser=msedge

# Use persistent profile (by default profile is in-memory)
playwright-cli open --persistent
# Use persistent profile with custom directory
playwright-cli open --profile=/path/to/profile

# Start with config file
playwright-cli open --config=my-config.json

# Close the browser
playwright-cli close
# Delete user data for the default session
playwright-cli delete-data
```

## Snapshots

After each command, playwright-cli provides a snapshot of the current browser state.

```bash
> playwright-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

You can also take a snapshot on demand using `playwright-cli snapshot` command.

If `--filename` is not provided, a new snapshot file is created with a timestamp. Default to automatic file naming, use `--filename=` when artifact is a part of the workflow result.

## Browser Sessions

```bash
# create new browser session named "mysession" with persistent profile
playwright-cli -s=mysession open example.com --persistent
playwright-cli -s=mysession click e6
playwright-cli -s=mysession close
playwright-cli -s=mysession delete-data

playwright-cli list
# Close all browsers
playwright-cli close-all
# Forcefully kill all browser processes
playwright-cli kill-all
```

## Example: Form submission

```bash
playwright-cli open https://example.com/form
playwright-cli snapshot

playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot
playwright-cli close
```

## Example: Multi-tab workflow

```bash
playwright-cli open https://example.com
playwright-cli tab-new https://example.com/other
playwright-cli tab-list
playwright-cli tab-select 0
playwright-cli snapshot
playwright-cli close
```

## Example: Debugging with DevTools

```bash
playwright-cli open https://example.com
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli console
playwright-cli network
playwright-cli close
```

## Auth State Persistence

Save browser auth state (cookies, localStorage, Cognito tokens) after login so future sessions skip login entirely:

```bash
# After logging in, save the state
playwright-cli state-save playwright-runs/numa-auth-state.json

# In a new session, load it instead of logging in again
playwright-cli open http://localhost:5173 --persistent
playwright-cli state-load playwright-runs/numa-auth-state.json
playwright-cli goto http://localhost:5173/chat
# You're now authenticated — no login required
```

The saved state file is gitignored under `playwright-runs/`. It expires when Cognito tokens expire — just re-login and re-save when that happens.

## Video Recording

**Do NOT use the built-in `video-start` / `video-stop` commands.** They use Playwright's native screencast which only captures frames when the DOM changes — CSS animations, spinners, and idle waits produce frozen/duplicate frames. The result is unwatchable.

**Instead, use rapid screenshots stitched with ffmpeg.** This captures every frame reliably at real-time speed.

### How it works

Use `playwright-cli run-code` to execute a script that takes `page.screenshot()` in a loop at 15fps (67ms per frame), then stitch the PNGs into an mp4 with ffmpeg. Each screenshot forces a full render, so every frame captures the actual DOM state.

### Recording pattern

```javascript
// Inside playwright-cli run-code '...'
const outDir = 'playwright-runs/<run-name>/video-frames';
let frameNum = 0;
const wait = 34; // ~67ms total per frame (33ms screenshot + 34ms wait) = 15fps

async function capture() {
  await page.screenshot({
    type: 'png',
    path: outDir + '/frame_' + String(frameNum++).padStart(5, '0') + '.png',
  });
  await page.waitForTimeout(wait);
}

// Capture continuously for a duration
async function captureFor(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await capture();
  }
}

// Use between interactions:
await captureFor(2000); // hold on current state for 2s
await page.click('#some-button'); // interact
await captureFor(3000); // capture the result for 3s
```

### Stitching with ffmpeg

```bash
ffmpeg -y -framerate 15 \
  -i playwright-runs/<run-name>/video-frames/frame_%05d.png \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  playwright-runs/<run-name>/demo.mp4
```

### Why 15fps?

- Screenshot latency is ~33ms, so 15fps (67ms/frame) is the sweet spot for real-time playback
- 10fps works but feels slightly choppy
- 30fps can't actually achieve 30fps due to screenshot overhead — the video plays back at ~2x speed
- 15fps produces smooth, real-time video at ~2MB for 30s of footage

### Folder structure

Keep video frames in a subfolder to avoid mixing with screenshots:

```
playwright-runs/
  my-test-run/
    01-feature-before.png      # key screenshots for MR
    02-feature-after.png
    demo.mp4                   # stitched video
    video-frames/              # raw frames (can delete after stitching)
      frame_00000.png
      frame_00001.png
      ...
```
