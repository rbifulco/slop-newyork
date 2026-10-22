import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OFFICIAL_EDITOR = 'https://spatial-review.alterno.dev';
const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const defaultLocalEditors = ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://[::1]:5174'];
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && isLoopback(url.hostname);
  } catch {
    return false;
  }
}

function normalizeBasePath(value) {
  const result = value.endsWith('/') ? value : `${value}/`;
  if (!result.startsWith('/') || /[\\?#%]/.test(result) || result.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('basePath must be a URL path such as / or /slop-newyork/.');
  }
  return result;
}

function publicPath(relative) {
  if (['index.html', 'spatial-review.html', 'LICENSE', '.well-known/spatial-review.json'].includes(relative)) return true;
  const parts = relative.split('/');
  return ['js', 'css', 'spatial-review'].includes(parts[0]) && parts.length > 1 &&
    parts.every((part) => part && !part.startsWith('.')) && Object.hasOwn(mimeTypes, path.extname(relative));
}

/** Static development transport only. Bridge authorization still runs in capture.mjs. */
export function createSpatialReviewServer({
  rootDirectory = defaultRoot,
  basePath = '/',
  loopbackEditorOrigins = defaultLocalEditors,
} = {}) {
  const prefix = normalizeBasePath(basePath);
  const localEditors = [...new Set(loopbackEditorOrigins)];
  if (localEditors.some((origin) => !isLoopbackOrigin(origin))) {
    throw new Error('Additional development framing origins must be exact loopback origins.');
  }
  const rootPath = path.resolve(rootDirectory);
  let verifiedRoot;

  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : `${message}\n`);
    };
    try {
      const rawPath = (request.url || '/').split('?')[0];
      let pathname;
      try { pathname = decodeURIComponent(rawPath); } catch { return fail(400, 'Malformed URL'); }
      if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.split('/').some((part) => part === '..' || part === '.')) {
        return fail(400, 'Invalid path');
      }
      if (!pathname.startsWith(prefix)) return fail(404, 'Not found');
      const relative = pathname.slice(prefix.length) || 'index.html';
      if (!publicPath(relative)) return fail(404, 'Not found');

      const capture = relative === 'spatial-review.html';
      const discovery = relative === '.well-known/spatial-review.json';
      let localRequest = false;
      try { localRequest = isLoopback(new URL(`http://${request.headers.host}`).hostname); } catch { /* no local peers */ }
      const frameOrigins = ["'self'", ...(capture ? [OFFICIAL_EDITOR, ...(localRequest ? localEditors : [])] : [])];
      response.setHeader('Content-Security-Policy', `frame-ancestors ${frameOrigins.join(' ')}`);
      if (!capture) response.setHeader('X-Frame-Options', 'SAMEORIGIN');

      const origin = request.headers.origin;
      const permittedOrigin = origin === OFFICIAL_EDITOR || (localRequest && isLoopbackOrigin(origin));
      if (discovery) {
        response.setHeader('Vary', 'Origin');
        if (permittedOrigin) {
          response.setHeader('Access-Control-Allow-Origin', origin);
          response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          response.setHeader('Access-Control-Allow-Private-Network', 'true');
        }
        if (request.method === 'OPTIONS') {
          if (!permittedOrigin) return fail(403, 'Origin not allowed');
          response.writeHead(204);
          response.end();
          return;
        }
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', discovery ? 'GET, HEAD, OPTIONS' : 'GET, HEAD');
        return fail(405, 'Method not allowed');
      }

      const root = await (verifiedRoot ??= realpath(rootPath));
      const filename = await realpath(path.join(root, relative));
      const fromRoot = path.relative(root, filename);
      if (fromRoot.startsWith(`..${path.sep}`) || fromRoot === '..' || path.isAbsolute(fromRoot)) return fail(404, 'Not found');
      const info = await stat(filename);
      if (!info.isFile()) return fail(404, 'Not found');
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(relative)] || 'text/plain; charset=utf-8',
        'Content-Length': info.size,
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(filename).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (!response.headersSent) fail(['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Unable to serve file');
      else response.destroy();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = { host: '127.0.0.1', port: 5173, basePath: '/', rootDirectory: defaultRoot, loopbackEditorOrigins: [...defaultLocalEditors] };
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    const value = process.argv[i + 1];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === '--port') options.port = Number(value);
    else if (flag === '--host') options.host = value;
    else if (flag === '--base-path') options.basePath = value;
    else if (flag === '--root') options.rootDirectory = path.resolve(value);
    else if (flag === '--editor-origin') options.loopbackEditorOrigins.push(value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Invalid port');
  await stat(path.join(options.rootDirectory, 'spatial-review.html')).catch(() => {
    throw new Error('Built capture page missing. Run npm run build before npm run dev.');
  });
  const server = createSpatialReviewServer(options);
  server.listen(options.port, options.host, () => {
    const displayHost = options.host === '127.0.0.1' ? 'localhost' : options.host.includes(':') ? `[${options.host}]` : options.host;
    console.log(`Slop New York: http://${displayHost}:${server.address().port}${normalizeBasePath(options.basePath)}`);
    console.log(`Capture: http://${displayHost}:${server.address().port}${normalizeBasePath(options.basePath)}spatial-review.html`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
