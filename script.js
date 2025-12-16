(() => {
  'use strict';

  // ---------- Constants ----------
  const APP_VERSION = '3.1.0-stage3-assists';
  const DATA_KEY = 'shift_manager_data_v2';
  const SETTINGS_KEY = 'shift_manager_settings_v2';

  // ---------- Helpers ----------
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

  function nowHHMM() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function toast(msg) {
    // очень лёгкий toast без зависимостей
    const t = el('div', { class: 'toast', text: msg });
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 1600);
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

  function loadData() {
    try {
      const raw = JSON.parse(localStorage.getItem(DATA_KEY));
      const base = defaultData();
      if (!raw) return base;
      // миграция v1 -> v2
      if (!raw.v) {
        return { v: 2, requests: raw.requests || [], delivered: raw.delivered || [], assists: [], shifts: [] };
      }
      return { ...base, ...raw, shifts: Array.isArray(raw.shifts) ? raw.shifts : [] };
    } catch {
      return defaultData();
    }
  }

  function saveData() {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  }

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

      s.ui.startScreen = s.ui.startScreen || 'shift';
      s.ui.compact = !!s.ui.compact;
      s.ui.requestFields = { ...base.ui.requestFields, ...(s.ui.requestFields || {}) };
      s.ui.deliveredFields = { ...base.ui.deliveredFields, ...(s.ui.deliveredFields || {}) };

      return s;
    } catch {
      return defaultSettings();
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function applyCompact() {
    document.body.classList.toggle('compact', !!settings.ui.compact);
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
  let currentScreen = settings.ui.startScreen || 'shift';

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

  // ---------- Modal ----------
  let editContext = null; // {scope:'request'|'delivered', index:number}

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
    });

    // submit
    const submitHandler = (ev) => {
      ev.preventDefault();
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

  // ---------- Field config ----------
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

  // ---------- CRUD / Modals ----------
  function openRequestModal(index = null) {
    const isEdit = typeof index === 'number';
    const r = isEdit ? data.requests[index] : null;

    editContext = isEdit ? { scope: 'request', index } : { scope: 'request', index: null };

    const init = isEdit ? { ...r } : {};

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
        const obj = {
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
          createdAt: isEdit ? (r.createdAt || Date.now()) : Date.now()
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

        if (isEdit) data.requests[index] = obj;
        else data.requests.unshift(obj);

        saveData();
        render();
      }
    });
  }

  function openDeliveredModal(index = null) {
    const isEdit = typeof index === 'number';
    const d = isEdit ? data.delivered[index] : null;

    editContext = isEdit ? { scope: 'delivered', index } : { scope: 'delivered', index: null };

    const init = isEdit ? { ...d } : { time: nowHHMM() };

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
        const obj = {
          name: (o.name || '').toString().trim(),
          time: (o.time || '').toString().trim(),
          reason: (o.reason || '').toString().trim(),
          updatedAt: Date.now(),
          createdAt: isEdit ? (d.createdAt || Date.now()) : Date.now()
        };
        if (!obj.name) {
          toast('ФИО обязательно');
          return;
        }
        if (obj.reason) pushDict('reason', obj.reason);

        if (isEdit) data.delivered[index] = obj;
        else data.delivered.unshift(obj);

        saveData();
        render();
      }
    });
  }

  function deleteItem(scope, index) {
    if (scope === 'request') data.requests.splice(index, 1);
    if (scope === 'delivered') data.delivered.splice(index, 1);
    if (scope === 'assist') data.assists.splice(index, 1);
    saveData();
    render();
  }

  // ---------- Assists (Содействия) ----------
  function parseHHMM(s) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((s ?? '').toString().trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function formatMinutes(mins) {
    const m = Math.max(0, Math.round(mins));
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function assistDurationMinutes(start, end) {
    const s = parseHHMM(start);
    const e = parseHHMM(end);
    if (s === null || e === null) return null;
    return e >= s ? e - s : (24 * 60 - s) + e; // переход через полночь
  }

  function openAssistModal(index) {
    const isEdit = typeof index === 'number' && index >= 0;
    const a = isEdit ? (data.assists[index] || {}) : {};

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

        const mins = assistDurationMinutes(start, end);
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

        if (isEdit) data.assists[index] = obj;
        else data.assists.unshift(obj);

        saveData();
        render();
      }
    });
  }

  // ---------- Quick actions ----------
  function stampTime(index, key) {
    const r = data.requests[index];
    if (!r) return;
    if (!r[key]) r[key] = nowHHMM();
    r.updatedAt = Date.now();
    saveData();
    render();
  }

  function finishRequest(index) {
    const r = data.requests[index];
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

    saveData();
    render();
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
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (!q) return true;
        const hay = `${r.num || ''} ${r.type || ''} ${r.kusp || ''} ${r.addr || ''} ${r.desc || ''} ${r.result || ''}`.toLowerCase();
        return hay.includes(q);
      });

    items.forEach(({ r, i }) => {
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
          el('button', { type: 'button', dataset: { action: 'stamp', stamp: 't1', scope: 'request', index: String(i) }, text: 'Выехал' }),
          el('button', { type: 'button', dataset: { action: 'stamp', stamp: 't2', scope: 'request', index: String(i) }, text: 'Прибыл' }),
          el('button', { type: 'button', dataset: { action: 'finish', scope: 'request', index: String(i) }, text: 'Завершил' })
        ]),

        el('div', { class: 'card-actions' }, [
          el('button', { class: 'edit', type: 'button', dataset: { action: 'edit', scope: 'request', index: String(i) }, text: 'Изменить' }),
          el('button', { class: 'delete', type: 'button', dataset: { action: 'delete', scope: 'request', index: String(i) }, text: 'Удалить' })
        ])
      ]);

      root.appendChild(card);
    });
  }

  function renderDelivered() {
    const root = $('#deliveredList');
    root.innerHTML = '';

    const q = deliveredQuery.trim().toLowerCase();
    const show = settings.ui.deliveredFields;

    const items = data.delivered
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => {
        if (!q) return true;
        const hay = `${d.name || ''} ${d.time || ''} ${d.reason || ''}`.toLowerCase();
        return hay.includes(q);
      });

    items.forEach(({ d, i }) => {
      const title = (show.fio ? (d.name || '').trim() : '') || 'Доставленные';

      const details = [];
      if (show.time) details.push(['Время', d.time]);
      if (show.reason) details.push(['Основание', d.reason]);

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
          el('button', { class: 'edit', type: 'button', dataset: { action: 'edit', scope: 'delivered', index: String(i) }, text: 'Изменить' }),
          el('button', { class: 'delete', type: 'button', dataset: { action: 'delete', scope: 'delivered', index: String(i) }, text: 'Удалить' })
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
    const show = settings.ui.assistFields || {};

    const items = (data.assists || [])
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => {
        if (!q) return true;
        const hay = `${a.service || ''} ${a.note || ''} ${a.start || ''} ${a.end || ''}`.toLowerCase();
        return hay.includes(q);
      });

    const totalMins = (data.assists || []).reduce((sum, a) => sum + (Number(a.minutes) || 0), 0);
    totalEl.textContent = `Итого за смену: ${formatMinutes(totalMins)}`;

    if (!items.length) {
      root.appendChild(el('div', { class: 'muted', text: 'Пока нет содействий' }));
      return;
    }

    items.forEach(({ a, i }) => {
      const details = [];
      if (show.service) details.push(['Служба', a.service]);
      if (show.note) details.push(['Заметка', a.note]);
      if (show.start || show.end) details.push(['Время', `${a.start || '—'} — ${a.end || '—'}`]);
      if (show.delta) details.push(['Δ', formatMinutes(Number(a.minutes) || assistDurationMinutes(a.start, a.end) || 0)]);

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
          el('button', { class: 'edit', type: 'button', dataset: { action: 'edit', scope: 'assist', index: String(i) }, text: 'Изменить' }),
          el('button', { class: 'delete', type: 'button', dataset: { action: 'delete', scope: 'assist', index: String(i) }, text: 'Удалить' })
        ])
      ]);

      root.appendChild(card);
    });
  }

  // ---------- Shift stats + archive (Stage 2) ----------
  function durationMinutes(t1, t3) {
    // ожидаем HH:MM
    if (!t1 || !t3) return null;
    const [h1, m1] = t1.split(':').map(Number);
    const [h3, m3] = t3.split(':').map(Number);
    if ([h1, m1, h3, m3].some((x) => Number.isNaN(x))) return null;
    return (h3 * 60 + m3) - (h1 * 60 + m1);
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
    saveData();
    render();
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
    download(`shiftmanager-backup-${Date.now()}.json`, JSON.stringify({ data, settings }, null, 2));
  }

  function exportCurrentShift() {
    download(`shiftmanager-shift-${Date.now()}.json`, JSON.stringify({ requests: data.requests, delivered: data.delivered, assists: data.assists }, null, 2));
  }

  async function importDataFromFile(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);

      if (obj.data) data = { ...defaultData(), ...obj.data };
      if (obj.settings) settings = { ...defaultSettings(), ...obj.settings };

      saveData();
      saveSettings();
      applyCompact();
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

  // ---------- Settings UI ----------
  function renderSettingsMeta() {
    $('#appVersion').textContent = `v${APP_VERSION}`;
    renderShiftStats();
    renderArchive();

    // checklist
    buildChecklist('reqFields', REQUEST_FIELD_META, settings.ui.requestFields, (k, v) => {
      settings.ui.requestFields[k] = v;
      saveSettings();
      render();
    });

    buildChecklist('delFields', DELIVERED_FIELD_META, settings.ui.deliveredFields, (k, v) => {
      settings.ui.deliveredFields[k] = v;
      saveSettings();
      render();
    });


    buildChecklist('assistFields', ASSIST_FIELD_META, settings.ui.assistFields, (k, v) => {
      settings.ui.assistFields[k] = v;
      saveSettings();
      render();
    });


    // compact
    const compactToggle = $('#compactToggle');
    if (compactToggle) {
      compactToggle.checked = !!settings.ui.compact;
    }

    const startSel = $('#startScreenSelect');
    if (startSel) startSel.value = settings.ui.startScreen || 'shift';
  }

  function initSettingsUI() {
    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', importDataFromFile);
    $('#clearBtn').addEventListener('click', clearAllData);

    $('#exportShiftBtn').addEventListener('click', exportCurrentShift);
    $('#closeShiftBtn').addEventListener('click', closeShift);

    $('#editTypesBtn').addEventListener('click', () => editDictionary('types', 'Справочник: типы'));
    $('#editResultsBtn').addEventListener('click', () => editDictionary('results', 'Справочник: результаты'));
    $('#editReasonsBtn').addEventListener('click', () => editDictionary('reasons', 'Справочник: основания'));
    $('#editServicesBtn').addEventListener('click', () => editDictionary('services', 'Справочник: службы'));

    $('#compactToggle').addEventListener('change', (e) => {
      settings.ui.compact = !!e.target.checked;
      saveSettings();
      applyCompact();
      render();
    });

    $('#startScreenSelect').addEventListener('change', (e) => {
      settings.ui.startScreen = e.target.value;
      saveSettings();
      toast('Сохранено');
    });

    // archive actions (delegation)
    $('#shiftArchive').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      const idx = Number(btn.dataset.index);
      if (Number.isNaN(idx)) return;

      if (action === 'exportShift') {
        const s = data.shifts[idx];
        if (!s) return;
        download(`shiftmanager-archive-${s.closedAt}.json`, JSON.stringify(s, null, 2));
      }
      if (action === 'deleteShift') {
        const ok = confirm('Удалить смену из архива?');
        if (!ok) return;
        data.shifts.splice(idx, 1);
        saveData();
        render();
      }
    });
  }

  // ---------- Lists click handling ----------
  function handleListClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    const scope = btn.dataset.scope;
    const index = Number(btn.dataset.index);

    if (Number.isNaN(index)) return;

    if (action === 'edit') {
      if (scope === 'request') openRequestModal(index);
      if (scope === 'delivered') openDeliveredModal(index);
      if (scope === 'assist') openAssistModal(index);
    } else if (action === 'delete') {
      const ok = confirm('Удалить запись?');
      if (!ok) return;
      deleteItem(scope, index);
    } else if (action === 'stamp') {
      stampTime(index, btn.dataset.stamp);
    } else if (action === 'finish') {
      finishRequest(index);
    }
  }

  $('#requestsList').addEventListener('click', handleListClick);
  $('#deliveredList').addEventListener('click', handleListClick);
  $('#assistsList')?.addEventListener('click', handleListClick);
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
    if (!('serviceWorker' in navigator)) {
      $('#pwaStatus').textContent = 'Service Worker: недоступен';
      return;
    }

    navigator.serviceWorker
      .register('sw.js')
      .then(() => updatePwaStatus())
      .catch(() => ($('#pwaStatus').textContent = 'Service Worker: ошибка'));

    $('#updateCacheBtn').addEventListener('click', async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
      toast('Запрошено обновление кэша');
      updatePwaStatus();
    });
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
  initServiceWorker();
  switchScreen(currentScreen);
})();