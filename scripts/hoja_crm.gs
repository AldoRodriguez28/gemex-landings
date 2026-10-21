/*
 * Apps Script de la hoja "CRM GEMEX — Cotizaciones". Recibe cada solicitud de las landings
 * (api/_sheet.mjs) y la escribe como fila nueva en la pestaña Solicitudes.
 *
 * Instalación (una sola vez, con la cuenta dueña de la hoja):
 *   1. En la hoja: Extensiones → Apps Script. Borrar el contenido y pegar este archivo. Guardar.
 *   2. Elegir la función "configurar" y Ejecutar. Autorizar. En el registro sale el SECRET: copiarlo.
 *   3. Implementar → Nueva implementación → tipo "Aplicación web".
 *      Ejecutar como: Yo. Quién tiene acceso: Cualquier usuario. Implementar y copiar la URL que termina en /exec.
 *   4. En Vercel: SHEET_WEBHOOK_URL = esa URL y SHEET_WEBHOOK_SECRET = el SECRET. Volver a desplegar.
 * Si se cambia este código: Implementar → Gestionar implementaciones → editar → Nueva versión (la URL no cambia).
 */

const HOJA = 'Solicitudes';
const FOLIO = /^GMX-(MOT|VAR|MON)-[2-9A-HJKMNP-Z]{5}$/;
const RITMOS = ['Urgente', 'Estándar', 'Proyecto largo'];
// Columnas de la pestaña Solicitudes (1 = A)
const COL = { folio: 1, fecha: 2, landing: 3, campana: 4, detalle: 5, ritmo: 6, gclid: 7, minutos: 10, estatus: 12, notas: 19 };

function configurar() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('America/Mexico_City');
  ss.setSpreadsheetLocale('es_MX');
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('SECRET: ' + props.getProperty('SECRET'));
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder({ ok: false, error: 'JSON inválido' });
  }
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || data.secret !== secret) return responder({ ok: false, error: 'no autorizado' });
  if (!FOLIO.test(data.folio || '')) return responder({ ok: false, error: 'folio inválido' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = SpreadsheetApp.getActive().getSheetByName(HOJA);
    const folios = hoja.getRange(2, COL.folio, Math.max(hoja.getLastRow() - 1, 1), 1).getValues();
    let ultima = 1;
    for (let i = 0; i < folios.length; i++) {
      if (folios[i][0] === data.folio) return responder({ ok: true, duplicado: true });
      if (folios[i][0] !== '') ultima = i + 2;
    }
    const fila = ultima + 1;
    if (fila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 100);

    const texto = v => String(v || '').slice(0, 500);
    hoja.getRange(fila, COL.folio, 1, 7).setValues([[
      data.folio,
      new Date(data.fecha),
      texto(data.landing),
      texto(data.campana),
      texto(data.detalle),
      RITMOS.indexOf(data.ritmo) >= 0 ? data.ritmo : 'Estándar',
      texto(data.gclid),
    ]]);
    hoja.getRange(fila, COL.fecha).setNumberFormat('dd/mm/yyyy hh:mm');
    hoja.getRange(fila, COL.minutos).setFormula('=IF(OR(B' + fila + '="",I' + fila + '=""),"",ROUND((I' + fila + '-B' + fila + ')*1440,0))');
    hoja.getRange(fila, COL.estatus).setValue('Nuevo');
    if (data.nota) hoja.getRange(fila, COL.notas).setValue(texto(data.nota));
    return responder({ ok: true, fila: fila });
  } finally {
    lock.releaseLock();
  }
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
