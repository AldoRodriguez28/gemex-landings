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
const COL = { folio: 1, fecha: 2, landing: 3, campana: 4, detalle: 5, ritmo: 6, gclid: 7, respuesta: 9, minutos: 10,
  estatus: 12, cotizacion: 13, venta: 16, notas: 19, toca: 20, queToca: 21 };
const ULTIMA_COL = 21;
const ESTATUS = ['Nuevo', 'Por cotizar', 'Cotizado', 'Seguimiento 1', 'Seguimiento 2', 'Seguimiento 3', 'Seguimiento 4',
  'Ganado', 'Perdido', 'Postventa'];

// Minutos entre la solicitud y la primera respuesta.
const fMinutos = r => '=IF(OR(B' + r + '="",I' + r + '=""),"",ROUND((I' + r + '-B' + r + ')*1440,0))';

// Calendario de la guía de WhatsApp (19/10/2026), en días desde la Fecha de cotización.
// El estatus dice cuántos seguimientos van: Cotizado = 0, Seguimiento 1 = 1...
//   Urgente:        0 · 1 · 2, y el día 5 se cierra como Perdido
//   Estándar:       1 · 3 · 7 · 14, y el día 21 se cierra como Perdido
//   Proyecto largo: 3 · 10 · 40 · 70, después cada 30 días a mano en Próximo seguimiento
const enCurso = r => 'OR(L' + r + '="Cotizado",LEFT(L' + r + ',12)="Seguimiento ")';
const enviados = r => 'IFERROR(IF(L' + r + '="Cotizado",0,VALUE(RIGHT(L' + r + ',1))),0)';
const proximo = r => 'IF(O' + r + '="","",O' + r + ')';

// Fecha en que toca escribir. Fuera de Cotizado y Seguimiento usa el Próximo seguimiento que escribe el vendedor.
const fToca = r => {
  const k = enviados(r), m = 'M' + r, f = 'F' + r;
  return '=IF(AND(' + enCurso(r) + ',' + m + '<>""),IFS(' +
    f + '="Urgente",' + m + '+CHOOSE(MIN(' + k + ',3)+1,0,1,2,5),' +
    f + '="Proyecto largo",IF(' + k + '<4,' + m + '+CHOOSE(' + k + '+1,3,10,40,70),' + proximo(r) + '),' +
    'TRUE,' + m + '+CHOOSE(' + k + '+1,1,3,7,14,21)),' + proximo(r) + ')';
};

// Qué mensaje toca, con la respuesta rápida de la guía.
const fQueToca = r => {
  const k = enviados(r), l = 'L' + r, f = 'F' + r;
  return '=IFS(' +
    l + '="Nuevo","Responder en menos de 20 min (/hola)",' +
    l + '="Por cotizar","Enviar la cotización (/cotiza) y cambiar a Cotizado",' +
    'NOT(' + enCurso(r) + '),"",' +
    'M' + r + '="","Falta la Fecha de cotización",' +
    k + '>=IF(' + f + '="Urgente",3,4),IF(' + f + '="Proyecto largo","Cada 30 días: anotar la fecha en Próximo seguimiento",' +
    '"Cerrar como Perdido y preguntar el motivo (/perdido)"),' +
    'TRUE,"Mandar Seguimiento "&(' + k + '+1)&" ("&CHOOSE(' + k + '+1,"/seg1","/seg3","/seg7","/seg14")&") y cambiar el estatus")';
};

function formulasDeFila(hoja, r) {
  hoja.getRange(r, COL.minutos).setFormula(fMinutos(r));
  hoja.getRange(r, COL.toca, 1, 2).setFormulas([[fToca(r), fQueToca(r)]]);
}

// Al cambiar el estatus se llenan solas (si están vacías) las fechas que antes se escribían a mano:
// salir de Nuevo → Hora de primera respuesta; Cotizado → Fecha de cotización; Ganado → Fecha y hora de venta.
function onEdit(e) {
  const hoja = e.range.getSheet();
  if (hoja.getName() !== HOJA || e.range.getColumn() > COL.estatus || e.range.getLastColumn() < COL.estatus) return;
  const ahora = new Date();
  // Solo el día, sin hora: así la fecha que toca escribir se pinta de rojo desde el inicio de ese día.
  const hoy = Utilities.formatDate(ahora, e.source.getSpreadsheetTimeZone(), 'dd/MM/yyyy');
  for (let r = Math.max(e.range.getRow(), 2); r <= e.range.getLastRow(); r++) {
    const estatus = hoja.getRange(r, COL.estatus).getValue();
    if (!estatus || estatus === 'Nuevo') continue;
    const vacia = c => hoja.getRange(r, c).getValue() === '';
    if (vacia(COL.respuesta)) hoja.getRange(r, COL.respuesta).setValue(ahora).setNumberFormat('dd/mm/yyyy hh:mm');
    if (estatus === 'Cotizado' && vacia(COL.cotizacion)) hoja.getRange(r, COL.cotizacion).setValue(hoy).setNumberFormat('dd/mm/yyyy');
    if (estatus === 'Ganado' && vacia(COL.venta)) hoja.getRange(r, COL.venta).setValue(ahora).setNumberFormat('dd/mm/yyyy hh:mm');
  }
}

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
    formulasDeFila(hoja, fila);
    hoja.getRange(fila, COL.estatus).setValue('Nuevo');
    if (data.nota) hoja.getRange(fila, COL.notas).setValue(texto(data.nota));
    return responder({ ok: true, fila: fila });
  } finally {
    lock.releaseLock();
  }
}

// Pestaña "Ejemplo": un folio con todas las columnas llenas y el formato de cada una.
// Va en una pestaña aparte para que no cuente en el Resumen ni se envíe a Google Ads.
function crearEjemplo() {
  const ss = SpreadsheetApp.getActive();
  const origen = ss.getSheetByName(HOJA);
  const hoja = ss.getSheetByName('Ejemplo') || ss.insertSheet('Ejemplo', ss.getSheets().length);
  hoja.clear();
  origen.getRange(1, 1, 1, ULTIMA_COL).copyTo(hoja.getRange(1, 1));
  for (let c = 1; c <= ULTIMA_COL; c++) hoja.setColumnWidth(c, origen.getColumnWidth(c));
  hoja.setRowHeight(1, 45);

  const fecha = (d, h, m) => new Date(2026, 9, d, h || 0, m || 0);
  hoja.getRange(2, 1, 1, ULTIMA_COL).setValues([[
    'GMX-MOT-7KD4P',
    fecha(21, 10, 15),
    'motores',
    'Motores WEG - Sureste',
    'potencia: 20 HP / 15 kW · voltaje: 440 V · velocidad: 1800 RPM - 4 polos · aplicacion: Bomba · arranque: Arrancador suave · necesidad: Proyecto o ampliación',
    'Estándar',
    'EJEMPLO-Cj0KCQjw-no-es-real',
    'Edwin',
    fecha(21, 10, 27),
    fMinutos(2),
    'Agroindustrial del Golfo SA de CV',
    'Seguimiento 2',
    fecha(21),
    48500,
    '',
    '',
    '',
    '',
    'Pidió entrega en Coatzacoalcos. Factura a nombre de la empresa.',
    fToca(2),
    fQueToca(2),
  ]]);
  hoja.getRange(3, 1, 1, ULTIMA_COL).setValues([[
    'Lo pone la landing. GMX-MOT / GMX-VAR / GMX-MON + 5 letras o números.',
    'Lo pone la landing. dd/mm/aaaa hh:mm (hora de Veracruz).',
    'Lo pone la landing: motores, variadores o montaje.',
    'Lo pone la landing. Nombre de la campaña; "Google Ads (sin UTM)" o "Directo" si no viene.',
    'Lo pone la landing: lo que el cliente eligió en el formulario.',
    'Lo pone la landing. Lista: Urgente, Estándar, Proyecto largo. Se puede corregir y cambia el calendario.',
    'Lo pone la landing. Nunca editar ni borrar.',
    'Nombre de quien atiende el folio.',
    'Se llena sola al cambiar el estatus de Nuevo a otro. Se puede corregir: dd/mm/aaaa hh:mm.',
    'Se calcula solo. No escribir.',
    'Razón social o nombre del cliente.',
    'Lista: Nuevo, Por cotizar, Cotizado, Seguimiento 1 a 4, Ganado, Perdido, Postventa. Cambiarla en cuanto se manda cada mensaje.',
    'Se llena sola al elegir Cotizado. Se puede corregir: dd/mm/aaaa. De aquí se cuentan los días de seguimiento.',
    'Solo el número, sin IVA: 48500 (sin $ ni comas).',
    'Solo para Nuevo y Por cotizar (fecha comprometida) o Proyecto largo después del Seguimiento 4: dd/mm/aaaa.',
    'Se llena sola al elegir Ganado. Se puede corregir: dd/mm/aaaa hh:mm. Google Ads la necesita.',
    'Al ganar: solo el número, sin IVA, por ejemplo 47000. Google Ads lo necesita.',
    'Solo si Estatus = Perdido. Lista: Precio, Tiempo de entrega, Ya lo compró, Se pospuso, Sin respuesta, Otro.',
    'Texto libre.',
    'Se calcula sola: Fecha de cotización + días de la guía según el ritmo y el seguimiento. Aquí: 21/10 + 7 = 28/10.',
    'Se calcula solo: qué mensaje mandar, o cuándo cerrar como Perdido.',
  ]]);

  ['B', 'I', 'P'].forEach(c => hoja.getRange(c + '2').setNumberFormat('dd/mm/yyyy hh:mm'));
  ['M', 'O', 'T'].forEach(c => hoja.getRange(c + '2').setNumberFormat('dd/mm/yyyy'));
  ['N', 'Q'].forEach(c => hoja.getRange(c + '2').setNumberFormat('$#,##0.00'));
  hoja.getRange(2, 1, 1, ULTIMA_COL).setBackground('#FCE5CD');
  hoja.getRange(3, 1, 1, ULTIMA_COL).setFontStyle('italic').setFontColor('#666666').setWrap(true).setVerticalAlignment('top');
  hoja.getRange('E2').setWrap(true);
  hoja.setFrozenRows(1);
}

// Pasa la hoja ya creada al seguimiento por estatus: Seguimiento 1 a 4 en la lista de Estatus,
// columnas T Toca escribir y U Qué toca, colores, Seguimiento hoy, Resumen, Instrucciones y Ejemplo.
// Se puede ejecutar más de una vez.
function actualizarSeguimiento() {
  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName(HOJA);
  const n = hoja.getMaxRows();
  if (hoja.getMaxColumns() < ULTIMA_COL) hoja.insertColumnsAfter(hoja.getMaxColumns(), ULTIMA_COL - hoja.getMaxColumns());
  const sobrantes = Math.min(hoja.getMaxColumns(), 22) - COL.toca + 1;
  hoja.getRange(1, COL.toca, n, sobrantes).clear().clearDataValidations();

  const enc = hoja.getRange(1, COL.toca, 1, 2);
  hoja.getRange(1, COL.notas).copyTo(enc, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  enc.setValues([['Toca escribir', 'Qué toca']]);
  hoja.setColumnWidth(COL.toca, 14 * 7);
  hoja.setColumnWidth(COL.queToca, 40 * 7);
  const formulas = [];
  for (let r = 2; r <= n; r++) formulas.push([fToca(r), fQueToca(r)]);
  hoja.getRange(2, COL.toca, n - 1, 2).setFormulas(formulas);
  hoja.getRange(2, COL.toca, n - 1, 1).setNumberFormat('dd/mm/yyyy');
  hoja.getRange(2, COL.estatus, n - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(ESTATUS, true).setAllowInvalid(false).build());

  // Colores. Las reglas de arriba ganan sobre las de abajo.
  const regla = (formula, rango) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([rango]);
  const filas = hoja.getRange(2, 1, n - 1, ULTIMA_COL);
  const activo = 'OR($L2="Nuevo",$L2="Por cotizar",$L2="Cotizado",LEFT($L2,12)="Seguimiento ")';
  hoja.setConditionalFormatRules([
    regla('=AND($T2<>"",$T2<=TODAY(),' + activo + ')', hoja.getRange(2, COL.toca, n - 1, 1))
      .setBackground('#E06666').setFontColor('#FFFFFF').setBold(true).build(),
    regla('=AND(ISNUMBER($J2),$J2>20)', hoja.getRange(2, COL.minutos, n - 1, 1)).setFontColor('#CC0000').setBold(true).build(),
    regla('=$L2="Ganado"', filas).setBackground('#D9EAD3').build(),
    regla('=$L2="Perdido"', filas).setBackground('#F4CCCC').build(),
    regla('=OR($L2="Cotizado",LEFT($L2,12)="Seguimiento ")', filas).setBackground('#FCE5CD').build(),
  ]);

  const hoy = ss.getSheetByName('Seguimiento hoy');
  hoy.clear();
  const rango = c => 'Solicitudes!$' + c + '$2:$' + c + '$2001';
  const cond = '(' + rango('T') + '<>"")*(' + rango('T') + '<=TODAY())*((' + rango('L') + '="Nuevo")+(' +
    rango('L') + '="Por cotizar")+(' + rango('L') + '="Cotizado")+(LEFT(' + rango('L') + ',12)="Seguimiento "))';
  const cols = [['Folio', 'A'], ['Empresa', 'K'], ['Estatus', 'L'], ['Toca escribir', 'T'], ['Qué toca', 'U'],
    ['Responsable', 'H'], ['Ritmo', 'F']];
  hoy.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c[0])]).setFontWeight('bold');
  hoy.getRange(2, 1, 1, cols.length).setFormulas([cols.map(c => '=IFERROR(FILTER(' + rango(c[1]) + ',' + cond + '),"")')]);
  hoy.getRange('D2:D').setNumberFormat('dd/mm/yyyy');
  cols.forEach((c, i) => hoy.setColumnWidth(i + 1, c[1] === 'U' ? 340 : 140));
  hoy.setFrozenRows(1);

  // Resumen: los folios en Seguimiento 1 a 4 siguen siendo cotizaciones en curso.
  const res = ss.getSheetByName('Resumen');
  const L = 'Solicitudes!$L$2:$L$2001', N = 'Solicitudes!$N$2:$N$2001';
  res.getRange('A1:A30').getValues().forEach(([etiqueta], i) => {
    if (etiqueta === 'Cotizado (en curso)')
      res.getRange(i + 1, 2).setFormula('=COUNTIF(' + L + ',"Cotizado")+COUNTIF(' + L + ',"Seguimiento*")');
    if (etiqueta === 'Monto cotizado en curso (MXN)')
      res.getRange(i + 1, 2).setFormula('=SUMIF(' + L + ',"Cotizado",' + N + ')+SUMIF(' + L + ',"Seguimiento*",' + N + ')');
  });

  // Instrucciones: las primeras 14 líneas no cambian; desde la 15 se reescribe.
  const ins = ss.getSheetByName('Instrucciones');
  ins.getRange(15, 1, Math.max(ins.getLastRow() - 14, 1), 1).clearContent();
  const lineas = [
    'Estatus: Nuevo → Por cotizar → Cotizado → Seguimiento 1 → 2 → 3 → 4 → Ganado / Perdido → Postventa (Postventa cuenta como venta en el Resumen).',
    'Cada vez que se manda un seguimiento, cambiar el estatus al número que se mandó: Seguimiento 1, Seguimiento 2...',
    'Toca escribir y Qué toca se calculan solos con el calendario de la guía de WhatsApp, contando desde la Fecha de cotización:',
    '  - Urgente: el mismo día, día 1 y día 2; el día 5, cerrar como Perdido.',
    '  - Estándar: día 1, 3, 7 y 14; el día 21, cerrar como Perdido.',
    '  - Proyecto largo: día 3, 10, 40 y 70; después, anotar a mano cada 30 días en Próximo seguimiento.',
    'En Nuevo y Por cotizar, Toca escribir usa la fecha que el vendedor escribe en Próximo seguimiento.',
    'Se llenan solas al cambiar el estatus (se pueden corregir): Hora de primera respuesta al salir de Nuevo, Fecha de cotización al elegir Cotizado y Fecha y hora de venta al elegir Ganado.',
    'Toca escribir se pinta de rojo el día que toca o si ya pasó. La pestaña Seguimiento hoy junta esos folios.',
    'Minutos para responder: se calcula solo; en rojo si pasan de 20 minutos.',
    'Si se pierde: elegir el motivo. Sirve para ajustar campañas y precios.',
    'La pestaña Ejemplo muestra un folio lleno y el formato de cada columna.',
  ];
  ins.getRange(15, 1, lineas.length, 1).setValues(lineas.map(l => [l]));

  crearEjemplo();
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
