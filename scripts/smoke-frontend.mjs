import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const port = 4173;
const baseUrl = `http://${host}:${port}`;
const routes = [
  '/',
  '/companies',
  '/products',
  '/subscriptions',
  '/billing',
  '/users',
  '/integrations',
  '/operations',
  '/observability',
  '/analytics',
  '/security',
  '/support',
  '/governance',
  '/settings',
];

const requiredCssMarkers = [
  '.app-shell',
  '.identity-user-grid',
  '.operations-toolbar',
  '.security-toolbar',
  '.analytics-product-grid',
  '.observability-service-grid',
  '.support-customer-grid',
  '.governance-tabs',
  '.tabs',
  '.tab-bar',
];

function fail(message) {
  throw new Error(`[frontend smoke] ${message}`);
}

async function waitForServer(child) {
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    if (child.exitCode !== null) fail(`preview server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail('preview server did not become ready within 10 seconds');
}

function collectAssets(html) {
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (value.startsWith('/assets/')) assets.add(value);
  }
  return [...assets];
}

async function stopPreview(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['vite', 'preview', '--host', host, '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_APP_ENV: 'demo' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

try {
  await waitForServer(child);

  let rootHtml = '';
  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (response.status !== 200) fail(`${route} returned HTTP ${response.status}`);
    if (!contentType.includes('text/html')) fail(`${route} returned ${contentType || 'no content type'} instead of HTML`);
    if (!body.includes('id="root"')) fail(`${route} does not contain the React root element`);
    if (!body.includes('<script')) fail(`${route} does not reference the application bundle`);

    if (route === '/') rootHtml = body;
  }

  const assets = collectAssets(rootHtml);
  const cssAssets = assets.filter((asset) => asset.endsWith('.css'));
  const jsAssets = assets.filter((asset) => asset.endsWith('.js'));

  if (cssAssets.length === 0) fail('index.html does not reference a CSS bundle');
  if (jsAssets.length === 0) fail('index.html does not reference a JavaScript bundle');

  let combinedCss = '';
  for (const asset of assets) {
    const response = await fetch(`${baseUrl}${asset}`, { signal: AbortSignal.timeout(3000) });
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) fail(`${asset} returned HTTP ${response.status}`);
    if (body.length === 0) fail(`${asset} is empty`);

    if (asset.endsWith('.css')) {
      if (!contentType.includes('text/css')) fail(`${asset} returned invalid content type ${contentType}`);
      combinedCss += body;
    }
    if (asset.endsWith('.js') && !contentType.includes('javascript')) {
      fail(`${asset} returned invalid content type ${contentType}`);
    }
  }

  for (const marker of requiredCssMarkers) {
    if (!combinedCss.includes(marker)) fail(`compiled CSS is missing required selector ${marker}`);
  }

  console.log(`[frontend smoke] passed ${routes.length} routes, ${cssAssets.length} CSS bundle(s), ${jsAssets.length} JS bundle(s)`);
} catch (error) {
  console.error(output.trim());
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stopPreview(child);
}
