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
  const selects = [...form.querySelectorAll('select')];
  const required = selects.filter(s => s.required);
  const alertBox = form.querySelector('.form-alert');
  const fileReplaces = cfg.fileReplaces === 'true';
  const landing = cfg.landing || 'general';

  /* ---------- Medición (GTM / dataLayer) ---------- */
  window.dataLayer = window.dataLayer || [];
  const track = (event, params) => window.dataLayer.push(Object.assign({ event, landing }, params));

  // Folio único por visita: identifica en WhatsApp las solicitudes que vienen de estas landings.
  // Sin 0/O ni 1/I/L para que el vendedor lo pueda dictar o copiar sin errores.
  const FOLIO_PREFIX = { motores: 'MOT', variadores: 'VAR', montaje: 'MON' };
  const FOLIO_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const folio = 'GMX-' + (FOLIO_PREFIX[landing] || 'GEN') + '-' +
    Array.from(crypto.getRandomValues(new Uint8Array(5)), b => FOLIO_CHARS[b % FOLIO_CHARS.length]).join('');

  // Parámetros de campaña que llegan en la URL (Google Ads, UTMs) para ligarlos al folio.
  const params = new URLSearchParams(location.search);
  const campaign = {};
  ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
    .forEach(k => { if (params.get(k)) campaign[k] = params.get(k); });

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
  let attachment = null; // { name, url, isImage }

  function refreshProgress() {
    const filled = required.filter(s => s.value).length;
    const complete = fileReplaces && attachment;
    steps.forEach((s, i) => s.classList.toggle('on', complete || i < filled));
    selects.forEach(s => s.classList.toggle('filled', !!s.value));
  }

  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.classList.add('show');
  }
  function clearErrors() {
    form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
    alertBox.classList.remove('show');
  }

  selects.forEach(s => s.addEventListener('change', () => {
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
      uploadSub.textContent = file.name;
      uploadBox.classList.add('has-file');
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
    const missing = required.filter(s => !s.value);
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
    selects.forEach(s => lines.push(s.dataset.emoji + ' *' + s.dataset.label + ':* ' + (s.value || pending)));
    if (fileInput) lines.push('📎 *' + fileInput.dataset.label + ':* ' +
      (attachment ? (SIMULATE ? 'Adjunto' : 'La envío a continuación en este chat') : 'No adjunto'));
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
  const waUrl = text => 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(text);
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

  function openRealWa() {
    const url = waUrl(buildMessage());
    // Pestaña nueva para no perder la landing; si el navegador la bloquea, navega directo.
    const tab = window.open(url, '_blank');
    if (tab) tab.opener = null;
    else window.location.href = url;
    if (attachment) {
      showAlert('WhatsApp no permite adjuntar archivos desde un enlace: envía la ' +
        fileInput.dataset.label.toLowerCase() + ' en el chat que se acaba de abrir.');
      alertBox.classList.add('info');
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    alertBox.classList.remove('info');
    if (!validate()) return;
    const fields = {};
    selects.forEach(s => { if (s.value) fields['campo_' + s.id] = s.value; });
    track('generate_lead', Object.assign({ lead_folio: folio, has_attachment: !!attachment }, fields, campaign));
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
