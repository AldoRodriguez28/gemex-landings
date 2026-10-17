/*
 * Guarda en Cloudflare R2 el registro de cada solicitud enviada desde las landings: folio, identificador
 * del clic de Google Ads (gclid / gbraid / wbraid), UTMs y datos técnicos. Con él se sube después a
 * Google Ads qué folios terminaron en venta (scripts/conversiones_ads.mjs).
 *
 *   POST /api/lead   Content-Type: application/json
 *   { landing, folio, has_attachment, gclid?, gbraid?, wbraid?, utm_*?, campos? }
 *
 * Ruta en el bucket: leads/<AAAA-MM-DD>/<folio>-<aleatorio>.json (fecha en UTC)
 * El sufijo aleatorio evita que el enlace público del bucket se pueda adivinar a partir del folio.
 * No guarda datos personales: el formulario no los pide (el teléfono llega solo a WhatsApp).
 */
import { randomBytes } from 'node:crypto';
import { FOLIO, LANDINGS, ORIGIN, json, putObject } from './_r2.mjs';

const MAX_BYTES = 8 * 1024;
const CLICK_ID = /^[\w-]{1,200}$/;
const CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

const text = (v, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export async function POST(request) {
  if (!ORIGIN.test(request.headers.get('origin') || '')) return json(403, { error: 'origen no permitido' });
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json(413, { error: 'registro demasiado grande' });

  let data;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json(413, { error: 'registro demasiado grande' });
    data = JSON.parse(raw);
  } catch {
    return json(400, { error: 'JSON inválido' });
  }

  const { landing, folio } = data || {};
  if (!LANDINGS[landing] || !FOLIO.test(folio || '') || folio.split('-')[1] !== LANDINGS[landing])
    return json(400, { error: 'landing o folio inválido' });

  const record = { folio, landing, fecha: new Date().toISOString(), has_attachment: data.has_attachment === true };
  for (const k of CLICK_KEYS) if (CLICK_ID.test(data[k] || '')) record[k] = data[k];
  for (const k of UTM_KEYS) if (text(data[k], 150)) record[k] = text(data[k], 150);
  if (data.campos && typeof data.campos === 'object') {
    const campos = {};
    for (const [k, v] of Object.entries(data.campos).slice(0, 20))
      if (/^[a-z_]{1,40}$/.test(k) && text(v, 120)) campos[k] = text(v, 120);
    record.campos = campos;
  }

  const key = 'leads/' + record.fecha.slice(0, 10) + '/' + folio + '-' + randomBytes(6).toString('base64url') + '.json';
  try {
    await putObject(key, JSON.stringify(record), 'application/json');
  } catch (err) {
    console.error(err);
    return json(502, { error: 'no se pudo guardar el registro' });
  }
  return json(200, { ok: true });
}
