/*
 * Servidor local que imita a Vercel: archivos estáticos con cleanUrls, la redirección de "/"
 * y las funciones /api/upload y /api/lead. Las llaves de R2 se leen del .env (no se sube a Git ni a Vercel).
 *
 *   node --env-file=.env scripts/dev.mjs      → http://localhost:4029
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POST as upload } from '../api/upload.mjs';
import { POST as lead } from '../api/lead.mjs';

const API = { '/api/upload': upload, '/api/lead': lead };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 4029;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  if (API[url.pathname]) {
    if (req.method !== 'POST') return res.writeHead(405).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const response = await API[url.pathname](new Request(url, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) }));
    const text = await response.text();
    console.log(new Date().toLocaleTimeString(), url.pathname, response.status, req.headers.origin,
      req.headers['content-type'], Buffer.concat(chunks).length + ' bytes', url.search, text);
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    return res.end(text);
  }

  if (url.pathname === '/') return res.writeHead(307, { Location: '/landing-motores' + url.search }).end();

  if (!/\.(js|css|woff2|webp|png|jpg|ico|svg)$/.test(url.pathname)) console.log(new Date().toLocaleTimeString(), req.method, url.pathname, 'host=' + req.headers.host);
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (!extname(path)) path += '.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}).listen(PORT, () => console.log('GEMEX landings en http://localhost:' + PORT));
