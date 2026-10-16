/*
 * Sube la foto o el documento del pre-filtro a Cloudflare R2 y devuelve su URL pública,
 * para que el enlace viaje en el mensaje de WhatsApp (wa.me solo admite texto).
 *
 *   POST /api/upload?landing=motores&folio=GMX-MOT-XXXXX
 *   Content-Type: image/jpeg | image/png | image/webp | application/pdf
 *   Cuerpo: el archivo tal cual (la landing reduce las fotos antes de enviarlas).
 *
 * Ruta en el bucket: landing-<landing>/<folio>/<aleatorio>.<ext>
 * Variables: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL.
 * Sin dependencias: la firma SigV4 de S3 se hace con node:crypto.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

const LANDINGS = { motores: 'MOT', variadores: 'VAR', montaje: 'MON' };
const FOLIO = /^GMX-(MOT|VAR|MON)-[2-9A-HJKMNP-Z]{5}$/;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_BYTES = 4 * 1024 * 1024; // Vercel limita el cuerpo a 4.5 MB
const ORIGIN = /^(https:\/\/(cotiza\.gemexsi\.com\.mx|gemex-landings(-[a-z0-9-]+)?\.vercel\.app)|http:\/\/localhost(:\d+)?)$/;

// Firma real del archivo: evita que se suba cualquier cosa con un Content-Type falso.
function matchesType(bytes, type) {
  const hex = Buffer.from(bytes.subarray(0, 12)).toString('hex');
  if (type === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (type === 'image/png') return hex.startsWith('89504e47');
  if (type === 'image/webp') return hex.startsWith('52494646') && hex.slice(16, 24) === '57454250';
  if (type === 'application/pdf') return hex.startsWith('255044462d');
  return false;
}

const json = (status, body) => Response.json(body, { status });
const env = name => (process.env[name] || '').trim();
const sha256 = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

async function putObject(key, body, type) {
  const host = env('R2_ACCOUNT_ID') + '.r2.cloudflarestorage.com';
  const path = '/' + env('R2_BUCKET') + '/' + key;
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const hash = sha256(body);
  const signed = 'host;x-amz-content-sha256;x-amz-date';
  const request = ['PUT', path, '', 'host:' + host, 'x-amz-content-sha256:' + hash,
    'x-amz-date:' + amzDate, '', signed, hash].join('\n');
  const scope = day + '/auto/s3/aws4_request';
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(request)].join('\n');
  let k = hmac('AWS4' + env('R2_SECRET_ACCESS_KEY'), day);
  for (const part of ['auto', 's3', 'aws4_request']) k = hmac(k, part);
  const signature = createHmac('sha256', k).update(toSign).digest('hex');

  const res = await fetch('https://' + host + path, {
    method: 'PUT',
    headers: {
      'Content-Type': type,
      'x-amz-content-sha256': hash,
      'x-amz-date': amzDate,
      Authorization: 'AWS4-HMAC-SHA256 Credential=' + env('R2_ACCESS_KEY_ID') + '/' + scope +
        ', SignedHeaders=' + signed + ', Signature=' + signature,
    },
    body,
  });
  if (!res.ok) throw new Error('R2 ' + res.status + ' ' + (await res.text()).slice(0, 200));
}

export async function POST(request) {
  if (!ORIGIN.test(request.headers.get('origin') || '')) return json(403, { error: 'origen no permitido' });

  const params = new URL(request.url).searchParams;
  const landing = params.get('landing');
  const folio = params.get('folio') || '';
  if (!LANDINGS[landing] || !FOLIO.test(folio) || folio.split('-')[1] !== LANDINGS[landing])
    return json(400, { error: 'landing o folio inválido' });

  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!TYPES[type]) return json(415, { error: 'formato no admitido' });
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json(413, { error: 'archivo demasiado grande' });

  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length || body.length > MAX_BYTES) return json(413, { error: 'archivo vacío o demasiado grande' });
  if (!matchesType(body, type)) return json(415, { error: 'el contenido no coincide con el formato' });

  // Sufijo aleatorio: el folio aparece en el chat y no debe bastar para adivinar el enlace.
  const key = 'landing-' + landing + '/' + folio + '/' + randomBytes(9).toString('base64url') + '.' + TYPES[type];
  try {
    await putObject(key, body, type);
  } catch (err) {
    console.error(err);
    return json(502, { error: 'no se pudo guardar el archivo' });
  }
  return json(200, { url: env('R2_PUBLIC_URL').replace(/\/+$/, '') + '/' + key });
}
