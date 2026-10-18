/*
 * Sube la foto o el documento del pre-filtro a Cloudflare R2 y devuelve su URL pública,
 * para que el enlace viaje en el mensaje de WhatsApp (wa.me solo admite texto).
 *
 *   POST /api/upload?landing=motores&folio=GMX-MOT-XXXXX
 *   Content-Type: image/jpeg | image/png | image/webp | application/pdf
 *   Cuerpo: el archivo tal cual (la landing reduce las fotos antes de enviarlas).
 *
 * Ruta en el bucket: landing-<landing>/<folio>/<aleatorio>.<ext>
 * Variables y firma de R2: ver _r2.mjs.
 */
import { randomBytes } from 'node:crypto';
import { FOLIO, LANDINGS, ORIGIN, env, json, putObject } from './_r2.mjs';

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_BYTES = 4 * 1024 * 1024; // Vercel limita el cuerpo a 4.5 MB

// Firma real del archivo: evita que se suba cualquier cosa con un Content-Type falso.
function matchesType(bytes, type) {
  const hex = Buffer.from(bytes.subarray(0, 12)).toString('hex');
  if (type === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (type === 'image/png') return hex.startsWith('89504e47');
  if (type === 'image/webp') return hex.startsWith('52494646') && hex.slice(16, 24) === '57454250';
  if (type === 'application/pdf') return hex.startsWith('255044462d');
  return false;
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
