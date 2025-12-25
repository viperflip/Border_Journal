(() => {
  'use strict';

  // ==============================
  // Constants
  // ==============================
  const APP_VERSION = '3.1.7';
  const DATA_KEY = 'shift_manager_data_v2';
  const SETTINGS_KEY = 'shift_manager_settings_v2';

  const BACKUP_KEY = 'shift_manager_backups_v2';
  const BACKUP_LIMIT = 5;
  const SAVE_DEBOUNCE_MS = 150;
  const USER_FACING_VERSION = APP_VERSION; // shown in UI
  const VERSION_LABEL = `Версия ${USER_FACING_VERSION}`;


  // ==============================
  // DOM helpers
  // ==============================
  const $ = (sel) => document.querySelector(sel);

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v ?? '';
      else if (k === 'html') node.innerHTML = v ?? '';
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  const clampList = (arr, n) => arr.slice(0, n);
  const uniq = (arr) => Array.from(new Set((arr || []).map(x => (x ?? '').toString().trim()).filter(Boolean)));

  // ==============================
  // IDs / time utils (минимальная "полировка")
  // ==============================
  const newId = () => (crypto?.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);

  function parseHHMM(s) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((s ?? '').toString().trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function formatMinutes(mins) {
    const m = Math.max(0, Math.round(Number(mins) || 0));
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // Разница между двумя HH:MM, учитывая переход через полночь.
  // Возвращает null, если формат времени неверный.
  function diffWithMidnight(start, end) {
    const s = parseHHMM(start);
    const e = parseHHMM(end);
    if (s === null || e === null) return null;
    return e >= s ? e - s : (24 * 60 - s) + e;
  }

  function ensureIds(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => (x && typeof x === 'object' ? (x.id ? x : { ...x, id: newId() }) : x));
  }

  function findIndexById(arr, id) {
    if (!Array.isArray(arr)) return -1;
    return arr.findIndex((x) => x && typeof x === 'object' && String(x.id) === String(id));
  }

  function nowHHMM() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function toast(msg) {
    // очень лёгкий toast без зависимостей
    const t = el('div', { class: 'toast', text: msg });
    t.setAttribute('role','status');
    t.setAttribute('aria-live','polite');
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 1600);
  }

  // ==============================
  // Splash (initial loader)
  // ==============================
  const SPLASH_MIN_MS = 1200; // "серьёзность" 😅
  let splashTimerDone = false;
  let splashAppReady = false;
  let splashSpinTimer = null;

  function startSplashSpinner() {
    const spinEl = document.getElementById('splashSpin');
    if (!spinEl) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduceMotion) {
      spinEl.textContent = '|';
      return;
    }
    const frames = ['|', '/', '-', '\\'];
    let i = 0;
    splashSpinTimer = window.setInterval(() => {
      i = (i + 1) % frames.length;
      spinEl.textContent = frames[i];
    }, 120);
  }

  function stopSplashSpinner() {
    if (splashSpinTimer) {
      clearInterval(splashSpinTimer);
      splashSpinTimer = null;
    }
  }

  function maybeHideSplash() {
    if (!splashTimerDone || !splashAppReady) return;
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    splash.classList.add('hide');
    stopSplashSpinner();
    setTimeout(() => splash.remove(), 220);
  }

  function markAppReady() {
    splashAppReady = true;
    maybeHideSplash();
  }

  // start timer immediately (script is at end of body)
  startSplashSpinner();
  setTimeout(() => {
    splashTimerDone = true;
    maybeHideSplash();
  }, SPLASH_MIN_MS);

  // ---------- Empty states ----------
  // Small lucide-style inline svgs (currentColor, stroke only)
  const EMPTY_SVGS = {
    requests:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
      + '<path d="M14 2v6h6"/>'
      + '<path d="M8 13h8"/>'
      + '<path d="M8 17h5"/>'
      + '</svg>',
    delivered:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<circle cx="12" cy="12" r="9"/>'
      + '<path d="m8.5 12.5 2.5 2.5 5-6"/>'
      + '</svg>',
    assists:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M12 12l2-2a3 3 0 1 1 4 4l-3 3"/>'
      + '<path d="M12 12l-2 2a3 3 0 1 1-4-4l3-3"/>'
      + '<path d="M14 14l-4-4"/>'
      + '</svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<circle cx="11" cy="11" r="8"/>'
      + '<path d="m21 21-4.3-4.3"/>'
      + '</svg>'
  };

  function makeEmptyState({ icon = 'requests', title, desc, actionText, onAction, secondaryText, onSecondary } = {}) {
    const actions = [];
    if (actionText && typeof onAction === 'function') {
      actions.push(el('button', { class: 'primary', type: 'button', onclick: onAction, 'aria-label': actionText }, [actionText]));
    }
    if (secondaryText && typeof onSecondary === 'function') {
      actions.push(el('button', { class: 'ghost', type: 'button', onclick: onSecondary, 'aria-label': secondaryText }, [secondaryText]));
    }

    return el('div', { class: 'empty-state', role: 'status', 'aria-live': 'polite' }, [
      el('div', { class: 'empty-ico', html: EMPTY_SVGS[icon] || EMPTY_SVGS.requests }),
      el('div', { class: 'empty-title', text: title || '' }),
      desc ? el('div', { class: 'empty-desc', text: desc }) : null,
      actions.length ? el('div', { class: 'empty-actions' }, actions) : null
    ]);
  }

  // ---------- Data / Settings ----------
  const defaultData = () => ({ v: 2, requests: [], delivered: [], assists: [], shifts: [] });

  const defaultSettings = () => ({
    ui: {
      startScreen: 'shift',
      compact: false,
      requestFields: { num: true, type: true, kusp: true, addr: true, desc: true, t1: true, t2: true, t3: true, result: true },
      deliveredFields: { fio: true, time: true, reason: true },
      assistFields: { service: true, note: true, start: true, end: true, delta: true }
    },
    dict: { types: [], results: [], reasons: [], services: [] },
    // backward-compat: старые подсказки
    templates: { result: [], reason: [] }
  });

  let data = loadData();
  let settings = loadSettings();

  window.addEventListener('beforeunload', () => {
    try { persistDataNow(); } catch {}
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
  });


  function migrateData(d) {
    const base = defaultData();
    const out = { ...base, ...(d || {}) };

    // v1 -> v2
    if (!out.v) {
      out.v = 2;
      out.assists = out.assists || [];
      out.shifts = out.shifts || [];
    }

    out.requests = ensureIds(out.requests);
    out.delivered = ensureIds(out.delivered);
    out.assists = ensureIds(out.assists);
    out.shifts = ensureIds(out.shifts).map((sh) => ({
      ...sh,
      requests: ensureIds(sh.requests),
      delivered: ensureIds(sh.delivered),
      assists: ensureIds(sh.assists)
    }));

    return out;
  }

  function safeParse(key) {
    try {
      const s = localStorage.getItem(key);
      if (!s) return null;
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function loadBackups() {
    const b = safeParse(BACKUP_KEY);
    return Array.isArray(b) ? b : [];
  }

  function saveBackups(list) {
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, BACKUP_LIMIT)));
    } catch {
      // ignore quota errors
    }
  }

  function addBackup(snapshot) {
    const entry = { ts: Date.now(), data: snapshot };
    const list = loadBackups();
    list.unshift(entry);
    // drop duplicates by ts is enough; also cap size
    saveBackups(list);
  }

  function loadData() {
    const raw = safeParse(DATA_KEY);
    if (raw) return migrateData(raw);

    // If main data is corrupted, try the newest backup.
    const backups = loadBackups();
    for (const b of backups) {
      try {
        if (b && b.data) {
          const migrated = migrateData(b.data);
          // restore
          data = migrated;
          persistDataNow(); // write back the recovered state
          return migrated;
        }
      } catch {
        // keep trying older backups
      }
    }
    return defaultData();
  }

  let saveDataTimer = null;
  function scheduleSaveData() {
    clearTimeout(saveDataTimer);
    saveDataTimer = setTimeout(persistDataNow, SAVE_DEBOUNCE_MS);
  }

  function persistDataNow() {
    try {
      // Keep mini-backup of the last known-good state (post-migration).
      addBackup(JSON.parse(JSON.stringify(data)));
      localStorage.setItem(DATA_KEY, JSON.stringify(data));
    } catch {
      // ignore quota / serialization issues
    }
  }

  // Backward-compat alias
  const saveData = scheduleSaveData;

  function loadSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      const base = defaultSettings();
      const s = { ...base, ...(raw || {}) };
      s.assists = Array.isArray(s.assists) ? s.assists : [];
      s.shifts = Array.isArray(s.shifts) ? s.shifts : [];
      // ensure archived shifts contain assists
      s.shifts = s.shifts.map(sh => ({ ...sh, assists: Array.isArray(sh.assists) ? sh.assists : [] }));

      // миграция: старые theme/haptics удаляем
      delete s.theme;
      delete s.haptics;

      s.dict = s.dict || base.dict;
      s.dict.services = Array.isArray(s.dict.services) ? s.dict.services : base.dict.services;
      s.ui.assistFields = s.ui.assistFields || base.ui.assistFields;
      s.templates = s.templates || base.templates;
      s.ui = s.ui || base.ui;

      // templates -> dict если справочники пустые
      const tRes = uniq(s.templates.result || []);
      const tRea = uniq(s.templates.reason || []);
      s.dict.types = uniq(s.dict.types || []);
      s.dict.results = uniq(s.dict.results || tRes);
      s.dict.reasons = uniq(s.dict.reasons || tRea);

      s.ui.startScreen = 'shift';
      s.ui.compact = false;
      s.ui.requestFields = { ...base.ui.requestFields, ...(s.ui.requestFields || {}) };
      s.ui.deliveredFields = { ...base.ui.deliveredFields, ...(s.ui.deliveredFields || {}) };

      
      // UI simplification: always show full information
      Object.keys(s.ui.requestFields).forEach(k => (s.ui.requestFields[k] = true));
      Object.keys(s.ui.deliveredFields).forEach(k => (s.ui.deliveredFields[k] = true));
      Object.keys(s.ui.assistFields).forEach(k => (s.ui.assistFields[k] = true));
return s;
    } catch {
      return defaultSettings();
    }
  }

  let saveSettingsTimer = null;
  function scheduleSaveSettings() {
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(persistSettingsNow, SAVE_DEBOUNCE_MS);
  }

  function persistSettingsNow() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota errors
    }
  }

  // Backward-compat alias
  const saveSettings = scheduleSaveSettings;

  function applyCompact() {
    // Compact mode removed: keep full spacing.
    document.body.classList.remove('compact');
  }

  function pushDict(kind, value) {
    const v = (value ?? '').toString().trim();
    if (!v) return;

    settings.dict = settings.dict || { types: [], results: [], reasons: [] };

    if (kind === 'type') settings.dict.types = uniq([v, ...(settings.dict.types || [])]);
    if (kind === 'result') settings.dict.results = uniq([v, ...(settings.dict.results || [])]);
    if (kind === 'reason') settings.dict.reasons = uniq([v, ...(settings.dict.reasons || [])]);

    // old templates (backward)
    if (kind === 'result') settings.templates.result = clampList(uniq([v, ...(settings.templates.result || [])]), 12);
    if (kind === 'reason') settings.templates.reason = clampList(uniq([v, ...(settings.templates.reason || [])]), 12);

    saveSettings();
  }

  // ---------- Navigation ----------
  let currentScreen = 'shift';

  function switchScreen(name) {
    currentScreen = name;
    for (const scr of document.querySelectorAll('.screen')) {
      scr.classList.toggle('active', scr.id === `screen-${name}`);
    }
    for (const btn of document.querySelectorAll('[data-screen]')) {
      btn.classList.toggle('active', btn.dataset.screen === name);
      btn.setAttribute('aria-current', btn.dataset.screen === name ? 'page' : 'false');
    }
    render();
  }

  // ==============================
  // Modal
  // ==============================
  let editContext = null; // {scope:'request'|'delivered'|'assist', id:string|null}

  function openModal({ title, fields, initialValues = {}, onSubmit }) {
    const modal = $('#modal');
    $('#modalTitle').textContent = title;
    const form = $('#modalForm');
    form.innerHTML = '';

    // строим форму
    fields.forEach((f) => {
      form.appendChild(el('label', { text: f.label }));

      const common = { name: f.name };
      if (f.required) common.required = 'required';

      const initial = (initialValues[f.name] ?? '').toString();

      let input;
      if (f.type === 'textarea') {
        input = el('textarea', common);
        input.value = initial;
      } else {
        input = el('input', {
          ...common,
          type: f.type || 'text',
          placeholder: f.placeholder || undefined,
          inputmode: f.inputmode || undefined,
          pattern: f.pattern || undefined,
          list: f.datalistId || undefined
        });
        input.value = initial;
      }

      if (f.datalistId && Array.isArray(f.datalistOptions)) {
        // remove old datalist with same id if exists inside form
        const old = form.querySelector(`#${CSS.escape(f.datalistId)}`);
        if (old) old.remove();
        form.appendChild(el('datalist', { id: f.datalistId }, f.datalistOptions.map((x) => el('option', { value: x }))));
      }

      if (f.now) {
        form.appendChild(
          el('div', { class: 'input-row' }, [
            input,
            el('button', {
              type: 'button',
              class: 'now-btn',
              text: 'Сейчас',
              onClick: () => {
                input.value = nowHHMM();
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            })
          ])
        );
      } else {
        form.appendChild(input);
      }

      // inline error placeholder
      form.appendChild(el('div', { class: 'field-error', dataset: { for: f.name } }));
    });

    // validation (soft): disable Save until form is valid; show messages after blur/touch
    const saveBtn = $('#saveModalBtn');
    const touched = new Set();
    const inputs = Array.from(form.querySelectorAll('input, textarea, select'));

    const getMsg = (inp) => {
      if (!inp) return 'Заполни поле';
      if (inp.validity.valueMissing) return 'Обязательное поле';
      if (inp.validity.patternMismatch) return 'Неверный формат';
      if (inp.validity.tooShort) return 'Слишком коротко';
      if (inp.validity.tooLong) return 'Слишком длинно';
      return inp.validationMessage || 'Проверь значение';
    };

    const setError = (inp, show) => {
      const err = form.querySelector(`.field-error[data-for="${CSS.escape(inp.name)}"]`);
      if (!err) return;
      if (show) {
        err.textContent = getMsg(inp);
        err.classList.add('show');
      } else {
        err.textContent = '';
        err.classList.remove('show');
      }
    };

    const updateValidityUI = () => {
      const ok = form.checkValidity();
      if (saveBtn) saveBtn.disabled = !ok;
      inputs.forEach((inp) => {
        if (!inp.name) return;
        const show = touched.has(inp.name) && !inp.checkValidity();
        setError(inp, show);
      });
    };

    inputs.forEach((inp) => {
      if (!inp.name) return;
      inp.addEventListener('input', updateValidityUI);
      inp.addEventListener('blur', () => {
        touched.add(inp.name);
        updateValidityUI();
      });
    });

    // initial state
    updateValidityUI();


    // submit
    const submitHandler = (ev) => {
      ev.preventDefault();
      if (!form.checkValidity()) {
        // show errors for all invalid fields
        inputs.forEach((inp) => inp.name && touched.add(inp.name));
        updateValidityUI();
        if (form.reportValidity) form.reportValidity();
        return;
      }
      const fd = new FormData(form);
      const obj = Object.fromEntries(fd.entries());
      onSubmit(obj);
      closeModal();
    };

    form.onsubmit = submitHandler;

    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');

    // focus first field
    setTimeout(() => {
      const first = form.querySelector('input, textarea, select');
      if (first) first.focus();
    }, 0);
  }

  function closeModal() {
    $('#modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    editContext = null;
  }

  $('#cancelModal').addEventListener('click', closeModal);

  // ==============================
  // About sheet
  // ==============================
  function openAboutSheet() {
    const sheet = $('#aboutSheet');
    if (!sheet) return;
    const ver = $('#aboutVersion');
    if (ver) ver.textContent = VERSION_LABEL;

    sheet.classList.remove('hidden');
    // allow transition
    requestAnimationFrame(() => sheet.classList.add('show'));

    document.body.classList.add('modal-open');
  }

  function closeAboutSheet() {
    const sheet = $('#aboutSheet');
    if (!sheet) return;
    sheet.classList.remove('show');
    setTimeout(() => {
      sheet.classList.add('hidden');
      document.body.classList.remove('modal-open');
    }, 170);
  }

  function openTelegram() {
    const user = 'makilema';
    const deep = `tg://resolve?domain=${user}`;
    const web = `https://t.me/${user}`;
    // try deep link first; fallback shortly after
    window.location.href = deep;
    setTimeout(() => {
      // if Telegram isn't installed, iOS will ignore; open web
      window.open(web, '_blank', 'noopener');
    }, 350);
  }

  async function copyAboutInfo() {
    const text = `ShiftManager — ${VERSION_LABEL} • Разработчик: Калмыков Д. • Telegram: @makilema`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Скопировано');
    } catch {
      // fallback
      const ta = el('textarea', { class: 'hidden' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Скопировано'); } catch {}
      ta.remove();
    }
  }

  function initAboutSheetUI() {
    const sheet = $('#aboutSheet');
    if (!sheet) return;

    sheet.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-sheet-close') === 'true') closeAboutSheet();
    });

    const tgBtn = $('#tgOpenBtn');
    if (tgBtn) tgBtn.addEventListener('click', openTelegram);

    const tgContact = $('#tgContactBtn');
    if (tgContact) tgContact.addEventListener('click', openTelegram);

    const copyBtn = $('#copyInfoBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyAboutInfo);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) closeAboutSheet();
    });
  }


  // ==============================
  // Field config
  // ==============================
  const REQUEST_FIELD_META = [
    ['num', 'Номер'],
    ['type', 'Тип'],
    ['kusp', 'КУСП'],
    ['addr', 'Адрес'],
    ['desc', 'Описание'],
    ['t1', 't1 (выезд)'],
    ['t2', 't2 (прибытие)'],
    ['t3', 't3 (завершение)'],
    ['result', 'Результат']
  ];

  const DELIVERED_FIELD_META = [
    ['fio', 'ФИО'],
    ['time', 'Время'],
    ['reason', 'Основание']
  ];

  const ASSIST_FIELD_META = [
    ['service', 'Служба'],
    ['note', 'Заметка'],
    ['start', 'Начало'],
    ['end', 'Окончание'],
    ['delta', 'Δ']
  ];

  function buildChecklist(containerId, meta, stateObj, onChange) {
    const root = $(`#${containerId}`);
    if (!root) return;
    root.innerHTML = '';
    meta.forEach(([key, label]) => {
      const id = `${containerId}-${key}`;
      const input = el('input', { id, type: 'checkbox' });
      input.checked = !!stateObj[key];
      input.addEventListener('change', () => onChange(key, input.checked));
      root.appendChild(
        el('label', { class: 'check', for: id }, [
          input,
          el('span', { text: label })
        ])
      );
    });
  }

  // ==============================
  // CRUD / Modals
  // ==============================
  function openRequestModal(id = null) {
    const isEdit = !!id;
    const index = isEdit ? findIndexById(data.requests, id) : -1;
    const r = isEdit && index >= 0 ? data.requests[index] : null;

    editContext = { scope: 'request', id: isEdit ? String(id) : null };

    const init = r ? { ...r } : {};

    const fields = [
      { label: 'Номер', name: 'num', required: true, type: 'text', inputmode: 'numeric', pattern: '^[0-9]+$' },
      { label: 'Тип', name: 'type', type: 'text', datalistId: 'dlType', datalistOptions: settings.dict.types || [] },
      { label: 'КУСП', name: 'kusp', type: 'text' },
      { label: 'Адрес', name: 'addr', type: 'text', required: true },
      { label: 'Описание', name: 'desc', type: 'textarea' },
      { label: 't1 (выезд)', name: 't1', type: 'time', now: true },
      { label: 't2 (прибытие)', name: 't2', type: 'time', now: true },
      { label: 't3 (завершение)', name: 't3', type: 'time', now: true },
      { label: 'Результат', name: 'result', type: 'text', datalistId: 'dlResult', datalistOptions: settings.dict.results || [] }
    ];

    openModal({
      title: isEdit ? 'Изменить заявку' : 'Новая заявка',
      fields,
      initialValues: init,
      onSubmit: (o) => {
        const prev = r || null;
        const obj = {
          id: prev?.id || newId(),
          num: (o.num || '').toString().trim(),
          type: (o.type || '').toString().trim(),
          kusp: (o.kusp || '').toString().trim(),
          addr: (o.addr || '').toString().trim(),
          desc: (o.desc || '').toString().trim(),
          t1: (o.t1 || '').toString().trim(),
          t2: (o.t2 || '').toString().trim(),
          t3: (o.t3 || '').toString().trim(),
          result: (o.result || '').toString().trim(),
          updatedAt: Date.now(),
          createdAt: prev?.createdAt || Date.now()
        };

        if (!obj.num || !/^\d+$/.test(obj.num)) {
          toast('Номер должен быть цифрами');
          return;
        }
        if (!obj.addr) {
          toast('Адрес обязателен');
          return;
        }

        if (obj.type) pushDict('type', obj.type);
        if (obj.result) pushDict('result', obj.result);

        if (isEdit && index >= 0) data.requests[index] = obj;
        else data.requests.unshift(obj);
      dispatch();
      }
    });
  }

  function openDeliveredModal(id = null) {
    const isEdit = !!id;
    const index = isEdit ? findIndexById(data.delivered, id) : -1;
    const d = isEdit && index >= 0 ? data.delivered[index] : null;

    editContext = { scope: 'delivered', id: isEdit ? String(id) : null };

    const init = d ? { ...d } : { time: nowHHMM() };

    const fields = [
      { label: 'ФИО', name: 'name', required: true, type: 'text' },
      { label: 'Время доставления', name: 'time', type: 'time', now: true },
      { label: 'Основание', name: 'reason', type: 'text', datalistId: 'dlReason', datalistOptions: settings.dict.reasons || [] }
    ];

    openModal({
      title: isEdit ? 'Изменить доставление' : 'Доставленные',
      fields,
      initialValues: init,
      onSubmit: (o) => {
        const prev = d || null;
        const obj = {
          id: prev?.id || newId(),
          name: (o.name || '').toString().trim(),
          time: (o.time || '').toString().trim(),
          reason: (o.reason || '').toString().trim(),
          updatedAt: Date.now(),
          createdAt: prev?.createdAt || Date.now()
        };
        if (!obj.name) {
          toast('ФИО обязательно');
          return;
        }
        if (obj.reason) pushDict('reason', obj.reason);

        if (isEdit && index >= 0) data.delivered[index] = obj;
        else data.delivered.unshift(obj);
      dispatch();
      }
    });
  }

  function deleteItem(scope, id) {
    if (!id) return;
    if (scope === 'request') {
      const idx = findIndexById(data.requests, id);
      if (idx >= 0) data.requests.splice(idx, 1);
    }
    if (scope === 'delivered') {
      const idx = findIndexById(data.delivered, id);
      if (idx >= 0) data.delivered.splice(idx, 1);
    }
    if (scope === 'assist') {
      const idx = findIndexById(data.assists, id);
      if (idx >= 0) data.assists.splice(idx, 1);
    }
      dispatch();
  }

  // ==============================
  // Assists (Содействия)
  // ==============================
  function openAssistModal(id = null) {
    const isEdit = !!id;
    const index = isEdit ? findIndexById(data.assists, id) : -1;
    const a = isEdit && index >= 0 ? (data.assists[index] || {}) : {};

    editContext = { scope: 'assist', id: isEdit ? String(id) : null };

    const init = isEdit ? { ...a } : { start: nowHHMM(), end: '' };

    const fields = [
      { label: 'Служба', name: 'service', required: true, type: 'text', datalistId: 'dlService', datalistOptions: settings.dict.services || [] },
      { label: 'Заметка', name: 'note', type: 'text' },
      { label: 'Начало', name: 'start', required: true, type: 'time', now: true },
      { label: 'Окончание', name: 'end', required: true, type: 'time', now: true }
    ];

    openModal({
      title: isEdit ? 'Изменить содействие' : 'Новое содействие',
      fields,
      initialValues: init,
      onSubmit: (o) => {
        const service = (o.service || '').toString().trim();
        const note = (o.note || '').toString().trim();
        const start = (o.start || '').toString().trim();
        const end = (o.end || '').toString().trim();

        if (!service) {
          toast('Служба обязательна');
          return;
        }

        const mins = diffWithMidnight(start, end);
        if (mins === null) {
          toast('Неверный формат времени');
          return;
        }

        // страховка от случайной ошибки: слишком большой интервал
        if (mins > 12 * 60) {
          const ok = confirm(`Интервал ${formatMinutes(mins)} выглядит слишком большим. Сохранить?`);
          if (!ok) return;
        }

        const obj = {
          id: a.id || newId(),
          service,
          note,
          start,
          end,
          minutes: mins,
          updatedAt: Date.now(),
          createdAt: isEdit ? (a.createdAt || Date.now()) : Date.now()
        };

        // пополнить справочник служб
        if (service) {
          settings.dict.services = uniq([service, ...(settings.dict.services || [])]);
          saveSettings();
        }

        if (isEdit && index >= 0) data.assists[index] = obj;
        else data.assists.unshift(obj);
      dispatch();
      }
    });
  }

  // ---------- Quick actions ----------
  function stampTime(id, key) {
    const index = findIndexById(data.requests, id);
    const r = index >= 0 ? data.requests[index] : null;
    if (!r) return;
    if (!r[key]) r[key] = nowHHMM();
    r.updatedAt = Date.now();
      dispatch();
  }

  function finishRequest(id) {
    const index = findIndexById(data.requests, id);
    const r = index >= 0 ? data.requests[index] : null;
    if (!r) return;

    if (!r.t3) r.t3 = nowHHMM();
    r.updatedAt = Date.now();

    if (!r.result) {
      // быстрый выбор результата: первый из справочника или prompt
      const opts = settings.dict.results || [];
      const hint = opts.length ? `Напр.: ${opts.slice(0, 5).join(', ')}` : '';
      const val = prompt(`Результат (можно оставить пустым)\n${hint}`) || '';
      r.result = val.trim();
      if (r.result) pushDict('result', r.result);
    }
      dispatch();
  }

  // ---------- Render ----------
  let requestQuery = '';
  let deliveredQuery = '';
  let assistQuery = '';

  function setSearchUI() {
    $('#requestSearch').value = requestQuery;
    $('#deliveredSearch').value = deliveredQuery;
    const a = $('#assistSearch'); if (a) a.value = assistQuery;
  }

  function renderRequests() {
    const root = $('#requestsList');
    root.innerHTML = '';

    const q = requestQuery.trim().toLowerCase();
    const show = settings.ui.requestFields;

    const items = data.requests
      .map((r) => ({ r }))
      .filter(({ r }) => {
        if (!q) return true;
        const hay = `${r.num || ''} ${r.type || ''} ${r.kusp || ''} ${r.addr || ''} ${r.desc || ''} ${r.result || ''}`.toLowerCase();
        return hay.includes(q);
      });

    if (!items.length) {
      if (q) {
        root.appendChild(
          makeEmptyState({
            icon: 'search',
            title: 'Ничего не найдено',
            desc: 'Попробуй изменить запрос или сбрось поиск.',
            actionText: 'Сбросить поиск',
            onAction: () => dispatch(() => (requestQuery = ''), { data: false, settings: false })
          })
        );
      } else {
        root.appendChild(
          makeEmptyState({
            icon: 'requests',
            title: 'Пока нет заявок',
            desc: 'Добавь первую заявку — она появится здесь.',
            actionText: '+ Заявка',
            onAction: () => openRequestModal(null)
          })
        );
      }
      return;
    }

    items.forEach(({ r }) => {
      const title = `Заявка №${(r.num || '').trim()}`.trim();

      const details = [];
      if (show.type) details.push(['Тип', r.type]);
      if (show.kusp) details.push(['КУСП', r.kusp]);
      if (show.addr) details.push(['Адрес', r.addr]);
      if (show.desc) details.push(['Описание', r.desc]);
      if (show.result) details.push(['Результат', r.result]);

      const chips = [];
      if (show.t1 && r.t1) chips.push(`t1: ${r.t1}`);
      if (show.t2 && r.t2) chips.push(`t2: ${r.t2}`);
      if (show.t3 && r.t3) chips.push(`t3: ${r.t3}`);

      const card = el('div', { class: 'card', role: 'listitem' }, [
        el('div', { class: 'card-title', text: title }),
        details.length
          ? el(
              'div',
              { class: 'card-details' },
              details
                .filter(([, v]) => (v ?? '').toString().trim())
                .map(([k, v]) =>
                  el('div', { class: 'kv' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', text: String(v).trim() })])
                )
            )
          : el('div', { class: 'card-meta', text: 'Нет данных' }),
        chips.length ? el('div', { class: 'chips' }, chips.map((t) => el('span', { class: 'chip', text: t }))) : null,

        el('div', { class: 'quick-actions' }, [
          el('button', { type: 'button', dataset: { action: 'stamp', stamp: 't1', scope: 'request', id: String(r.id) }, text: 'Выехал' }),
          el('button', { type: 'button', dataset: { action: 'stamp', stamp: 't2', scope: 'request', id: String(r.id) }, text: 'Прибыл' }),
          el('button', { type: 'button', dataset: { action: 'finish', scope: 'request', id: String(r.id) }, text: 'Завершил' })
        ]),

        el('div', { class: 'card-actions' }, [
          el('button', { class: 'edit', type: 'button', dataset: { action: 'edit', scope: 'request', id: String(r.id) }, text: 'Изменить' }),
          el('button', { class: 'delete', type: 'button', dataset: { action: 'delete', scope: 'request', id: String(r.id) }, text: 'Удалить' })
        ])
      ]);

      root.appendChild(card);
    });
  }

  function renderDelivered() {
    const root = $('#deliveredList');
    root.innerHTML = '';

    const q = deliveredQuery.trim().toLowerCase();

    const items = data.delivered
      .map((d) => ({ d }))
      .filter(({ d }) => {
        if (!q) return true;
        const hay = `${d.name || ''} ${d.time || ''} ${d.reason || ''}`.toLowerCase();
        return hay.includes(q);
      });

    if (!items.length) {
      if (q) {
        root.appendChild(
          makeEmptyState({
            icon: 'search',
            title: 'Ничего не найдено',
            desc: 'Попробуй изменить запрос или сбрось поиск.',
            actionText: 'Сбросить поиск',
            onAction: () => dispatch(() => (deliveredQuery = ''), { data: false, settings: false })
          })
        );
      } else {
        root.appendChild(
          makeEmptyState({
            icon: 'delivered',
            title: 'Пока пусто',
            desc: 'Добавь первую запись — она появится здесь.',
            actionText: '+ Добавить',
            onAction: () => openDeliveredModal(null)
          })
        );
      }
      return;
    }

    items.forEach(({ d }) => {
      const title = (d.name || '').trim() || 'Доставленные';

      const details = [];
      details.push(['Время', d.time]);
      details.push(['Основание', d.reason]);

      const card = el('div', { class: 'card', role: 'listitem' }, [
        el('div', { class: 'card-title', text: title }),
        details.length
          ? el(
              'div',
              { class: 'card-details' },
              details
                .filter(([, v]) => (v ?? '').toString().trim())
                .map(([k, v]) => el('div', { class: 'kv' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', text: String(v).trim() })]))
            )
          : el('div', { class: 'card-meta', text: 'Нет данных' }),
        el('div', { class: 'card-actions' }, [
          el('button', { class: 'edit', type: 'button', dataset: { action: 'edit', scope: 'delivered', id: String(d.id) }, text: 'Изменить' }),
          el('button', { class: 'delete', type: 'button', dataset: { action: 'delete', scope: 'delivered', id: String(d.id) }, text: 'Удалить' })
        ])
      ]);

      root.appendChild(card);
    });
  }

  function renderAssists() {
    const root = $('#assistsList');
    const totalEl = $('#assistTotal');
    if (!root || !totalEl) return;

    root.innerHTML = '';

    const q = assistQuery.trim().toLowerCase();

    const items = (data.assists || [])
      .map((a) => ({ a }))
      .filter(({ a }) => {
        if (!q) return true;
        const hay = `${a.service || ''} ${a.note || ''} ${a.start || ''} ${a.end || ''}`.toLowerCase();
        return hay.includes(q);
      });

    const totalMins = (data.assists || []).reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
    totalEl.textContent = `Итого за смену: ${formatMinutes(totalMins)}`;

    if (!items.length) {
      if (q) {
        root.appendChild(
          makeEmptyState({
            icon: 'search',
            title: 'Ничего не найдено',
            desc: 'Попробуй изменить запрос или сбрось поиск.',
            actionText: 'Сбросить поиск',
            onAction: () => dispatch(() => (assistQuery = ''), { data: false, settings: false })
          })
        );
      } else {
        root.appendChild(
          makeEmptyState({
            icon: 'assists',
            title: 'Пока нет содействий',
            desc: 'Добавь первое содействие — оно появится здесь.',
            actionText: '+ Содействие',
            onAction: () => openAssistModal(null)
          })
        );
      }
      return;
    }

    items.forEach(({ a }) => {
      const details = [];
      details.push(['Служба', a.service]);
      details.push(['Заметка', a.note]);
      details.push(['Время', `${a.start || '—'} — ${a.end || '—'}`]);
      details.push(['Δ', formatMinutes(Number(a.minutes) || diffWithMidnight(a.start, a.end) || 0)]);

      const title = (a.service || 'Содействие').trim();

      const card = el('div', { class: 'card', role: 'listitem' }, [
        el('div', { class: 'card-title', text: title }),
        el(
          'div',
          { class: 'card-details' },
          details
            .filter(([, v]) => (v ?? '').toString().trim())
            .map(([k, v]) => el('div', { class: 'kv' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', text: String(v).trim() })]))
        ),
        el('div', { class: 'card-actions' }, [
          el('button', { class: 'edit', type: 'button', dataset: { action: 'edit', scope: 'assist', id: String(a.id) }, text: 'Изменить' }),
          el('button', { class: 'delete', type: 'button', dataset: { action: 'delete', scope: 'assist', id: String(a.id) }, text: 'Удалить' })
        ])
      ]);

      root.appendChild(card);
    });
  }

  // ---------- Shift stats + archive (Stage 2) ----------
  function durationMinutes(t1, t3) {
    if (!t1 || !t3) return null;
    // смена может быть ночной → учитываем полночь
    return diffWithMidnight(t1, t3);
  }

  function renderShiftStats() {
    const root = $('#shiftStats');
    if (!root) return;

    const total = data.requests.length;
    const del = data.delivered.length;

    const mins = data.requests
      .map((r) => durationMinutes(r.t1, r.t3))
      .filter((x) => typeof x === 'number' && x >= 0);

    const avg = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null;
    const max = mins.length ? Math.max(...mins) : null;

    root.innerHTML = '';
    root.appendChild(el('div', { class: 'kv' }, [el('div', { class: 'k', text: 'Заявок в смене' }), el('div', { class: 'v', text: String(total) })]));
    root.appendChild(el('div', { class: 'kv' }, [el('div', { class: 'k', text: 'Доставленных' }), el('div', { class: 'v', text: String(del) })]));
    root.appendChild(el('div', { class: 'kv' }, [el('div', { class: 'k', text: 'Среднее t1→t3' }), el('div', { class: 'v', text: avg === null ? '—' : `${avg} мин` })]));
    root.appendChild(el('div', { class: 'kv' }, [el('div', { class: 'k', text: 'Максимум t1→t3' }), el('div', { class: 'v', text: max === null ? '—' : `${max} мин` })]));
  }

  function closeShift() {
    if (!data.requests.length && !data.delivered.length && !(data.assists && data.assists.length)) {
      toast('Смена пустая');
      return;
    }
    const ok = confirm('Закрыть смену и отправить данные в архив?');
    if (!ok) return;

    data.shifts.unshift({
      id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
      closedAt: Date.now(),
      requests: data.requests,
      delivered: data.delivered,
      assists: data.assists
    });

    data.requests = [];
    data.delivered = [];
    data.assists = [];
      dispatch();
    toast('Смена закрыта');
  }

  function renderArchive() {
    const root = $('#shiftArchive');
    if (!root) return;
    root.innerHTML = '';

    if (!data.shifts.length) {
      root.appendChild(el('div', { class: 'muted', text: 'Архив пуст' }));
      return;
    }

    data.shifts.forEach((s, idx) => {
      const dt = new Date(s.closedAt);
      const label = dt.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const reqN = s.requests?.length || 0;
      const delN = s.delivered?.length || 0;

      const row = el('div', { class: 'archive-item' }, [
        el('div', { class: 'archive-main' }, [
          el('div', { class: 'archive-title', text: `Смена ${label}` }),
          el('div', { class: 'archive-meta', text: `Заявок: ${reqN} · Доставлено: ${delN}` })
        ]),
        el('div', { class: 'archive-actions' }, [
          el('button', { class: 'edit', type: 'button', text: 'JSON', dataset: { action: 'exportShift', index: String(idx) } }),
          el('button', { class: 'delete', type: 'button', text: 'Удалить', dataset: { action: 'deleteShift', index: String(idx) } })
        ])
      ]);

      root.appendChild(row);
    });
  }

  // ---------- Export / Import ----------
  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportData() {
    const payload = {
      app: 'ShiftManager',
      appVersion: APP_VERSION,
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      data,
      settings
    };
    download(`shiftmanager-backup-${Date.now()}.json`, JSON.stringify(payload, null, 2));
  }

  function exportCurrentShift() {
    download(`shiftmanager-shift-${Date.now()}.json`, JSON.stringify({ requests: data.requests, delivered: data.delivered, assists: data.assists }, null, 2));
  }

  async function importDataFromFile(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;

    // Safety: keep a local backup before overwriting anything
    try { addBackup(JSON.parse(JSON.stringify(data))); } catch {}

    try {
      const text = await file.text();
      const obj = JSON.parse(text);

      // Support both modern and legacy export formats
      const importedData = obj?.data ? obj.data : null;
      const importedSettings = obj?.settings ? obj.settings : null;

      if (importedData) data = migrateData(importedData);
      if (importedSettings) settings = { ...defaultSettings(), ...importedSettings };

      persistDataNow();
      saveSettings();
      renderBackupMeta();
      render();
      toast('Импортировано');
    } catch {
      toast('Не удалось импортировать файл');
    }
  }

  function clearAllData() {
    const ok = confirm('Очистить все данные и настройки?');
    if (!ok) return;
    localStorage.removeItem(DATA_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    data = defaultData();
    settings = defaultSettings();
    applyCompact();
    render();
    toast('Очищено');
  }

  // ---------- Dictionaries editor ----------
  function editDictionary(kind, title) {
    const map = { types: 'types', results: 'results', reasons: 'reasons', services: 'services' };
    const key = map[kind];
    const current = uniq(settings.dict?.[key] || []);
    openModal({
      title,
      fields: [
        { label: 'Значения (по одному на строку)', name: 'list', type: 'textarea', placeholder: '' }
      ],
      initialValues: { list: current.join('\n') },
      onSubmit: (o) => {
        const list = uniq((o.list || '').split('\n').map((x) => x.trim())).slice(0, 200);
        settings.dict[key] = list;
        saveSettings();
        render(); // обновить datalist и UI
        toast('Сохранено');
      }
    });
  }

  // ---------- Backups (manual tools) ----------

  function formatDateTime(ts) {
    try {
      return new Date(ts).toLocaleString('ru-RU', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch {
      return '';
    }
  }

  function renderBackupMeta() {
    const elMeta = $('#backupMeta');
    const restoreBtn = $('#backupRestoreBtn');
    if (!elMeta && !restoreBtn) return;

    const list = loadBackups();
    const latest = list[0];
    if (!latest) {
      if (elMeta) elMeta.textContent = 'Резервных копий ещё нет';
      if (restoreBtn) restoreBtn.disabled = true;
      return;
    }

    const label = formatDateTime(latest.ts);
    if (elMeta) elMeta.textContent = `Последняя копия: ${label} · всего: ${list.length}`;
    if (restoreBtn) restoreBtn.disabled = false;
  }

  function createManualBackup() {
    try {
      addBackup(JSON.parse(JSON.stringify(data)));
      renderBackupMeta();
      toast('Резервная копия создана');
    } catch {
      toast('Не удалось создать резервную копию');
    }
  }

  function restoreLatestBackup() {
    const list = loadBackups();
    const latest = list[0];
    if (!latest?.data) {
      toast('Нет резервной копии');
      return;
    }
    const ok = confirm('Восстановить данные из последней резервной копии? Текущие данные будут заменены.');
    if (!ok) return;

    try {
      data = migrateData(latest.data);
      persistDataNow();
      renderBackupMeta();
      render();
      toast('Восстановлено из резервной копии');
    } catch {
      toast('Не удалось восстановить резервную копию');
    }
  }


  // ---------- Settings UI ----------
  function renderSettingsMeta() {
    const vbtn = $('#appVersionBtn') || $('#appVersion');
    if (vbtn) {
      vbtn.textContent = VERSION_LABEL;
      vbtn.title = 'О приложении';
    }
    renderShiftStats();
    renderBackupMeta();
  }

  function initSettingsUI() {
    // Data tools
    const exportBtn = $('#exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportData);

    const importBtn = $('#importBtn');
    const importFile = $('#importFile');
    if (importBtn && importFile) importBtn.addEventListener('click', () => importFile.click());
    if (importFile) importFile.addEventListener('change', importDataFromFile);
    // Manual backup
    const backupCreateBtn = $('#backupCreateBtn');
    if (backupCreateBtn) backupCreateBtn.addEventListener('click', createManualBackup);

    const backupRestoreBtn = $('#backupRestoreBtn');
    if (backupRestoreBtn) backupRestoreBtn.addEventListener('click', restoreLatestBackup);


    // Shift tools
    const exportShiftBtn = $('#exportShiftBtn');
    if (exportShiftBtn) exportShiftBtn.addEventListener('click', exportCurrentShift);

    const closeShiftBtn = $('#closeShiftBtn');
    if (closeShiftBtn) closeShiftBtn.addEventListener('click', closeShift);

    // About
    const vbtn = $('#appVersionBtn');
    if (vbtn) vbtn.addEventListener('click', openAboutSheet);
  }

  // ---------- Lists click handling ----------
  function handleListClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const scope = btn.dataset.scope;
    const id = btn.dataset.id;
    if (!id) return;

    if (action === 'edit') {
      if (scope === 'request') openRequestModal(id);
      if (scope === 'delivered') openDeliveredModal(id);
      if (scope === 'assist') openAssistModal(id);
    } else if (action === 'delete') {
      const ok = confirm('Удалить запись?');
      if (!ok) return;
      deleteItem(scope, id);
    } else if (action === 'stamp') {
      stampTime(id, btn.dataset.stamp);
    } else if (action === 'finish') {
      finishRequest(id);
    }
  }

  $('#requestsList').addEventListener('click', handleListClick);
  $('#deliveredList').addEventListener('click', handleListClick);
  $('#assistsList')?.addEventListener('click', handleListClick);
  

  // ---------- Search ----------
  function initSearch() {
    $('#requestSearch').addEventListener('input', (e) => {
      requestQuery = e.target.value || '';
      render();
    });
    $('#deliveredSearch').addEventListener('input', (e) => {
      deliveredQuery = e.target.value || '';
      render();
    });
    $('#assistSearch')?.addEventListener('input', (e) => {
      assistQuery = e.target.value || '';
      render();
    });
  }

  // ---------- Service worker ----------
  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // In WebView wrappers (Capacitor) SW can be disabled depending on scheme.
    // Register only in typical web contexts.
    const isHttp = location.protocol === 'https:' || location.protocol === 'http:';
    if (!isHttp && location.hostname !== 'localhost') return;

    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  async function updatePwaStatus() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        $('#pwaStatus').textContent = 'Service Worker: не установлен';
        return;
      }
      $('#pwaStatus').textContent = reg.active ? 'Офлайн-кэш: активен' : 'Офлайн-кэш: устанавливается…';
    } catch {
      $('#pwaStatus').textContent = 'Офлайн-кэш: неизвестно';
    }
  }

  // ---------- Bind buttons / nav ----------
  function initNav() {
    document.querySelectorAll('[data-screen]').forEach((btn) => {
      btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
    });
  }

  function initActions() {
    $('#addRequestBtn').addEventListener('click', () => openRequestModal(null));
    $('#addDeliveredBtn').addEventListener('click', () => openDeliveredModal(null));
    $('#addAssistBtn')?.addEventListener('click', () => openAssistModal(null));

    // other one-off buttons can be bound here
  }

  // ==============================
  // Dispatch (single save/render pathway)
  // ==============================
  function dispatch(mutator, opts = { data: true, settings: false }) {
    if (typeof mutator === 'function') mutator();

    if (opts.data) scheduleSaveData();
    if (opts.settings) scheduleSaveSettings();

    render();
  }

  // ---------- Disable pinch zoom (extra for iOS) ----------
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());
  document.addEventListener('gestureend', (e) => e.preventDefault());

  // ---------- Render root ----------
  function render() {
    applyCompact();
    setSearchUI();
    renderRequests();
    renderDelivered();
    renderAssists();
    renderSettingsMeta();
  }

  // ---------- Init ----------
  applyCompact();
  initNav();
  initActions();
  initSearch();
  initSettingsUI();
  initAboutSheetUI();
  initServiceWorker();

  // iOS PWA (added-to-home-screen) may restore the app from a snapshot / bfcache.
  // In that case the DOM can appear without a fresh paint until the next interaction.
  // Re-render on show/focus to ensure empty-states and lists are visible immediately.
  window.addEventListener('pageshow', () => render(), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  }, { passive: true });

  switchScreen(currentScreen);
  // Hide splash after first paint AND after minimal delay.
  markAppReady();
})();