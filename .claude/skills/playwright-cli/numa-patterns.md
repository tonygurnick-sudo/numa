# Numa Browser Automation Patterns

Reusable `playwright-cli run-code` snippets for common Numa interactions. These are tested patterns — copy-paste directly into `run-code` calls.

## Login and Get to Chat

Tries saved auth state first, falls back to manual login. Handles the welcome modal.

```javascript
async function loginAndGetToChat(page) {
  // Try saved auth state first
  try {
    const fs = await import('fs');
    if (fs.existsSync && fs.existsSync('playwright-runs/numa-auth-state.json')) {
      await page.context().setStorageState('playwright-runs/numa-auth-state.json');
      await page.goto('http://localhost:5173/chat');
      await page.waitForTimeout(2000);
      // Check we're actually on chat (not redirected to login)
      if (page.url().includes('/chat')) {
        return 'authenticated-via-state';
      }
    }
  } catch (e) {
    /* state expired or missing, fall through to login */
  }

  // Manual login
  await page.goto('http://localhost:5173/login');
  await page.waitForTimeout(1000);
  await page.getByTestId('username-input').fill(process.env.NUMA_USERNAME || 'nathan@arcanum.ai');
  await page.getByTestId('password-input').fill(process.env.NUMA_PASSWORD || '');
  await page.getByTestId('login-button').click();
  await page.waitForURL('**/chat', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Dismiss welcome modal if it appears
  const maybeLater = page.getByRole('button', { name: 'Maybe Later' });
  if (await maybeLater.isVisible({ timeout: 2000 }).catch(() => false)) {
    await maybeLater.click();
    await page.waitForTimeout(500);
  }

  // Save auth state for next time
  await page.context().storageState({ path: 'playwright-runs/numa-auth-state.json' });
  return 'authenticated-via-login';
}
```

## Send a Message and Wait for Response

Types a message, sends it, and waits for the AI response to finish streaming. Returns when the response is complete.

```javascript
async function sendMessageAndWait(page, message, timeoutMs = 60000) {
  const input = page.getByPlaceholder('Ask me anything...');
  await input.click();
  await input.fill(message);
  await page.keyboard.press('Enter');

  // Wait for assistant response to appear
  await page.waitForTimeout(1000);

  // Wait for streaming to complete by watching for the send button to re-enable
  // (it's disabled/shows stop button while streaming)
  await page.waitForFunction(
    () => {
      const stopBtn = document.querySelector('.stop-button');
      const sendBtn = document.querySelector('.send-button');
      // Streaming is done when stop button is gone and send button is back
      return !stopBtn && sendBtn;
    },
    { timeout: timeoutMs }
  );

  await page.waitForTimeout(500); // let final render settle
  return 'response-complete';
}
```

## Open History Panel

Opens the chat history sidebar and waits for conversations to load.

```javascript
async function openHistory(page) {
  const histBtn = page.getByRole('button', { name: 'Chat History' });
  await histBtn.click();
  // Wait for either conversations to load or empty state
  await page.waitForFunction(
    () => {
      const items = document.querySelectorAll('.workspace-history-item');
      const empty = document.querySelector('.workspace-chat-history-panel-body .text-muted');
      return items.length > 0 || empty;
    },
    { timeout: 10000 }
  );
  await page.waitForTimeout(500);
  return 'history-open';
}
```

## Start New Chat

Clicks New Chat and waits for the welcome screen.

```javascript
async function startNewChat(page) {
  await page.getByRole('button', { name: 'New Chat' }).click();
  await page.waitForTimeout(1000);
  // Verify we're on the new chat screen (input is empty, welcome message visible)
  await page.getByPlaceholder('Ask me anything...').waitFor({ state: 'visible' });
  return 'new-chat-ready';
}
```

## Scroll History Panel

Scrolls the history panel smoothly from top to bottom and back. Useful for video demos.

```javascript
async function scrollHistory(page, captureCallback) {
  const panel = await page.$('.workspace-chat-history-panel-body');
  if (!panel) return 'panel-not-found';

  const scrollHeight = await panel.evaluate((e) => e.scrollHeight);
  const maxScroll = Math.min(scrollHeight, 20000);

  // Scroll down
  for (let pos = 0; pos < maxScroll; pos += 150) {
    await panel.evaluate((e, p) => {
      e.scrollTop = p;
    }, pos);
    if (captureCallback) await captureCallback();
    await page.waitForTimeout(34);
  }

  // Scroll back up (faster)
  for (let pos = maxScroll; pos >= 0; pos -= 300) {
    await panel.evaluate((e, p) => {
      e.scrollTop = p;
    }, pos);
    if (captureCallback) await captureCallback();
    await page.waitForTimeout(34);
  }

  return 'scroll-complete';
}
```

## Video Recording Helpers

Reusable capture functions for the 15fps screenshot-stitch approach.

```javascript
function createRecorder(page, outDir) {
  let frameNum = 0;
  const wait = 34; // ~15fps (33ms screenshot + 34ms wait)

  async function capture() {
    await page.screenshot({
      type: 'png',
      path: outDir + '/frame_' + String(frameNum++).padStart(5, '0') + '.png',
    });
    await page.waitForTimeout(wait);
  }

  async function captureFor(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await capture();
    }
  }

  return { capture, captureFor, getFrameCount: () => frameNum };
}

// Usage:
// const rec = createRecorder(page, 'playwright-runs/my-run/video-frames');
// await rec.captureFor(2000);        // hold 2s
// await page.click('#something');
// await rec.captureFor(3000);        // capture result 3s
// console.log(rec.getFrameCount());  // total frames
//
// Then stitch: ffmpeg -y -framerate 15 -i .../frame_%05d.png -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p output.mp4
```

## Key Selectors Reference

| Element               | Best Selector                                         |
| --------------------- | ----------------------------------------------------- |
| Username input        | `page.getByTestId('username-input')`                  |
| Password input        | `page.getByTestId('password-input')`                  |
| Login button          | `page.getByTestId('login-button')`                    |
| New Chat button       | `page.getByRole('button', { name: 'New Chat' })`      |
| History button        | `page.getByRole('button', { name: 'Chat History' })`  |
| Agents button         | `page.getByRole('button', { name: 'Agents' })`        |
| Settings button       | `page.getByRole('button', { name: 'Chat Settings' })` |
| Chat input            | `page.getByPlaceholder('Ask me anything...')`         |
| Send button           | `page.$('.send-button')`                              |
| Stop button           | `page.$('.stop-button')`                              |
| Welcome modal skip    | `page.getByRole('button', { name: 'Maybe Later' })`   |
| History panel body    | `page.$('.workspace-chat-history-panel-body')`        |
| History items         | `page.$$('.workspace-history-item')`                  |
| History group headers | `page.$$('.workspace-history-group-header')`          |
| Message container     | `page.$('.chat-messages')`                            |
| Processing spinner    | `page.$('.processing-spinner')`                       |
| Nav sidebar           | `page.$('.nav-sidebar')`                              |
