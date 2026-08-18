import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 4173;
const baseUrl = `http://${host}:${port}`;
const distAssetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const routes = ['/'];

const requiredCssMarkers = [
  '.vps-login',
  '.vps-login-card',
  '.vps-shell',
  '.vps-sidebar',
  '.vps-content',
  '.vps-card',
  '.vps-status',
  '.vps-form-grid',
  '.vps-events',
  '.vps-live',
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

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
    });
  }
}

async function readBuiltCss() {
  const files = (await readdir(distAssetsDir)).filter((name) => name.endsWith('.css'));
  if (files.length === 0) fail('dist/assets does not contain a CSS bundle');
  const chunks = await Promise.all(files.map((name) => readFile(`${distAssetsDir}/${name}`, 'utf8')));
  return { files, css: chunks.join('\n') };
}

const viteCli = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const child = spawn(process.execPath, [viteCli, 'preview', '--host', host, '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_APP_ENV: 'development', VITE_RUNTIME: 'vps' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

try {
  await waitForServer(child);

  let rootHtml = '';
  for (const route of routes) {
    const response = await fetch(`${baseUrl}${route}`, { redirect: 'manual' });
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (response.status !== 200) fail(`${route} returned HTTP ${response.status}`);
    if (!contentType.includes('text/html')) fail(`${route} returned ${contentType || 'no content type'} instead of HTML`);
    if (!body.includes('id="root"')) fail(`${route} does not contain the React root element`);
    if (!body.includes('<script')) fail(`${route} does not reference the application bundle`);
    if (route === '/') rootHtml = body;
  }

  const assets = collectAssets(rootHtml);
  const jsAssets = assets.filter((asset) => asset.endsWith('.js'));
  if (jsAssets.length === 0) fail('index.html does not reference a JavaScript bundle');

  for (const asset of assets) {
    const response = await fetch(`${baseUrl}${asset}`);
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) fail(`${asset} returned HTTP ${response.status}`);
    if (body.length === 0) fail(`${asset} is empty`);
    if (asset.endsWith('.css') && !contentType.includes('text/css')) fail(`${asset} returned invalid content type ${contentType}`);
    if (asset.endsWith('.js') && !contentType.includes('javascript')) fail(`${asset} returned invalid content type ${contentType}`);
  }

  const { files: cssFiles, css: combinedCss } = await readBuiltCss();
  for (const marker of requiredCssMarkers) {
    if (!combinedCss.includes(marker)) fail(`compiled CSS is missing required selector ${marker}`);
  }

  console.log(`[frontend smoke] passed ${routes.length} route(s), ${cssFiles.length} CSS bundle(s), ${jsAssets.length} entry JS bundle(s)`);
} catch (error) {
  console.error(output.trim());
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stopServer(child);
}
