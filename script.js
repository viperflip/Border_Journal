// Глобальные переменные
let currentShift = {
    id: null,
    name: '',
    startTime: null,
    entries: [],
    autoSaved: false
};

let shiftHistory = [];
let editingRow = null;
let autoSaveInterval = null;
let currentSearchTerm = '';
let currentFilterType = '';
let currentColorScheme = '#651D1C';
let isDarkTheme = false;

let deliveredPeople = [];
let editingDelivered = null;

// Инициализация приложения
async function initApp() {
    loadTheme();

    // Инициализируем PWA
    initPWA();

    // Инициализируем IndexedDB
    const dbReady = await initIndexedDB();
    if (!dbReady) {
        console.log('Используем localStorage как fallback');
    }

    // Загружаем данные (теперь из IndexedDB или localStorage)
    loadData();
    setupEventListeners();
    renderAll();
    startAutoSave();
    initColorOptions();

    // Показываем статус оффлайн/онлайн
    if (!navigator.onLine) {
        showNotification('Работаем в оффлайн-режиме', 'info');
    }
}

// ===== PWA ИНИЦИАЛИЗАЦИЯ =====
function initPWA() {
    // Регистрация Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => {
                    console.log('ServiceWorker зарегистрирован:', registration.scope);

                    // Проверка обновлений
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        console.log('Найдено обновление Service Worker');

                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    // Новый контент доступен
                                    showNotification('Доступно обновление! Перезагрузите страницу.', 'info');
                                }
                            }
                        });
                    });
                })
                .catch(error => {
                    console.error('Ошибка регистрации Service Worker:', error);
                });
        });

        // Отслеживание состояния сети
        window.addEventListener('online', () => {
            showNotification('Соединение восстановлено', 'success');
        });

        window.addEventListener('offline', () => {
            showNotification('Работаем оффлайн', 'warning');
        });
    }

    // Запрос разрешения на уведомления (опционально)
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Добавляем кнопку установки PWA (для некоторых браузеров)
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Можно показать свою кнопку установки
        setTimeout(() => {
            if (deferredPrompt && confirm('Установить приложение на устройство?')) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        showNotification('Приложение установлено!', 'success');
                    }
                    deferredPrompt = null;
                });
            }
        }, 3000);
    });
}

// ===== INDEXEDDB РЕАЛИЗАЦИЯ =====
let db;

function initIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            console.warn('IndexedDB не поддерживается');
            resolve(false);
            return;
        }

        const request = indexedDB.open('JournalDB', 2);

        request.onerror = (event) => {
            console.error('Ошибка открытия IndexedDB:', event.target.error);
            resolve(false);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB успешно открыта');
            resolve(true);

            // Проверяем, есть ли данные в localStorage
            migrateFromLocalStorage();
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Создаём хранилище для текущей смены
            if (!db.objectStoreNames.contains('currentShift')) {
                const currentShiftStore = db.createObjectStore('currentShift', { keyPath: 'id' });
                currentShiftStore.createIndex('by_date', 'startTime');
            }

            // Создаём хранилище для истории смен
            if (!db.objectStoreNames.contains('shiftHistory')) {
                const historyStore = db.createObjectStore('shiftHistory', { keyPath: 'id' });
                historyStore.createIndex('by_date', 'endTime');
                historyStore.createIndex('by_name', 'name');
            }

            // Создаём хранилище для доставленных
            if (!db.objectStoreNames.contains('deliveredPeople')) {
                const deliveredStore = db.createObjectStore('deliveredPeople', { keyPath: 'id' });
                deliveredStore.createIndex('by_shift', 'shiftId');
                deliveredStore.createIndex('by_name', 'fullName');
            }

            console.log('Структура IndexedDB создана');
        };
    });
}

// Миграция данных из localStorage в IndexedDB
function migrateFromLocalStorage() {
    const savedCurrentShift = localStorage.getItem('currentShift');
    const savedHistory = localStorage.getItem('shiftHistory');
    const savedDelivered = localStorage.getItem('deliveredPeople');

    if (savedCurrentShift || savedHistory || savedDelivered) {
        console.log('Начинаем миграцию данных из localStorage...');

        const transaction = db.transaction(['currentShift', 'shiftHistory', 'deliveredPeople'], 'readwrite');

        if (savedCurrentShift) {
            try {
                const data = JSON.parse(savedCurrentShift);
                transaction.objectStore('currentShift').put(data);
                localStorage.removeItem('currentShift');
            } catch (e) { }
        }

        if (savedHistory) {
            try {
                const history = JSON.parse(savedHistory);
                history.forEach(shift => {
                    transaction.objectStore('shiftHistory').put(shift);
                });
                localStorage.removeItem('shiftHistory');
            } catch (e) { }
        }

        if (savedDelivered) {
            try {
                const delivered = JSON.parse(savedDelivered);
                delivered.forEach(person => {
                    transaction.objectStore('deliveredPeople').put(person);
                });
                localStorage.removeItem('deliveredPeople');
            } catch (e) { }
        }

        transaction.oncomplete = () => {
            console.log('Миграция данных завершена');
            showNotification('Данные перенесены в надежное хранилище', 'success');
        };
    }
}

// Загрузка данных из localStorage
async function loadData() {
    if (!db) {
        // Fallback на localStorage если IndexedDB не доступен
        loadFromLocalStorage();
        return;
    }

    try {
        // Загружаем текущую смену
        const currentShiftTx = db.transaction('currentShift', 'readonly');
        const currentShiftStore = currentShiftTx.objectStore('currentShift');
        const currentRequest = currentShiftStore.getAll();

        currentRequest.onsuccess = () => {
            if (currentRequest.result.length > 0) {
                currentShift = currentRequest.result[0];
            } else {
                createNewShift();
            }

            document.getElementById('mobileShiftName').value = currentShift.name;
            updateShiftStatus();

            // Загружаем историю
            const historyTx = db.transaction('shiftHistory', 'readonly');
            const historyStore = historyTx.objectStore('shiftHistory');
            const historyRequest = historyStore.getAll();

            historyRequest.onsuccess = () => {
                shiftHistory = historyRequest.result.sort((a, b) => b.endTime - a.endTime);

                // Загружаем доставленных
                const deliveredTx = db.transaction('deliveredPeople', 'readonly');
                const deliveredStore = deliveredTx.objectStore('deliveredPeople');
                const deliveredRequest = deliveredStore.getAll();

                deliveredRequest.onsuccess = () => {
                    deliveredPeople = deliveredRequest.result.sort((a, b) => b.createdAt - a.createdAt);

                    // Обновляем интерфейс
                    renderAll();
                    showNotification('Данные загружены', 'success');
                };
            };
        };

    } catch (error) {
        console.error('Ошибка загрузки из IndexedDB:', error);
        loadFromLocalStorage();
    }
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Навигация
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });

    // FAB кнопка
    document.getElementById('fabButton').addEventListener('click', openAddForm);

    // Закрытие формы
    document.getElementById('closeSheet').addEventListener('click', closeForm);
    document.getElementById('sheetOverlay').addEventListener('click', closeForm);

    // Отправка формы
    document.getElementById('mobileForm').addEventListener('submit', handleFormSubmit);

    // Поиск
    document.getElementById('mobileSearch').addEventListener('input', debounce(() => {
        currentSearchTerm = document.getElementById('mobileSearch').value.toLowerCase();
        renderCards();
    }, 300));

    // Фильтры
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilterType = chip.dataset.filter || '';
            renderCards();
        });
    });

    // Название смены
    document.getElementById('mobileShiftName').addEventListener('input', debounce(function () {
        currentShift.name = this.value;
        currentShift.autoSaved = false;
        updateShiftStatus();
        saveCurrentShift();
    }, 500));

    // Поиск в истории
    document.getElementById('mobileHistorySearch').addEventListener('input', debounce(filterHistory, 300));

    // Поиск в доставленных
    document.getElementById('deliveredSearch').addEventListener('input', debounce(filterDelivered, 300));

    // Меню
    document.getElementById('menuToggle').addEventListener('click', openSettings);
    document.getElementById('mobileThemeToggle').addEventListener('click', toggleTheme);

    // Автодополнение времени
    setupTimeAutoComplete();

    // Предотвращение закрытия страницы при несохраненных данных
    window.addEventListener('beforeunload', (e) => {
        if (!currentShift.autoSaved && currentShift.entries.length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // Закрытие модальных окон при клике вне их
    window.addEventListener('click', (e) => {
        const clearModal = document.getElementById('clearModal');
        if (e.target === clearModal) {
            hideClearConfirmation();
        }
    });
}

function handleTouchCancel() {
    // Сбрасываем состояние свайпа при отмене касания
    swipeStartX = null;
    swipeStartY = null;
    if (swipedCard) {
        swipedCard.classList.remove('swiped');
        swipedCard.style.transform = 'translateX(0)';
        const actionButtons = swipedCard.querySelector('.card-actions');
        if (actionButtons) {
            actionButtons.style.right = '-150px';
        }
        swipedCard = null;
    }
}

// Переключение вкладок
function switchTab(tabName) {
    // Обновляем навигацию
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.tab === tabName) {
            item.classList.add('active');
        }
    });

    // Скрываем все вкладки
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // Показываем выбранную вкладку
    document.getElementById(`${tabName}-tab`).classList.add('active');

    if (tabName === 'history') {
        renderHistory();
    }
    // Обновляем статистику
    else if (tabName === 'delivered') {
        renderDeliveredList();
        updateDeliveredStats();
    }

}

// Открытие формы добавления
function openAddForm() {
    document.getElementById('bottomSheet').classList.add('active');
    document.getElementById('sheetOverlay').classList.add('active');
    document.body.classList.add('sheet-open');

    // Сбрасываем форму если не редактируем
    if (editingRow === null) {
        resetForm();
        document.getElementById('sheetTitle').textContent = 'Новая заявка';
        document.getElementById('submitBtn').textContent = 'Добавить заявку';
        document.getElementById('cancelEditBtn').style.display = 'none';

        // Устанавливаем следующий ID
        let nextId = getNextId();
        document.getElementById('mobileNum').value = nextId;

        // Фокус на первое поле
        setTimeout(() => {
            document.getElementById('mobileTime1').focus();
        }, 300);
    }
}

// Закрытие формы
function closeForm() {
    document.getElementById('bottomSheet').classList.remove('active');
    document.getElementById('sheetOverlay').classList.remove('active');
    document.body.classList.remove('sheet-open');

    // Сбрасываем редактирование
    if (editingRow !== null) {
        cancelMobileEdit();
    }
}

// Сброс формы
function resetForm() {
    document.getElementById('mobileNum').value = '';
    document.getElementById('mobileType').value = 'А';
    document.getElementById('mobileTime1').value = '';
    document.getElementById('mobileTime2').value = '';
    document.getElementById('mobileTime3').value = '';
    document.getElementById('mobileKusp').value = '';
    document.getElementById('mobileDesc').value = '';
    document.getElementById('mobileAddr').value = '';
    document.getElementById('mobileResult').value = '';
}

// Обработка отправки формы
function handleFormSubmit(e) {
    e.preventDefault();

    // Валидация обязательных полей
    const numValue = document.getElementById("mobileNum").value.trim();
    const time1 = document.getElementById("mobileTime1").value;
    const desc = document.getElementById("mobileDesc").value;
    const addr = document.getElementById("mobileAddr").value;

    if (!numValue || !time1 || !desc || !addr) {
        showNotification('Заполните обязательные поля', 'error');
        return;
    }

    // Валидация номера заявки
    const num = parseInt(numValue);
    if (isNaN(num) || num <= 0) {
        showNotification('Номер заявки должен быть положительным числом', 'error');
        return;
    }
    if (currentShift.entries.some((e, i) => e.id === num && i !== editingRow)) {
        showNotification('Заявка с таким номером уже существует', 'error');
        return;
    }

    // Валидация времени
    if (!validateTime(time1) ||
        !validateTime(document.getElementById("mobileTime2").value) ||
        !validateTime(document.getElementById("mobileTime3").value)) {
        showNotification('Проверьте правильность введенного времени. Формат: ЧЧ:ММ', 'error');
        return;
    }

    const data = {
        id: num,
        type: document.getElementById("mobileType").value,
        time1: time1,
        time2: document.getElementById("mobileTime2").value || '',
        time3: document.getElementById("mobileTime3").value || '',
        kusp: document.getElementById("mobileKusp").value || '',
        desc: desc,
        addr: addr,
        result: document.getElementById("mobileResult").value || ''
    };

    if (editingRow !== null) {
        // Редактирование существующей заявки
        currentShift.entries[editingRow] = data;
        editingRow = null;
        showNotification('Заявка обновлена', 'success');
    } else {
        // Добавление новой заявки
        currentShift.entries.push(data);
        showNotification('Заявка добавлена', 'success');
    }

    currentShift.autoSaved = false;
    closeForm();
    renderAll();
    saveCurrentShift();
    updateShiftStatus();
}

// Редактирование заявки
function editCard(index) {
    const data = currentShift.entries[index];

    document.getElementById('mobileNum').value = data.id;
    document.getElementById('mobileType').value = data.type;
    document.getElementById('mobileTime1').value = data.time1;
    document.getElementById('mobileTime2').value = data.time2;
    document.getElementById('mobileTime3').value = data.time3;
    document.getElementById('mobileKusp').value = data.kusp;
    document.getElementById('mobileDesc').value = data.desc;
    document.getElementById('mobileAddr').value = data.addr;
    document.getElementById('mobileResult').value = data.result;

    editingRow = index;
    document.getElementById('sheetTitle').textContent = 'Редактирование заявки';
    document.getElementById('submitBtn').textContent = 'Сохранить изменения';
    document.getElementById('cancelEditBtn').style.display = 'flex';

    openAddForm();
}

// Отмена редактирования
function cancelMobileEdit() {
    editingRow = null;
    document.getElementById('sheetTitle').textContent = 'Новая заявка';
    document.getElementById('submitBtn').textContent = 'Добавить заявку';
    document.getElementById('cancelEditBtn').style.display = 'none';
    resetForm();
    closeForm();
}

// Удаление заявки
function deleteCard(index) {
    showNotification('Заявка удалена', 'success');
    currentShift.entries.splice(index, 1);
    currentShift.autoSaved = false;
    renderAll();
    saveCurrentShift();
    updateShiftStatus();
}

// Рендер всех компонентов
function renderAll() {
    renderCards();
    updateStats();
    updateEmptyState();
    updateDeliveredStats();
}

// Рендер карточек
function renderCards() {
    const container = document.getElementById('cardsContainer');
    container.innerHTML = '';

    // Фильтрация данных
    let filteredEntries = currentShift.entries.filter(entry => {
        const matchesSearch = !currentSearchTerm ||
            Object.values(entry).some(value =>
                value && value.toString().toLowerCase().includes(currentSearchTerm)
            );
        const matchesType = !currentFilterType || entry.type === currentFilterType;
        return matchesSearch && matchesType;
    });

    // Сортировка по номеру
    filteredEntries.sort((a, b) => a.id - b.id);

    if (filteredEntries.length === 0 && !currentSearchTerm && !currentFilterType) {
        return;
    }

    filteredEntries.forEach((data, index) => {
        const originalIndex = currentShift.entries.findIndex(e => e.id === data.id);
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.index = originalIndex;

        // Подсветка при поиске
        const isHighlighted = currentSearchTerm &&
            Object.values(data).some(value =>
                value && value.toString().toLowerCase().includes(currentSearchTerm)
            );

        if (isHighlighted) {
            card.style.boxShadow = '0 0 0 2px rgba(255, 193, 7, 0.5)';
        }

        card.innerHTML = `
            <div class="card-header">
                <span class="card-number">№${data.id}</span>
                <span class="card-type ${data.type === 'А' ? 'address' : 'street'}">
                    ${data.type === 'А' ? 'Адрес' : 'Улица'}
                </span>
            </div>
            <div class="card-body">
                <div class="card-address">${data.addr || 'Нет адреса'}</div>
                <div class="card-description">${data.desc || 'Нет описания'}</div>
                <div class="card-times">
                    <div class="time-item">
                        <span class="time-label">Получено</span>
                        <span class="time-value">${data.time1 || '--:--'}</span>
                    </div>
                    <div class="time-item">
                        <span class="time-label">Прибыл</span>
                        <span class="time-value">${data.time2 || '--:--'}</span>
                    </div>
                    <div class="time-item">
                        <span class="time-label">Убыл</span>
                        <span class="time-value">${data.time3 || '--:--'}</span>
                    </div>
                </div>
            </div>
            <div class="card-footer">
                <span class="card-kusp">${data.kusp ? 'КУСП: ' + data.kusp : 'КУСП не указан'}</span>
                <span class="card-result" title="${data.result || ''}">${data.result || 'Без результата'}</span>
            </div>
            <div class="card-actions">
                <button class="card-action-btn edit" onclick="editCard(${originalIndex})">
                    <i class="fas fa-edit"></i>
                    Изменить
                </button>
                <button class="card-action-btn delete" onclick="deleteCard(${originalIndex})">
                    <i class="fas fa-trash"></i>
                    Удалить
                </button>
            </div>
        `;

        container.appendChild(card);
    });
}

// Обновление статистики
function updateStats() {
    const totalEntries = currentShift.entries.length;
    const addressType = currentShift.entries.filter(e => e.type === 'А').length;
    const streetType = currentShift.entries.filter(e => e.type === 'У').length;

    // Обновляем бейджи
    document.getElementById('totalBadge').textContent = totalEntries;
    document.getElementById('addressBadge').textContent = addressType;
    document.getElementById('streetBadge').textContent = streetType;

    // Обновляем статистику истории
    const totalShifts = shiftHistory.length;
    const totalHistoricalEntries = shiftHistory.reduce((sum, shift) => sum + shift.entries.length, 0);

    document.getElementById('totalShifts').textContent = totalShifts;
    document.getElementById('totalHistoryEntries').textContent = totalHistoricalEntries;
}

// Обновление статуса пустого состояния
function updateEmptyState() {
    const emptyState = document.getElementById('emptyState');
    const emptyHistory = document.getElementById('emptyHistory');

    if (currentShift.entries.length === 0 && !currentSearchTerm && !currentFilterType) {
        emptyState.classList.add('active');
    } else {
        emptyState.classList.remove('active');
    }

    if (shiftHistory.length === 0) {
        emptyHistory.classList.add('active');
    } else {
        emptyHistory.classList.remove('active');
    }
}

// Обновление статуса смены
function updateShiftStatus() {
    const status = document.getElementById('shiftStatus');
    if (currentShift.autoSaved) {
        status.innerHTML = '<i class="fas fa-circle" style="color: var(--success-color)"></i> Сохранено';
    } else {
        status.innerHTML = '<i class="fas fa-circle" style="color: var(--warning-color)"></i> Не сохранено';
    }
}

// Рендер истории
function renderHistory() {
    const historyList = document.getElementById('mobileHistoryList');
    const searchTerm = document.getElementById('mobileHistorySearch').value.toLowerCase();

    historyList.innerHTML = '';

    let filteredHistory = shiftHistory.filter(shift =>
        !searchTerm || shift.name.toLowerCase().includes(searchTerm)
    );

    if (filteredHistory.length === 0) {
        return;
    }

    filteredHistory.forEach((shift, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        const startDate = new Date(shift.startTime);
        const formattedDate = startDate.toLocaleDateString('ru-RU') + ' - ' +
            new Date(shift.endTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        historyItem.innerHTML = `
            <div class="history-item-header">
                <h3 class="history-item-name">${shift.name || 'Без названия'}</h3>
                <span class="history-item-count">${shift.entries.length}</span>
            </div>
            <div class="history-item-date">${formattedDate}</div>
            <div class="history-item-actions">
                <button class="history-btn view" onclick="viewShift(${index})">
                    <i class="fas fa-eye"></i>
                    Просмотр
                </button>
            </div>
        `;

        historyList.appendChild(historyItem);
    });

    updateStats();
}

// Просмотр смены из истории
function viewShift(index) {
    const shift = shiftHistory[index];
    let tableHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <h3 style="color: var(--primary-color); margin: 0 0 10px;">${shift.name}</h3>
            <p style="color: var(--text-secondary); margin: 0;">${new Date(shift.startTime).toLocaleString('ru-RU')}</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
                <tr style="background: var(--primary-color); color: white;">
                    <th style="padding: 8px; border: 1px solid var(--border-color);">№</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color);">Тип</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color);">Получено</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color);">Адрес</th>
                    <th style="padding: 8px; border: 1px solid var(--border-color);">Описание</th>
                </tr>
            </thead>
            <tbody>
    `;

    shift.entries.sort((a, b) => a.id - b.id).forEach(data => {
        tableHTML += `
            <tr>
                <td style="padding: 8px; border: 1px solid var(--border-color);">${data.id}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color);">${data.type}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color);">${data.time1}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color);">${data.addr}</td>
                <td style="padding: 8px; border: 1px solid var(--border-color);">${data.desc}</td>
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';

    // Открываем в новом окне для печати
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Смена: ${shift.name}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                @media print {
                    body { padding: 0; }
                    button { display: none; }
                }
            </style>
        </head>
        <body>
            ${tableHTML}
            <div style="margin-top: 20px; text-align: center;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Печать
                </button>
                <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">
                    Закрыть
                </button>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Фильтрация истории
function filterHistory() {
    renderHistory();
}

// Показать поиск
function showSearch() {
    document.getElementById('searchOverlay').classList.add('active');
    document.getElementById('mobileSearch').focus();
}

// Скрыть поиск
function hideSearch() {
    document.getElementById('searchOverlay').classList.remove('active');
    currentSearchTerm = '';
    document.getElementById('mobileSearch').value = '';
    renderCards();
}

// Очистить поиск
function clearMobileSearch() {
    document.getElementById('mobileSearch').value = '';
    currentSearchTerm = '';
    renderCards();
}

// Открыть настройки
function openSettings() {
    document.getElementById('settingsMenu').classList.add('active');
}

// Закрыть настройки
function closeSettings() {
    document.getElementById('settingsMenu').classList.remove('active');
}

// Загрузка темы
function loadTheme() {
    const savedTheme = localStorage.getItem('journalTheme') || 'light';
    const savedColor = localStorage.getItem('journalColor') || '#651D1C';

    isDarkTheme = savedTheme === 'dark';
    currentColorScheme = savedColor;

    setTheme(savedTheme, false);
    setColorScheme(savedColor, false);
    initColorOptions();
}

// Установка темы
function setTheme(themeName, save = true) {
    document.body.className = 'theme-' + themeName;
    isDarkTheme = themeName === 'dark';

    // Обновляем иконку
    const icon = document.querySelector('#mobileThemeToggle i');
    icon.className = isDarkTheme ? 'fas fa-sun' : 'fas fa-moon';

    if (save) {
        localStorage.setItem('journalTheme', themeName);
    }
}

// Переключение темы
function toggleTheme() {
    const newTheme = isDarkTheme ? 'light' : 'dark';
    setTheme(newTheme);
}

// Инициализация цветовых опций
function initColorOptions() {
    const colors = [
        '#651D1C', '#3F4AC4', '#3FA34D', '#7FB446',
        '#FBAF00', '#2F3269', '#8EA208', '#F49F0A',
        '#76955E', '#AFB884', '#23231F'
    ];

    const container = document.getElementById('colorOptions');
    if (!container) {
        console.error('Элемент colorOptions не найден в DOM');
        return;
    }

    container.innerHTML = '';

    colors.forEach(color => {
        const option = document.createElement('div');
        option.className = `color-option ${color === currentColorScheme ? 'active' : ''}`;
        option.style.backgroundColor = color;
        option.dataset.color = color;

        option.addEventListener('click', () => {
            document.querySelectorAll('.color-option').forEach(opt => {
                opt.classList.remove('active');
            });
            option.classList.add('active');
            setColorScheme(color);
        });

        container.appendChild(option);
    });

    console.log('Цветовые схемы инициализированы:', colors.length, 'цветов');
    console.log('initColorOptions вызвана');
    console.log('Текущий цвет схемы:', currentColorScheme);
    console.log('Контейнер:', document.getElementById('colorOptions'));
}

// Установка цветовой схемы
function setColorScheme(color, save = true) {
    currentColorScheme = color;

    // Устанавливаем CSS переменные
    document.documentElement.style.setProperty('--primary-color', color);

    // Генерация светлых и темных вариантов
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    // Для светлой темы
    const lightColor = `rgb(${Math.min(r + 60, 255)}, ${Math.min(g + 60, 255)}, ${Math.min(b + 60, 255)})`;
    // Для темной темы - делаем цвет светлее, а не темнее
    const darkColor = `rgb(${Math.min(r + 40, 255)}, ${Math.min(g + 40, 255)}, ${Math.min(b + 40, 255)})`;

    document.documentElement.style.setProperty('--primary-light', lightColor);
    document.documentElement.style.setProperty('--primary-dark', darkColor);
    document.documentElement.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);

    // Обновляем активный цвет в настройках
    updateActiveColorOption(color);

    if (save) {
        localStorage.setItem('journalColor', color);
    }
}

// Функция обновления активного цвета в настройках
function updateActiveColorOption(color) {
    const colorOptions = document.querySelectorAll('.color-option');
    colorOptions.forEach(option => {
        option.classList.remove('active');
        if (option.dataset.color === color) {
            option.classList.add('active');
        }
    });
}

// Показать уведомление
function showNotification(message, type = 'success') {
    const notification = document.getElementById('mobileNotification');
    const text = document.getElementById('notificationText');

    text.textContent = message;
    notification.className = `mobile-notification show ${type}`;

    // Обновляем иконку
    const icon = notification.querySelector('i');
    switch (type) {
        case 'success':
            icon.className = 'fas fa-check-circle';
            break;
        case 'error':
            icon.className = 'fas fa-exclamation-circle';
            break;
        case 'warning':
            icon.className = 'fas fa-exclamation-triangle';
            break;
        case 'info':
            icon.className = 'fas fa-info-circle';
            break;
    }

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// ===== ОСНОВНЫЕ ФУНКЦИИ =====

function debounce(func, delay) {
    let timer;
    return function () {
        const context = this;
        const args = arguments;
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(context, args), delay);
    };
}

function getNextId() {
    if (currentShift.entries.length === 0) return 1;
    return Math.max(...currentShift.entries.map(e => e.id)) + 1;
}

function saveCurrentShift() {
    if (!db) {
        saveToLocalStorage();
        return;
    }

    try {
        const transaction = db.transaction('currentShift', 'readwrite');
        const store = transaction.objectStore('currentShift');

        currentShift.autoSaved = true;
        currentShift.lastSaved = new Date().toISOString();

        store.put(currentShift);

        transaction.oncomplete = () => {
            updateShiftStatus();
        };

        transaction.onerror = (error) => {
            console.error('Ошибка сохранения смены:', error);
            showNotification('Ошибка сохранения', 'error');
        };

    } catch (error) {
        console.error('Ошибка IndexedDB:', error);
        saveToLocalStorage();
    }
}

function saveShiftHistory() {
    if (!db) {
        saveHistoryToLocalStorage();
        return;
    }

    const transaction = db.transaction('shiftHistory', 'readwrite');
    const store = transaction.objectStore('shiftHistory');

    shiftHistory.forEach(shift => {
        store.put(shift);
    });
}

function finishShift() {
    const shiftName = document.getElementById('mobileShiftName').value.trim() || 'Без имени';

    if (currentShift.entries.length === 0) {
        if (!confirm('В смене нет заявок. Завершить смену?')) {
            return;
        }
    }

    const finishedShift = {
        id: Date.now(),
        name: shiftName,
        startTime: currentShift.startTime,
        endTime: new Date().toISOString(),
        entries: [...currentShift.entries]
    };

    shiftHistory.unshift(finishedShift);
    saveShiftHistory();

    createNewShift();
    showNotification(`Смена "${shiftName}" сохранена в историю`, 'success');
    switchTab('history');
}

function createNewShift() {
    currentShift = {
        id: Date.now(),
        name: '',
        startTime: new Date().toISOString(),
        entries: [],
        autoSaved: false
    };

    document.getElementById('mobileShiftName').value = '';
    renderAll();
    saveCurrentShift();
    updateShiftStatus();
}

function startAutoSave() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }

    autoSaveInterval = setInterval(() => {
        if (currentShift.entries.length > 0 && !currentShift.autoSaved) {
            saveCurrentShift();
        }
    }, 30000);
}

function setMobileNow(id) {
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0');
    document.getElementById(id).value = timeStr;
}

function validateTime(timeStr) {
    if (!timeStr) return true;
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeStr);
}

function setupTimeAutoComplete() {
    const timeInputs = document.querySelectorAll('input[type="text"][id^="mobileTime"]');
    timeInputs.forEach(input => {
        input.addEventListener('input', function (e) {
            e.target.value = e.target.value.replace(/[^0-9:]/g, '');
            let value = e.target.value.replace(/\D/g, '');
            let hours = '';
            let minutes = '';

            if (value.length >= 1) {
                hours = value.substring(0, 2);
                if (parseInt(hours) > 23) hours = '23';

                if (value.length >= 3) {
                    minutes = value.substring(2, 4);
                    if (parseInt(minutes) > 59) minutes = '59';
                }
            }

            if (hours && minutes) {
                e.target.value = hours.padStart(2, '0') + ':' + minutes.padStart(2, '0');
            } else if (hours) {
                e.target.value = hours;
            }
        });
    });
}

// Модальные окна
function showClearConfirmation() {
    if (currentShift.entries.length === 0) {
        showNotification('Нет данных для очистки', 'warning');
        return;
    }
    document.getElementById('clearModal').style.display = 'flex';
    closeSettings();
}

function hideClearConfirmation() {
    document.getElementById('clearModal').style.display = 'none';
}

function clearAllData() {
    currentShift.entries = [];
    currentShift.autoSaved = false;
    renderAll();
    saveCurrentShift();
    hideClearConfirmation();
    showNotification('Все данные очищены', 'success');
}

// Экспорт и печать
function exportCurrentShift() {
    const dataStr = JSON.stringify(currentShift, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `смена_${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    showNotification('Смена экспортирована в JSON', 'success');
    closeSettings();
}

function printShift() {
    let printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Смена: ${currentShift.name || 'Без названия'}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { color: #333; text-align: center; margin-bottom: 30px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                th { background-color: #f2f2f2; }
                .header { display: flex; justify-content: space-between; margin-bottom: 20px; }
                .stats { display: flex; gap: 20px; margin-bottom: 20px; }
                .stat-item { background: #f8f9fa; padding: 10px; border-radius: 5px; }
                @media print {
                    body { padding: 0; }
                    button { display: none; }
                }
            </style>
        </head>
        <body>
            <h1>${currentShift.name || 'Без названия'}</h1>
            <div class="header">
                <div>Дата: ${new Date().toLocaleDateString('ru-RU')}</div>
                <div>Всего заявок: ${currentShift.entries.length}</div>
            </div>
    `;

    if (currentShift.entries.length > 0) {
        printHTML += `
            <table>
                <thead>
                    <tr>
                        <th>№</th>
                        <th>Тип</th>
                        <th>Получено</th>
                        <th>Прибыл</th>
                        <th>Убыл</th>
                        <th>КУСП</th>
                        <th>Описание</th>
                        <th>Адрес</th>
                        <th>Результат</th>
                    </tr>
                </thead>
                <tbody>
        `;

        currentShift.entries.sort((a, b) => a.id - b.id).forEach(data => {
            printHTML += `
                <tr>
                    <td>${data.id}</td>
                    <td>${data.type}</td>
                    <td>${data.time1}</td>
                    <td>${data.time2}</td>
                    <td>${data.time3}</td>
                    <td>${data.kusp}</td>
                    <td>${data.desc}</td>
                    <td>${data.addr}</td>
                    <td>${data.result}</td>
                </tr>
            `;
        });

        printHTML += '</tbody></table>';
    } else {
        printHTML += '<p style="text-align: center; color: #666;">Нет заявок</p>';
    }

    printHTML += `
            <div style="margin-top: 30px; text-align: center;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Печать
                </button>
                <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">
                    Закрыть
                </button>
            </div>
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printHTML);
    printWindow.document.close();
    closeSettings();
}

// Функции для работы с доставленными
function saveDeliveredPeople() {
    if (!db) {
        saveDeliveredToLocalStorage();
        return;
    }

    const transaction = db.transaction('deliveredPeople', 'readwrite');
    const store = transaction.objectStore('deliveredPeople');

    deliveredPeople.forEach(person => {
        store.put(person);
    });
}

// Fallback функции для localStorage
function loadFromLocalStorage() {
    const savedCurrentShift = localStorage.getItem('currentShift');
    const savedHistory = localStorage.getItem('shiftHistory');
    const savedDelivered = localStorage.getItem('deliveredPeople');

    if (savedCurrentShift) {
        try {
            currentShift = JSON.parse(savedCurrentShift);
        } catch (e) {
            createNewShift();
        }
    } else {
        createNewShift();
    }

    if (savedHistory) {
        try {
            shiftHistory = JSON.parse(savedHistory);
        } catch (e) {
            shiftHistory = [];
        }
    }

    if (savedDelivered) {
        try {
            deliveredPeople = JSON.parse(savedDelivered);
        } catch (e) {
            deliveredPeople = [];
        }
    }

    document.getElementById('mobileShiftName').value = currentShift.name;
    updateShiftStatus();
}

function saveToLocalStorage() {
    try {
        currentShift.autoSaved = true;
        localStorage.setItem('currentShift', JSON.stringify(currentShift));
        updateShiftStatus();
    } catch (e) {
        showNotification('Ошибка сохранения: недостаточно места', 'error');
    }
}

function saveHistoryToLocalStorage() {
    try {
        localStorage.setItem('shiftHistory', JSON.stringify(shiftHistory));
    } catch (e) {
        showNotification('Ошибка сохранения истории', 'error');
    }
}

function saveDeliveredToLocalStorage() {
    try {
        localStorage.setItem('deliveredPeople', JSON.stringify(deliveredPeople));
    } catch (e) {
        showNotification('Ошибка сохранения доставленных', 'error');
    }
}

function openDeliveredForm() {
    // Создаем модальное окно для формы доставленного
    const modalHTML = `
        <div class="delivered-form-modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${editingDelivered !== null ? 'Редактировать' : 'Добавить'} доставленного</h3>
                    <button class="close-modal" onclick="closeDeliveredForm()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="deliveredForm" onsubmit="handleDeliveredSubmit(event)">
                        <div class="form-group">
                            <label for="deliveredFullName">ФИО</label>
                            <input type="text" id="deliveredFullName" required />
                        </div>
                        <div class="form-row">
                            <div class="form-group half">
                                <label for="deliveredTime">Время доставления</label>
                                <input type="text" id="deliveredTime" placeholder="чч:мм" required />
                            </div>
                            <div class="form-group half">
                                <label for="deliveredDepartureTime">Время убытия на МП</label>
                                <input type="text" id="deliveredDepartureTime" placeholder="чч:мм" />
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="deliveredReason">Основание доставления</label>
                            <textarea id="deliveredReason" rows="3" required></textarea>
                        </div>
                        <div class="form-group">
                            <label for="deliveredAdditionalInfo">Дополнительная информация</label>
                            <textarea id="deliveredAdditionalInfo" rows="2"></textarea>
                        </div>
                        <div class="form-actions">
                            <button type="button" class="btn-secondary" onclick="closeDeliveredForm()">
                                Отмена
                            </button>
                            <button type="submit" class="btn-primary">
                                ${editingDelivered !== null ? 'Сохранить' : 'Добавить'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    // Вставляем модальное окно
    const modal = document.createElement('div');
    modal.innerHTML = modalHTML;
    modal.id = 'deliveredFormModal';
    document.body.appendChild(modal);

    // Если редактируем, заполняем форму
    if (editingDelivered !== null) {
        const person = deliveredPeople[editingDelivered];
        document.getElementById('deliveredFullName').value = person.fullName;
        document.getElementById('deliveredTime').value = person.deliveredTime;
        document.getElementById('deliveredDepartureTime').value = person.departureTime || '';
        document.getElementById('deliveredReason').value = person.reason;
        document.getElementById('deliveredAdditionalInfo').value = person.additionalInfo || '';
    }

    // Устанавливаем текущее время по умолчанию
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' +
        now.getMinutes().toString().padStart(2, '0');

    if (!document.getElementById('deliveredTime').value) {
        document.getElementById('deliveredTime').value = timeStr;
    }

    document.getElementById('deliveredFullName').focus();
}

function closeDeliveredForm() {
    const modal = document.getElementById('deliveredFormModal');
    if (modal) {
        modal.remove();
    }
    editingDelivered = null;
}

function handleDeliveredSubmit(e) {
    e.preventDefault();

    const fullName = document.getElementById('deliveredFullName').value.trim();
    const deliveredTime = document.getElementById('deliveredTime').value;
    const reason = document.getElementById('deliveredReason').value.trim();

    if (!fullName || !deliveredTime || !reason) {
        showNotification('Заполните обязательные поля: ФИО, Время, Основание', 'error');
        return;
    }

    const person = {
        id: editingDelivered !== null ? deliveredPeople[editingDelivered].id : Date.now(),
        fullName,
        deliveredTime,
        departureTime: document.getElementById('deliveredDepartureTime').value || '',
        reason,
        additionalInfo: document.getElementById('deliveredAdditionalInfo').value || '',
        shiftId: currentShift.id,
        createdAt: new Date().toISOString()
    };

    if (editingDelivered !== null) {
        deliveredPeople[editingDelivered] = person;
        showNotification('Доставленный обновлен', 'success');
    } else {
        deliveredPeople.unshift(person);
        showNotification('Доставленный добавлен', 'success');
    }

    saveDeliveredPeople();
    closeDeliveredForm();
    renderDeliveredList();
    updateDeliveredStats();
}

function editDeliveredPerson(index) {
    editingDelivered = index;
    openDeliveredForm();
}

function deleteDeliveredPerson(index) {
    if (confirm('Вы уверены, что хотите удалить этого доставленного?')) {
        deliveredPeople.splice(index, 1);
        saveDeliveredPeople();
        renderDeliveredList();
        updateDeliveredStats();
        showNotification('Доставленный удален', 'success');
    }
}

function renderDeliveredList() {
    const list = document.getElementById('deliveredList');
    const searchTerm = document.getElementById('deliveredSearch').value.toLowerCase();

    list.innerHTML = '';

    let filtered = deliveredPeople.filter(person =>
        !searchTerm || person.fullName.toLowerCase().includes(searchTerm) ||
        person.reason.toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        document.getElementById('emptyDelivered').classList.add('active');
        return;
    }

    document.getElementById('emptyDelivered').classList.remove('active');

    filtered.forEach((person, index) => {
        const originalIndex = deliveredPeople.findIndex(p => p.id === person.id);
        const personElement = document.createElement('div');
        personElement.className = 'delivered-person';

        personElement.innerHTML = `
            <div class="delivered-person-header">
                <h3 class="delivered-person-name">${person.fullName}</h3>
                <span class="delivered-person-id">№${originalIndex + 1}</span>
            </div>
            <div class="delivered-person-details">
                <div class="detail-row">
                    <span class="detail-label">Время доставления:</span>
                    <span class="detail-value">${person.deliveredTime}</span>
                </div>
                ${person.departureTime ? `
                <div class="detail-row">
                    <span class="detail-label">Время убытия на МП:</span>
                    <span class="detail-value">${person.departureTime}</span>
                </div>` : ''}
                <div class="detail-row">
                    <span class="detail-label">Основание:</span>
                    <span class="detail-value">${person.reason}</span>
                </div>
                ${person.additionalInfo ? `
                <div class="detail-row">
                    <span class="detail-label">Дополнительно:</span>
                    <span class="detail-value">${person.additionalInfo}</span>
                </div>` : ''}
            </div>
            <div class="delivered-person-actions">
                <button class="delivered-person-btn edit" onclick="editDeliveredPerson(${originalIndex})">
                    <i class="fas fa-edit"></i>
                    Изменить
                </button>
                <button class="delivered-person-btn delete" onclick="deleteDeliveredPerson(${originalIndex})">
                    <i class="fas fa-trash"></i>
                    Удалить
                </button>
            </div>
        `;

        list.appendChild(personElement);
    });
}

function filterDelivered() {
    renderDeliveredList();
}

function updateDeliveredStats() {
    const totalDelivered = deliveredPeople.length;
    const currentShiftDelivered = deliveredPeople.filter(p => p.shiftId === currentShift.id).length;

    document.getElementById('totalDelivered').textContent = totalDelivered;
    document.getElementById('currentShiftDelivered').textContent = currentShiftDelivered;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', initApp);

// Очистка интервалов при выгрузке
window.addEventListener('beforeunload', () => {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }



});

