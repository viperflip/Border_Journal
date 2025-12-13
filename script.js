(() => {
  'use strict';

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));

  const APP_VERSION = '1.1.0';
  const DATA_VERSION = 1;
  const DATA_KEY = 'shiftData';
  const SETTINGS_KEY = 'shiftSettings';

  const defaultData = () => ({ v: DATA_VERSION, requests: [], delivered: [] });
  const defaultSettings = () => ({ theme: 'system', haptics: true });

  let data = loadData();
  let settings = loadSettings();

  // ---------- Settings ----------
  function loadSettings(){
    try{
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return { ...defaultSettings(), ...(s || {}) };
    }catch{
      return defaultSettings();
    }
  }

  function saveSettings(){
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function applyTheme(){
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
  }

  function haptic(){
    if(!settings.haptics) return;
    if(navigator.vibrate) navigator.vibrate(10);
  }

  // ---------- Data ----------
  function loadData(){
    try{
      const raw = JSON.parse(localStorage.getItem(DATA_KEY));
      if(!raw) return defaultData();
      // migration point
      if(typeof raw.v !== 'number'){
        // older format: {requests, delivered}
        return { v: DATA_VERSION, requests: raw.requests || [], delivered: raw.delivered || [] };
      }
      return { ...defaultData(), ...raw };
    }catch{
      return defaultData();
    }
  }

  function saveData(){
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  }

  // ---------- Navigation ----------
  function switchScreen(name){
    haptic();
    $$('.screen').forEach(s => s.classList.remove('active'));
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    const screen = $('#screen-' + name);
    const btn = document.querySelector(`[data-screen="${name}"]`);
    if(screen) screen.classList.add('active');
    if(btn) btn.classList.add('active');
  }

  $$('.nav-btn').forEach(b => b.addEventListener('click', () => switchScreen(b.dataset.screen)));

  // ---------- Safe DOM helpers ----------
  function el(tag, props = {}, children = []){
    const node = document.createElement(tag);
    for(const [k,v] of Object.entries(props)){
      if(k === 'class') node.className = v;
      else if(k === 'dataset') Object.assign(node.dataset, v);
      else if(k === 'text') node.textContent = v ?? '';
      else if(k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for(const c of children){
      if(c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function fmt(...parts){
    return parts.filter(x => (x ?? '').toString().trim().length).join(' • ');
  }

  // ---------- Render ----------
  function render(){
    renderRequests();
    renderDelivered();
    renderSettingsMeta();
  }

  function renderRequests(){
    const root = $('#requestsList');
    root.innerHTML = '';
    data.requests.forEach((r, i) => {
      const title = `Заявка №${(r.num || '').trim()}`.trim();

      const chips = [];
      if (r.t1) chips.push(`Получ.: ${r.t1}`);
      if (r.t2) chips.push(`Приб.: ${r.t2}`);
      if (r.t3) chips.push(`Убыт.: ${r.t3}`);

      const details = [
        ['Тип', r.type],
        ['КУСП', r.kusp],
        ['Адрес', r.addr],
        ['Описание', r.desc],
        ['Результат', r.result],
      ].filter(([,v]) => (v ?? '').toString().trim().length > 0);

      const card = el('div', { class:'card', role:'listitem' }, [
        el('div', { class:'card-title', text: title }),
        details.length
          ? el('div', { class:'card-details' }, details.map(([k,v]) =>
              el('div', { class:'kv' }, [
                el('div', { class:'k', text:k }),
                el('div', { class:'v', text:String(v).trim() })
              ])
            ))
          : el('div', { class:'card-meta', text:'Нет данных' }),
        chips.length
          ? el('div', { class:'chips' }, chips.map(t => el('span', { class:'chip', text:t })))
          : null,
        el('div', { class:'card-actions' }, [
          el('button', { class:'edit', type:'button', dataset:{ scope:'request', action:'edit', index:String(i) }, text:'Изменить' }),
          el('button', { class:'delete', type:'button', dataset:{ scope:'request', action:'delete', index:String(i) }, text:'Удалить' })
        ])
      ].filter(Boolean));

      root.appendChild(card);
    });
  }

  function renderDelivered(){
    const root = $('#deliveredList');
    root.innerHTML = '';
    data.delivered.forEach((d, i) => {
      const title = (d.name || '').trim() || 'Доставление';
      const details = [
        ['Время', d.time],
        ['Основание', d.reason],
      ].filter(([,v]) => (v ?? '').toString().trim().length > 0);

      const card = el('div', { class:'card', role:'listitem' }, [
        el('div', { class:'card-title', text: title }),
        details.length
          ? el('div', { class:'card-details' }, details.map(([k,v]) =>
              el('div', { class:'kv' }, [
                el('div', { class:'k', text:k }),
                el('div', { class:'v', text:String(v).trim() })
              ])
            ))
          : el('div', { class:'card-meta', text:'Нет данных' }),
        el('div', { class:'card-actions' }, [
          el('button', { class:'edit', type:'button', dataset:{ scope:'delivered', action:'edit', index:String(i) }, text:'Изменить' }),
          el('button', { class:'delete', type:'button', dataset:{ scope:'delivered', action:'delete', index:String(i) }, text:'Удалить' })
        ])
      ]);
      root.appendChild(card);
    });
  }

  // Event delegation for lists
  function handleListClick(e){
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    // Cards use data-scope; keep backward compatibility with older builds that used data-kind.
    const kind = btn.dataset.scope || btn.dataset.kind;
    const action = btn.dataset.action;
    const index = Number(btn.dataset.index);
    if(Number.isNaN(index)) return;

    if(action === 'delete'){
      haptic();
      if(!confirm('Удалить запись?')) return;
      if(kind === 'request') data.requests.splice(index, 1);
      else data.delivered.splice(index, 1);
      saveData(); render();
      return;
    }

    if(action === 'edit'){
      if(kind === 'request') openRequestModal(index);
      else openDeliveredModal(index);
    }
  }

  $('#requestsList').addEventListener('click', handleListClick);
  $('#deliveredList').addEventListener('click', handleListClick);

  // ---------- Modal (dynamic form with prefilling + validation) ----------
  let editContext = null;

  function openModal({ title, fields, initialValues = {}, onSubmit }){
    haptic();
    $('#modalTitle').textContent = title;
    const form = $('#modalForm');
    form.innerHTML = '';

    fields.forEach(f => {
      form.appendChild(el('label', { text: f.label }));
      let input;
      const common = { name: f.name };
      if(f.required) common.required = 'required';

      const value = (initialValues[f.name] ?? '').toString();

      if(f.type === 'select'){
        input = el('select', common, (f.options || []).map(opt => el('option', { value: opt, text: opt })));
        input.value = value || (f.options?.[0] ?? '');
      }else if(f.type === 'textarea'){
        input = el('textarea', common);
        input.value = value;
      }else{
        input = el('input', { ...common, type: f.type || 'text', inputmode: f.inputmode || undefined, placeholder: f.placeholder || undefined });
        input.value = value;
        if(f.pattern) input.setAttribute('pattern', f.pattern);
      }

      form.appendChild(input);
    });

    form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const obj = Object.fromEntries(fd.entries());

      const err = validate(fields, obj);
      if(err){
        alert(err);
        return;
      }

      onSubmit(obj);
      closeModal();
    };

    $('#modal').classList.remove('hidden');
  }

  function closeModal(){
    $('#modal').classList.add('hidden');
    $('#modalForm').onsubmit = null;
    editContext = null;
  }

  $('#cancelModal').addEventListener('click', closeModal);

  function validate(fields, obj){
    for(const f of fields){
      if(f.required){
        const v = (obj[f.name] ?? '').toString().trim();
        if(!v) return `Поле «${f.label}» обязательно.`;
      }
      if(f.name === 'num'){
        const v = (obj.num ?? '').toString().trim();
        if(v && !/^[0-9]+$/.test(v)) return 'Номер заявки должен содержать только цифры.';
      }
    }
    return '';
  }

  function openRequestModal(index = null){
    editContext = index;
    const isEdit = index !== null;
    const initial = isEdit ? (data.requests[index] || {}) : {};
    const fields = [
      { label:'Номер заявки', name:'num', required:true, type:'text', inputmode:'numeric', pattern:'[0-9]+' },
      { label:'Тип', name:'type', type:'select', options:['Адрес','Улица'] },
      { label:'Время получения', name:'t1', type:'time' },
      { label:'Время прибытия', name:'t2', type:'time' },
      { label:'Время убытия', name:'t3', type:'time' },
      { label:'КУСП', name:'kusp', type:'text', inputmode:'numeric' },
      { label:'Адрес', name:'addr', type:'text' },
      { label:'Описание', name:'desc', type:'textarea' },
      { label:'Результат', name:'result', type:'text' }
    ];

    openModal({
      title: isEdit ? 'Изменить заявку' : 'Новая заявка',
      fields,
      initialValues: initial,
      onSubmit: (o) => {
        // Normalize
        o.num = (o.num || '').trim();
        if(editContext !== null) data.requests[editContext] = o;
        else data.requests.push(o);
        saveData(); render();
      }
    });
  }

  function openDeliveredModal(index = null){
    editContext = index;
    const isEdit = index !== null;
    const initial = isEdit ? (data.delivered[index] || {}) : {};
    const fields = [
      { label:'ФИО', name:'name', required:true, type:'text' },
      { label:'Время доставления', name:'time', type:'time' },
      { label:'Основание', name:'reason', type:'text' }
    ];

    openModal({
      title: isEdit ? 'Изменить доставление' : 'Доставленный',
      fields,
      initialValues: initial,
      onSubmit: (o) => {
        o.name = (o.name || '').trim();
        if(editContext !== null) data.delivered[editContext] = o;
        else data.delivered.push(o);
        saveData(); render();
      }
    });
  }

  $('#addRequestBtn').addEventListener('click', () => openRequestModal(null));
  $('#addDeliveredBtn').addEventListener('click', () => openDeliveredModal(null));

  // ---------- Settings UI ----------
  function renderSettingsMeta(){
    $('#appVersion').textContent = `v${APP_VERSION}`;
  }

  function initSettingsUI(){
    const themeSelect = $('#themeSelect');
    const hapticsToggle = $('#hapticsToggle');

    themeSelect.value = settings.theme;
    hapticsToggle.checked = !!settings.haptics;

    themeSelect.addEventListener('change', () => {
      settings.theme = themeSelect.value;
      saveSettings();
      applyTheme();
    });

    hapticsToggle.addEventListener('change', () => {
      settings.haptics = hapticsToggle.checked;
      saveSettings();
    });

    $('#exportBtn').addEventListener('click', exportData);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', importDataFromFile);
    $('#clearBtn').addEventListener('click', clearAllData);
    $('#updateCacheBtn').addEventListener('click', updateServiceWorker);
  }

  function exportData(){
    haptic();
    const payload = {
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      data
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shift-data-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function importDataFromFile(e){
    const file = e.target.files?.[0];
    e.target.value = '';
    if(!file) return;
    try{
      const text = await file.text();
      const payload = JSON.parse(text);

      const incoming = payload?.data ?? payload; // allow raw data import
      const migrated = (() => {
        if(typeof incoming?.v !== 'number'){
          return { v: DATA_VERSION, requests: incoming.requests || [], delivered: incoming.delivered || [] };
        }
        return { ...defaultData(), ...incoming };
      })();

      if(!confirm('Импорт перезапишет текущие данные. Продолжить?')) return;
      data = migrated;
      saveData();
      render();
      alert('Импорт выполнен.');
    }catch{
      alert('Не удалось импортировать: файл повреждён или имеет неверный формат.');
    }
  }

  function clearAllData(){
    haptic();
    if(!confirm('Точно очистить ВСЕ данные смены и доставленных?')) return;
    data = defaultData();
    saveData();
    render();
  }

  // ---------- Service Worker ----------
  function setPwaStatus(text){
    const el = $('#pwaStatus');
    if(el) el.textContent = text;
  }

  async function updateServiceWorker(){
    haptic();
    if(!('serviceWorker' in navigator)){
      setPwaStatus('Офлайн-кэш: не поддерживается браузером');
      return;
    }
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg){
        await reg.update();
        setPwaStatus('Офлайн-кэш: обновление запрошено');
      }else{
        setPwaStatus('Офлайн-кэш: ещё не установлен');
      }
    }catch{
      setPwaStatus('Офлайн-кэш: ошибка обновления');
    }
  }

  async function initServiceWorker(){
    if(!('serviceWorker' in navigator)){
      setPwaStatus('Офлайн-кэш: не поддерживается браузером');
      return;
    }
    try{
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      setPwaStatus(reg.active ? 'Офлайн-кэш: активен' : 'Офлайн-кэш: устанавливается');
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setPwaStatus('Офлайн-кэш: обновлён');
      });
    }catch{
      setPwaStatus('Офлайн-кэш: не удалось включить');
    }
  }

  // ---------- Init ----------
  applyTheme();
  initSettingsUI();
  initServiceWorker();
  render();
})();