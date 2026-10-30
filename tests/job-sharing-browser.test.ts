import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { chromium, expect } from 'playwright/test';

test('crawler previews and public sharing controls', async (t) => {
  const api = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url?.includes('get-session')) {
      response.end('null');
      return;
    }
    response.end(
      JSON.stringify({
        id: 'share-fixture',
        postName: 'Example Researcher',
        organization: 'Example Institute',
        vacancies: 2,
        source: { name: 'Example source' },
      }),
    );
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => {
    api.closeAllConnections();
    api.close();
  });
  const address = api.address();
  assert(address && typeof address !== 'string');
  const origin = 'http://localhost:18884';
  const server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', '18884'],
    {
      env: {
        ...process.env,
        SITE_URL: origin,
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
      },
      stdio: 'ignore',
    },
  );
  t.after(() => {
    server.kill();
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${origin}/share-image`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the isolated server. */
    }
    await setTimeout(500);
  }
  assert(ready, 'production server started');
  const html = await (
    await fetch(`${origin}/jobs/share-fixture`, {
      headers: { 'User-Agent': 'WhatsApp/2.0' },
    })
  ).text();
  const head = html.split('</head>')[0];
  assert.match(head, /property="og:title" content="Example Researcher/);
  assert.match(head, /http:\/\/localhost:18884\/share-image/);
  const image = await fetch(`${origin}/share-image`);
  assert.match(image.headers.get('content-type')!, /image\/png/);
  assert((await image.arrayBuffer()).byteLength > 1000);
  const browser = await chromium
    .launch()
    .catch(() => chromium.launch({ channel: 'chrome' }));
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}/jobs/share-fixture?private=excluded`);
  // tsx annotates nested function names when serializing browser callbacks.
  await page.evaluate('globalThis.__name = (fn) => fn');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        document.body.dataset.shared = JSON.stringify(data);
      },
    });
  });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  assert.equal(
    JSON.parse((await page.locator('body').getAttribute('data-shared')) ?? '{}')
      .url,
    `${origin}/jobs/share-fixture`,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new DOMException('Cancelled', 'AbortError');
      },
    });
  });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (url: string) => {
          document.body.dataset.copied = url;
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Link copied.');
  assert.equal(
    await page.locator('body').getAttribute('data-copied'),
    `${origin}/jobs/share-fixture`,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });
  await page.getByRole('button', { name: 'Share', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Job link' })).toHaveValue(
    `${origin}/jobs/share-fixture`,
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
});
