/*
 * Utilidades compartidas por las funciones de /api (Vercel no publica archivos que empiezan con "_").
 * Acceso a Cloudflare R2 por su API compatible con S3, firmado con SigV4 usando solo node:crypto.
 * Variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL.
 */
import { createHash, createHmac } from 'node:crypto';

export const LANDINGS = { motores: 'MOT', variadores: 'VAR', montaje: 'MON' };
export const FOLIO = /^GMX-(MOT|VAR|MON)-[2-9A-HJKMNP-Z]{5}$/;
export const ORIGIN = /^(https:\/\/(cotiza\.gemexsi\.com\.mx|gemex-landings(-[a-z0-9-]+)?\.vercel\.app)|http:\/\/localhost(:\d+)?)$/;

export const json = (status, body) => Response.json(body, { status });
export const env = name => (process.env[name] || '').trim();
const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Petición firmada al bucket. key vacío = el bucket (p. ej. para listar).
export async function r2(method, key, { body = '', type, query = {} } = {}) {
  const host = env('R2_ACCOUNT_ID') + '.r2.cloudflarestorage.com';
  const path = '/' + env('R2_BUCKET') + (key ? '/' + key.split('/').map(enc).join('/') : '');
  const qs = Object.keys(query).sort().map(k => enc(k) + '=' + enc(query[k])).join('&');
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const hash = sha256(body);
  const signed = 'host;x-amz-content-sha256;x-amz-date';
  const request = [method, path, qs, 'host:' + host, 'x-amz-content-sha256:' + hash,
    'x-amz-date:' + amzDate, '', signed, hash].join('\n');
  const scope = day + '/auto/s3/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(request)].join('\n');
  let k = hmac('AWS4' + env('R2_SECRET_ACCESS_KEY'), day);
  for (const part of ['auto', 's3', 'aws4_request']) k = hmac(k, part);
  const signature = createHmac('sha256', k).update(toSign).digest('hex');

  const res = await fetch('https://' + host + path + (qs ? '?' + qs : ''), {
    method,
    headers: {
      ...(type && { 'Content-Type': type }),
      'x-amz-content-sha256': hash,
      'x-amz-date': amzDate,
      Authorization: 'AWS4-HMAC-SHA256 Credential=' + env('R2_ACCESS_KEY_ID') + '/' + scope +
        ', SignedHeaders=' + signed + ', Signature=' + signature,
    },
    ...(method === 'PUT' && { body }),
  });
  if (!res.ok) throw new Error('R2 ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res;
}

export const putObject = (key, body, type) => r2('PUT', key, { body, type });
