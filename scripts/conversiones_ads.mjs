/*
 * Arma el archivo de conversiones sin conexión para Google Ads: cruza las ventas ganadas que reporta
 * GEMEX (por folio) con los registros que guarda /api/lead en R2 (folio + gclid).
 *
 *   node --env-file=.env scripts/conversiones_ads.mjs ventas.csv [salida.csv] [--accion "Venta cerrada"]
 *
 * ventas.csv (con encabezado): folio,fecha,monto
 *   GMX-MOT-7KQ2D,2026-11-12,48500
 *   GMX-VAR-H3ZPA,2026-11-14 16:30,12800
 *
 * La salida se sube en Google Ads → Objetivos → Conversiones → Cargas. La acción de conversión
 * (por defecto "Venta cerrada", tipo importación de clics) debe existir con ese nombre exacto.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { r2 } from '../api/_r2.mjs';

const args = process.argv.slice(2);
const flag = args.indexOf('--accion');
const ACTION = flag >= 0 ? args.splice(flag, 2)[1] : 'Venta cerrada';
const [input, output = 'conversiones_google_ads.csv'] = args;
if (!input) {
  console.error('Uso: node --env-file=.env scripts/conversiones_ads.mjs ventas.csv [salida.csv] [--accion "Nombre"]');
  process.exit(1);
}
const DAY = 24 * 60 * 60 * 1000;

// Registros de R2: folio → primer registro (si el cliente envió el formulario dos veces, cuenta el primero).
async function loadLeads() {
  const leads = new Map();
  let token;
  do {
    const query = { 'list-type': '2', prefix: 'leads/', ...(token && { 'continuation-token': token }) };
    const xml = await (await r2('GET', '', { query })).text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    for (const key of keys) {
      const record = await (await r2('GET', key)).json();
      const prev = leads.get(record.folio);
      if (!prev || record.fecha < prev.fecha) leads.set(record.folio, record);
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) && (xml.match(/<NextContinuationToken>([^<]+)</) || [])[1];
  } while (token);
  return leads;
}

// Hora local de México (UTC-6, sin horario de verano desde 2022), formato que pide Google Ads.
function adsTime(date) {
  const local = new Date(date.getTime() - 6 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

const sales = (await readFile(input, 'utf8')).trim().split(/\r?\n/).slice(1)
  .map(line => line.split(',').map(s => s.trim()))
  .filter(([folio]) => folio)
  .map(([folio, fecha, monto]) => ({
    folio: folio.toUpperCase(),
    // Sin hora, se toma el mediodía; las fechas se interpretan en hora de México.
    date: new Date((fecha.includes(' ') || fecha.includes('T') ? fecha.replace(' ', 'T') : fecha + 'T12:00') + '-06:00'),
    monto: Number(monto.replace(/[$\s]/g, '')),
  }));

const leads = await loadLeads();
const rows = [];
const skipped = [];
for (const s of sales) {
  const lead = leads.get(s.folio);
  if (Number.isNaN(s.date.getTime()) || !(s.monto > 0)) skipped.push([s.folio, 'fecha o monto inválido']);
  else if (!lead) skipped.push([s.folio, 'no hay registro de ese folio (¿anterior al 17/10/2026 o mal escrito?)']);
  else if (!lead.gclid) skipped.push([s.folio, lead.gbraid || lead.wbraid
    ? 'clic desde iPhone (gbraid/wbraid): la carga por archivo no lo admite'
    : 'no vino de un anuncio de Google (' + (lead.utm_source || 'directo u orgánico') + ')']);
  else if (s.date < new Date(lead.fecha)) skipped.push([s.folio, 'la venta es anterior a la solicitud']);
  else if (Date.now() - new Date(lead.fecha) > 90 * DAY) skipped.push([s.folio, 'el clic tiene más de 90 días']);
  else rows.push([lead.gclid, ACTION, adsTime(s.date), s.monto.toFixed(2), 'MXN', lead.utm_campaign || '']);
}

const csv = ['Parameters:TimeZone=America/Mexico_City',
  'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency',
  ...rows.map(r => r.slice(0, 5).join(','))].join('\n') + '\n';
await writeFile(output, csv);

console.log(`${leads.size} registros en R2 · ${sales.length} ventas en ${input}`);
console.log(`${rows.length} conversiones en ${output} (MXN ${rows.reduce((t, r) => t + Number(r[3]), 0).toLocaleString('es-MX')})`);
const byCampaign = {};
rows.forEach(r => { byCampaign[r[5] || '(sin campaña)'] = (byCampaign[r[5] || '(sin campaña)'] || 0) + 1; });
Object.entries(byCampaign).forEach(([c, n]) => console.log('  ' + c + ': ' + n));
if (skipped.length) {
  console.log(`\n${skipped.length} ventas no se pueden subir:`);
  skipped.forEach(([f, why]) => console.log('  ' + f + ': ' + why));
}
