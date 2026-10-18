/*
 * Pre-filtro técnico + envío a WhatsApp para las landings de GEMEX.
 *
 * Cada página configura el comportamiento desde el marcado:
 *   <form data-quote-form
 *         data-title="..."          encabezado del mensaje de WhatsApp
 *         data-intro="..."          primera línea del mensaje
 *         data-closing="..."        pregunta de cierre
 *         data-file-replaces="true" la foto/archivo sustituye a los campos obligatorios
 *         data-reply1="..." data-reply2="...">  respuestas simuladas del asesor
 *         data-landing="motores"  identifica la landing en el folio y en la medición
 *   <select required data-label="Potencia" data-emoji="⚙️">
 *   <input type="number" data-label="Corriente" data-unit="A" data-emoji="🔋">  campo libre (opcional si no lleva required)
 *   <input type="file" data-label="Placa de datos">
 */
(function () {
  // Número que recibe las solicitudes (52 + 10 dígitos, sin espacios).
  // Producción GEMEX: 522294487372 · Pruebas: 522291532115
  const WA_NUMBER = '522294487372';
  // true = muestra el WhatsApp simulado (útil para proyectar sin celular);
  // false = abre WhatsApp real con la ficha técnica pre-cargada.
  const SIMULATE = false;
  const STATUS_ONLINE = 'Cuenta de empresa · en línea';

  const form = document.querySelector('[data-quote-form]');
  if (!form) return;
  const cfg = form.dataset;
  const controls = [...form.querySelectorAll('select, input[data-label]:not([type=file])')];
  const required = controls.filter(s => s.required);
  const value = s => s.value.trim();
  const display = s => value(s) && s.dataset.unit ? value(s) + ' ' + s.dataset.unit : value(s);
  const alertBox = form.querySelector('.form-alert');
  const fileReplaces = cfg.fileReplaces === 'true';
  const landing = cfg.landing || 'general';

  /* ---------- Medición (GTM / dataLayer) ---------- */
  window.dataLayer = window.dataLayer || [];
  // GTM conserva el último valor de cada clave: se limpian los parámetros de otros eventos
  // para que no se cuelen (p. ej. file_type de file_upload en generate_lead).
  const track = (event, params) => window.dataLayer.push(Object.assign(
    { event, landing, form_field: undefined, file_type: undefined, error_count: undefined, error_fields: undefined },
    params));

  // Folio único por visita: identifica en WhatsApp las solicitudes que vienen de estas landings.
  // Sin 0/O ni 1/I/L para que el vendedor lo pueda dictar o copiar sin errores.
  const FOLIO_PREFIX = { motores: 'MOT', variadores: 'VAR', montaje: 'MON' };
  const FOLIO_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const folio = 'GMX-' + (FOLIO_PREFIX[landing] || 'GEN') + '-' +
    Array.from(crypto.getRandomValues(new Uint8Array(5)), b => FOLIO_CHARS[b % FOLIO_CHARS.length]).join('');

  // Parámetros de campaña que llegan en la URL (Google Ads, UTMs) para ligarlos al folio.
  // Se guardan en la sesión para no perderlos si el visitante pasa a otra landing.
  const params = new URLSearchParams(location.search);
  let campaign = {};
  ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
    .forEach(k => { if (params.get(k)) campaign[k] = params.get(k); });
  try {
    if (Object.keys(campaign).length) sessionStorage.setItem('gmx_campaign', JSON.stringify(campaign));
    else campaign = JSON.parse(sessionStorage.getItem('gmx_campaign')) || {};
  } catch { /* almacenamiento bloqueado: se usa solo la URL */ }

  let started = false;
  function markStarted(field) {
    if (started) return;
    started = true;
    track('form_start', { form_field: field });
  }

  /* ---------- Barra de progreso: un segmento por campo obligatorio ---------- */
  const stepsBox = form.querySelector('.steps');
  stepsBox.innerHTML = required.map(() => '<i></i>').join('');
  const steps = stepsBox.querySelectorAll('i');

  /* ---------- Carga de archivo ---------- */
  const fileInput = form.querySelector('input[type=file]');
  const uploadBox = fileInput && fileInput.closest('.upload');
  const uploadIco = uploadBox && uploadBox.querySelector('.ico');
  const uploadTitle = uploadBox && uploadBox.querySelector('strong');
  const uploadSub = uploadBox && uploadBox.querySelector('span');
  const defaults = uploadBox && { ico: uploadIco.innerHTML, title: uploadTitle.textContent, sub: uploadSub.textContent };
  let attachment = null; // { name, url, isImage, upload, link }

  /* ---------- Subida del adjunto a R2: wa.me solo admite texto, así que se envía el enlace ---------- */
  const MAX_SIDE = 1600;
  async function shrink(file) {
    if (!file.type.startsWith('image/')) return file;
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise(resolve => canvas.toBlob(b => resolve(b || file), 'image/jpeg', 0.82));
    } catch {
      return file; // formato que el navegador no decodifica: se intenta tal cual
    }
  }
  async function uploadFile(file) {
    const blob = await shrink(file);
    const res = await fetch('/api/upload?landing=' + landing + '&folio=' + folio,
      { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    if (!res.ok) throw new Error('upload ' + res.status);
    return (await res.json()).url;
  }

  // Registro folio + clic de Google Ads en R2, para subir después qué folios se vendieron.
  // keepalive: la petición termina aunque el navegador salga de la página hacia WhatsApp.
  let leadSaved = false;
  function saveLead(fields) {
    if (leadSaved) return;
    leadSaved = true;
    const campos = {};
    Object.keys(fields).forEach(k => { campos[k.replace(/^campo_/, '')] = fields[k]; });
    fetch('/api/lead', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ landing, folio, has_attachment: !!attachment, campos }, campaign)),
    }).catch(err => console.warn(err));
  }

  function refreshProgress() {
    const filled = required.filter(value).length;
    const complete = fileReplaces && attachment;
    steps.forEach((s, i) => s.classList.toggle('on', complete || i < filled));
    controls.forEach(s => s.classList.toggle('filled', !!value(s)));
  }

  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.classList.add('show');
  }
  function clearErrors() {
    form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
    alertBox.classList.remove('show');
  }

  controls.forEach(s => s.addEventListener(s.tagName === 'SELECT' ? 'change' : 'input', () => {
    markStarted(s.id);
    s.closest('.field').classList.remove('invalid');
    alertBox.classList.remove('show');
    refreshProgress();
  }));

  if (fileInput) {
    const accepts = (fileInput.accept || '').split(',').map(a => a.trim()).filter(Boolean);
    const allowed = file => !accepts.length || accepts.some(a =>
      a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a);

    function setFile(file) {
      if (!file) return;
      if (!allowed(file)) {
        showAlert('Formato no admitido. ' + defaults.sub);
        return;
      }
      if (attachment) URL.revokeObjectURL(attachment.url);
      attachment = { name: file.name, url: URL.createObjectURL(file), isImage: file.type.startsWith('image/') };
      uploadIco.innerHTML = attachment.isImage
        ? '<img alt="" src="' + attachment.url + '">'
        : '<span class="doc">PDF</span>';
      uploadTitle.textContent = fileInput.dataset.label + ' adjunto ✓';
      uploadSub.textContent = file.name + ' · subiendo…';
      uploadBox.classList.add('has-file');
      const current = attachment;
      current.upload = uploadFile(file)
        .then(link => { current.link = link; }, err => console.warn(err))
        .finally(() => { if (attachment === current) uploadSub.textContent = file.name + (current.link ? ' · listo ✓' : ''); });
      markStarted('archivo');
      track('file_upload', { file_type: attachment.isImage ? 'imagen' : 'pdf' });
      if (fileReplaces) clearErrors();
      refreshProgress();
    }
    function clearFile() {
      if (attachment) URL.revokeObjectURL(attachment.url);
      attachment = null;
      fileInput.value = '';
      uploadIco.innerHTML = defaults.ico;
      uploadTitle.textContent = defaults.title;
      uploadSub.textContent = defaults.sub;
      uploadBox.classList.remove('has-file');
      refreshProgress();
    }

    fileInput.addEventListener('change', e => setFile(e.target.files[0]));
    uploadBox.querySelector('.rm').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearFile(); });
    ['dragenter', 'dragover'].forEach(ev => uploadBox.addEventListener(ev, e => { e.preventDefault(); uploadBox.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => uploadBox.addEventListener(ev, e => { e.preventDefault(); uploadBox.classList.remove('drag'); }));
    uploadBox.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));
  }

  /* ---------- Validación ---------- */
  function validate() {
    if (fileReplaces && attachment) return true;
    const missing = required.filter(s => !value(s));
    if (!missing.length) return true;
    missing.forEach(s => s.closest('.field').classList.add('invalid'));
    track('form_error', { error_count: missing.length, error_fields: missing.map(s => s.id).join(',') });
    showAlert('Faltan ' + missing.length + ' dato(s) marcados en rojo' +
      (fileReplaces && fileInput ? ', o bien adjunta: ' + fileInput.dataset.label.toLowerCase() + '.' : '.'));
    missing[0].focus();
    return false;
  }

  function buildMessage() {
    const pending = fileReplaces && attachment ? 'Ver ' + fileInput.dataset.label.toLowerCase() : 'Por definir';
    const lines = ['*' + cfg.title + '*', '🔖 *Folio:* ' + folio, '', cfg.intro, ''];
    // data-not-on-file: dato que la placa no trae (p. ej. aplicación); vacío queda "Por definir".
    controls.forEach(s => lines.push(s.dataset.emoji + ' *' + s.dataset.label + ':* ' +
      (display(s) || ('notOnFile' in s.dataset ? 'Por definir' : pending))));
    if (fileInput) lines.push('📎 *' + fileInput.dataset.label + ':* ' +
      (attachment ? attachment.link || (SIMULATE ? 'Adjunto' : 'La envío a continuación en este chat') : 'No adjunto'));
    lines.push('', cfg.closing, '_Enviado desde gemexsi.com.mx · ' + document.title.split('·').pop().trim() + '_');
    return lines.join('\n');
  }

  /* ---------- WhatsApp simulado ---------- */
  const overlay = document.getElementById('waOverlay');
  const waBody = document.getElementById('waBody');
  const waText = document.getElementById('waText');
  const waSend = document.getElementById('waSend');
  const waStatus = document.getElementById('waStatus');
  const waReal = document.getElementById('waReal');
  let timers = [];
  // api.whatsapp.com en lugar de wa.me: la redirección de wa.me convierte algunos emojis en "�".
  const waUrl = text => 'https://api.whatsapp.com/send?phone=' + WA_NUMBER + '&text=' + encodeURIComponent(text);
  waReal.textContent = 'Enviar al WhatsApp real (+' + WA_NUMBER.replace(/^52(\d{3})(\d{3})(\d{4})$/, '52 $1 $2 $3') + ') ↗';

  const now = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const escape = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const formatWa = t => escape(t)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');

  function bubble(dir, text, file) {
    const b = document.createElement('div');
    b.className = 'bubble ' + dir;
    if (file && file.isImage) {
      const img = document.createElement('img');
      img.src = file.url; img.alt = '';
      b.appendChild(img);
    } else if (file) {
      const f = document.createElement('div');
      f.className = 'file';
      f.textContent = '📄 ' + file.name;
      b.appendChild(f);
    }
    if (text) {
      const t = document.createElement('div');
      t.innerHTML = formatWa(text);
      b.appendChild(t);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = now() + (dir === 'out' ? ' <span class="ticks">✓✓</span>' : '');
    b.appendChild(meta);
    waBody.appendChild(b);
    waBody.scrollTop = waBody.scrollHeight;
    return b;
  }

  function typingThen(ms, fn) {
    const t = document.createElement('div');
    t.className = 'typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    waBody.appendChild(t);
    waBody.scrollTop = waBody.scrollHeight;
    waStatus.textContent = 'escribiendo…';
    timers.push(setTimeout(() => { t.remove(); waStatus.textContent = STATUS_ONLINE; fn(); }, ms));
  }

  function openWa() {
    timers.forEach(clearTimeout); timers = [];
    waBody.innerHTML = '<div class="wa-note">🔒 Ficha técnica pre-cargada por el configurador de GEMEX. Revisa y pulsa enviar.</div>';
    waText.value = buildMessage();
    waText.rows = 6;
    waSend.disabled = false;
    waReal.classList.remove('show');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { waText.focus(); waText.setSelectionRange(0, 0); waText.scrollTop = 0; }, 50);
  }
  function closeWa() {
    timers.forEach(clearTimeout); timers = [];
    waStatus.textContent = STATUS_ONLINE;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  function send() {
    const text = waText.value.trim();
    if (!text) return;
    waReal.href = waUrl(text);
    waReal.classList.add('show');
    if (attachment) bubble('out', '', attachment);
    const sent = bubble('out', text);
    waText.value = '';
    waText.rows = 1;
    waSend.disabled = true;
    timers.push(setTimeout(() => sent.querySelector('.ticks').classList.add('read'), 900));
    timers.push(setTimeout(() => typingThen(1600, () => {
      bubble('in', cfg.reply1);
      timers.push(setTimeout(() => typingThen(1400, () => bubble('in', cfg.reply2)), 900));
    }), 1300));
  }

  async function openRealWa() {
    // Si la subida no ha terminado, la pestaña se abre ya (dentro del clic, para que el navegador
    // no la bloquee) y se dirige a WhatsApp cuando haya enlace o se agote la espera.
    const pending = attachment && !attachment.link;
    const tab = window.open(pending ? '' : waUrl(buildMessage()), '_blank');
    if (tab) tab.opener = null;
    if (pending) {
      showAlert('Subiendo ' + fileInput.dataset.label.toLowerCase() + '…');
      alertBox.classList.add('info');
      await Promise.race([attachment.upload, new Promise(r => setTimeout(r, 15000))]);
      alertBox.classList.remove('show');
    }
    // Pestaña nueva para no perder la landing; si el navegador la bloquea, navega directo.
    const url = waUrl(buildMessage());
    if (!tab) window.location.href = url;
    else if (pending) tab.location.href = url;
    if (attachment && !attachment.link) {
      showAlert('No se pudo subir el archivo (' + fileInput.dataset.label.toLowerCase() +
        '): adjúntalo en el chat de WhatsApp que se acaba de abrir.');
      alertBox.classList.add('info');
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    alertBox.classList.remove('info');
    if (!validate()) return;
    const fields = {};
    controls.forEach(s => { if (value(s)) fields['campo_' + s.id] = display(s); });
    track('generate_lead', Object.assign({ lead_folio: folio, has_attachment: !!attachment }, fields, campaign));
    saveLead(fields);
    SIMULATE ? openWa() : openRealWa();
  });
  waSend.addEventListener('click', send);
  waText.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  });
  document.getElementById('waBack').addEventListener('click', closeWa);
  document.getElementById('closeDemo').addEventListener('click', closeWa);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeWa(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeWa(); });

  /* ---------- Enlaces que preseleccionan un campo: data-preset="id=valor" ---------- */
  document.querySelectorAll('[data-preset]').forEach(link => link.addEventListener('click', () => {
    const [id, value] = link.dataset.preset.split('=');
    const select = document.getElementById(id);
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }));

  refreshProgress();
})();
