/*
 * Envía cada solicitud a la hoja "CRM GEMEX — Cotizaciones" (Google Sheets) por medio del
 * Apps Script de scripts/hoja_crm.gs, publicado como aplicación web en la cuenta dueña de la hoja.
 * Variables: SHEET_WEBHOOK_URL (URL /exec de la aplicación web) y SHEET_WEBHOOK_SECRET (el mismo
 * valor que la propiedad SECRET del script). Sin ellas no se envía nada.
 */
import { env } from './_r2.mjs';

const TIMEOUT_MS = 8000;

// Ritmo de seguimiento según lo que el cliente eligió en el pre-filtro (guía de seguimiento del 19/10/2026).
export function ritmo(campos = {}) {
  const eleccion = [campos.necesidad, campos.etapa, campos.inicio].filter(Boolean).join(' ').toLowerCase();
  if (/urgente/.test(eleccion)) return 'Urgente';
  if (/solo presupuesto|idea:|licitación|3 a 6 meses|más de 6 meses/.test(eleccion)) return 'Proyecto largo';
  return 'Estándar';
}

// Columnas que llena la landing en la pestaña Solicitudes (las demás son del vendedor).
export function fila(record) {
  const campos = record.campos || {};
  const clic = record.gclid || record.gbraid || record.wbraid;
  const iphone = !record.gclid && (record.gbraid || record.wbraid);
  return {
    folio: record.folio,
    fecha: record.fecha,
    landing: record.landing,
    campana: record.utm_campaign || (clic ? 'Google Ads (sin UTM)' : 'Directo'),
    detalle: Object.entries(campos).map(([k, v]) => k + ': ' + v).join(' · '),
    ritmo: ritmo(campos),
    gclid: record.gclid || '',
    nota: iphone ? 'Clic de iPhone sin GCLID (' + (record.gbraid ? 'gbraid' : 'wbraid') + '): la venta no se envía a Google Ads desde la hoja.' : '',
  };
}

export async function sendToSheet(record) {
  const url = env('SHEET_WEBHOOK_URL');
  if (!url) return { skipped: true };
  // Apps Script responde con una redirección a googleusercontent.com; fetch la sigue y trae la respuesta.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env('SHEET_WEBHOOK_SECRET'), ...fila(record) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.ok) throw new Error('hoja: ' + res.status + ' ' + JSON.stringify(out));
  return out;
}
