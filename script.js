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

// Загрузка темы из localStorage
function loadTheme() {
    const savedTheme = localStorage.getItem('journalTheme') || 'standard';
    const isDark = savedTheme === 'dark';
    const savedColor = localStorage.getItem('journalColor') || '#651D1C';

    document.getElementById('themeToggle').checked = isDark;
    document.getElementById('colorScheme').value = savedColor;

    setTheme(isDark ? 'dark' : 'standard', false);
    setColorScheme(savedColor, false);
}

// Установка темы
function setTheme(themeName, save = true) {
    document.body.className = 'theme-' + themeName;

    if (save) {
        localStorage.setItem('journalTheme', themeName);
    }

    updateThemeColors();
}

// Установка цветовой схемы
function setColorScheme(color, save = true) {
    currentColorScheme = color;

    if (save) {
        localStorage.setItem('journalColor', color);
    }

    updateThemeColors();
}

// Обновление цветов темы
function updateThemeColors() {
    const isDark = document.body.classList.contains('theme-dark');
    const root = document.documentElement;

    // Обновляем основные цвета
    const primaryColor = currentColorScheme;
    const lightColor = isDark ? lightenColor(primaryColor, 30) : primaryColor;
    const darkColor = isDark ? primaryColor : darkenColor(primaryColor, 20);

    // Применяем цвета к элементам
    const style = document.createElement('style');
    style.id = 'dynamic-colors';
    style.textContent = `
        .theme-standard button.finish-shift,
        .theme-standard th,
        .theme-standard .view-btn {
          background: ${primaryColor} !important;
        }
        
        .theme-standard button.finish-shift:hover,
        .theme-standard .view-btn:hover {
          background: ${darkColor} !important;
        }
        
        .theme-standard h2,
        .theme-standard .form-header,
        .theme-standard .stat-value {
          color: ${primaryColor} !important;
        }
        
        .theme-standard input:focus, 
        .theme-standard select:focus {
          border-color: ${primaryColor} !important;
          box-shadow: 0 0 0 2px ${primaryColor}33 !important;
        }
        
        .theme-dark button.finish-shift,
        .theme-dark th,
        .theme-dark .view-btn {
          background: ${lightColor} !important;
        }
        
        .theme-dark button.finish-shift:hover,
        .theme-dark .view-btn:hover {
          background: ${primaryColor} !important;
        }
        
        .theme-dark .form-header,
        .theme-dark .modal-title,
        .theme-dark .stat-value {
          color: ${lightColor} !important;
        }
        
        .theme-dark input:focus, 
        .theme-dark select:focus {
          border-color: ${lightColor} !important;
          box-shadow: 0 0 0 2px ${lightColor}33 !important;
        }
      `;

    // Удаляем старые стили и добавляем новые
    const oldStyle = document.getElementById('dynamic-colors');
    if (oldStyle) oldStyle.remove();
    document.head.appendChild(style);
}

// Функции для работы с цветами
function lightenColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (
        0x1000000 +
        (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
        (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
        (B < 255 ? B < 1 ? 0 : B : 255)
    ).toString(16).slice(1);
}

function darkenColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = (num >> 8 & 0x00FF) - amt;
    const B = (num & 0x0000FF) - amt;
    return "#" + (
        0x1000000 +
        (R > 0 ? R : 0) * 0x10000 +
        (G > 0 ? G : 0) * 0x100 +
        (B > 0 ? B : 0)
    ).toString(16).slice(1);
}

// Обработчик переключения темы
function handleThemeToggle() {
    const isDark = document.getElementById('themeToggle').checked;
    setTheme(isDark ? 'dark' : 'standard');
}

// Обработчик выбора цветовой схемы
function handleColorSchemeChange() {
    const color = document.getElementById('colorScheme').value;
    setColorScheme(color);
}

// Инициализация смены
function initShift() {
    const savedCurrentShift = localStorage.getItem('currentShift');
    const savedHistory = localStorage.getItem('shiftHistory');

    if (savedCurrentShift) {
        currentShift = JSON.parse(savedCurrentShift);
    } else {
        // Создание новой смены
        currentShift = {
            id: generateId(),
            name: '',
            startTime: new Date().toISOString(),
            entries: [],
            autoSaved: false
        };
        saveCurrentShift();
    }

    if (savedHistory) {
        shiftHistory = JSON.parse(savedHistory);
    }

    // Обновление интерфейса
    document.getElementById('shiftName').value = currentShift.name;
    renderTable();
    let nextId = Math.max(0, ...currentShift.entries.map(e => e.id)) + 1;
    document.getElementById('num').value = nextId;
    renderHistory();
    updateStats();

    // Запуск автосохранения
    startAutoSave();

    // Настройка обработчиков поиска
    setupSearchHandlers();

    showNotification('Смена загружена', 'info');
}

// Настройка обработчиков поиска
function setupSearchHandlers() {
    document.getElementById('searchInput').addEventListener('input', function () {
        currentSearchTerm = this.value.toLowerCase();
        renderTable();
    });

    document.getElementById('filterType').addEventListener('change', function () {
        currentFilterType = this.value;
        renderTable();
    });

    document.getElementById('historySearch').addEventListener('input', function () {
        renderHistory();
    });
}

// Очистка поиска
function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterType').value = '';
    currentSearchTerm = '';
    currentFilterType = '';
    renderTable();
}

// Очистка поиска в истории
function clearHistorySearch() {
    document.getElementById('historySearch').value = '';
    renderHistory();
}

// Генерация ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Сохранение текущей смены
function saveCurrentShift() {
    try {
        currentShift.autoSaved = true;
        localStorage.setItem('currentShift', JSON.stringify(currentShift));
    } catch (e) {
        showNotification('Ошибка сохранения: недостаточно места', 'error');
    }
}

function saveShiftHistory() {
    try {
        localStorage.setItem('shiftHistory', JSON.stringify(shiftHistory));
    } catch (e) {
        showNotification('Ошибка сохранения истории', 'error');
    }
}

// Завершение смены
function finishShift() {
    const shiftName = document.getElementById('shiftName').value.trim() || 'Без имени';

    // Если есть заявки и смена не была автосохранена, запрашиваем подтверждение
    if (currentShift.entries.length > 0 && !currentShift.autoSaved) {
        if (!confirm(`В смене есть ${currentShift.entries.length} несохраненных заявок. Сохранить смену "${shiftName}"?`)) {
            return;
        }
    }

    // Если смена пустая, просто создаем новую
    if (currentShift.entries.length === 0) {
        createNewShift();
        showNotification('Новая смена создана', 'success');
        return;
    }

    // Сохранение смены в историю
    const finishedShift = {
        id: currentShift.id,
        name: shiftName,
        startTime: currentShift.startTime,
        endTime: new Date().toISOString(),
        entries: [...currentShift.entries]
    };

    shiftHistory.unshift(finishedShift);
    saveShiftHistory();

    // Создание новой смены
    createNewShift();

    showNotification(`Смена "${shiftName}" сохранена в историю`, 'success');
}

// Создание новой смены
function createNewShift() {
    currentShift = {
        id: generateId(),
        name: '',
        startTime: new Date().toISOString(),
        entries: [],
        autoSaved: false
    };

    document.getElementById('shiftName').value = '';
    renderTable();
    updateStats();
    saveCurrentShift();
}

// Автосохранение
function startAutoSave() {
    if (autoSaveInterval) {
        clearInterval(autoSaveInterval);
    }

    autoSaveInterval = setInterval(() => {
        if (currentShift.entries.length > 0 && !currentShift.autoSaved) {
            saveCurrentShift();
            showNotification('Автосохранение выполнено', 'info');
        }
    }, 30000); // 30 секунд
}

// Обновление статистики
function updateStats() {
    const currentStats = document.getElementById('currentStats');
    const historyStats = document.getElementById('historyStats');

    // Статистика текущей смены
    const totalEntries = currentShift.entries.length;
    const addressType = currentShift.entries.filter(e => e.type === 'А').length;
    const streetType = currentShift.entries.filter(e => e.type === 'У').length;

    currentStats.innerHTML = `
        <div class="stat-item">Всего заявок: [${totalEntries}]</div>
        <div class="stat-item">Адресные: [${addressType}]</div>
        <div class="stat-item">Уличные: [${streetType}]</div>
      `;

    // Статистика истории
    const totalShifts = shiftHistory.length;
    const totalHistoricalEntries = shiftHistory.reduce((sum, shift) => sum + shift.entries.length, 0);

    historyStats.innerHTML = `
        <div class="stat-item">Всего смен: [${totalShifts}]</div>
        <div class="stat-item">Всего заявок: [${totalHistoricalEntries}]</div>
      `;
}

// Отображение уведомления
function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Текущее время
function getTime() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

// Кнопка "Текущее"
function setNow(id) {
    const input = document.getElementById(id);
    input.value = getTime();
}

// Валидация времени
function validateTime(timeStr) {
    if (!timeStr) return true; // Пустое значение допустимо

    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeStr);
}

// Автодополнение времени
function setupTimeAutoComplete() {
    const timeInputs = document.querySelectorAll('input[type="text"][id^="time"]');
    timeInputs.forEach(input => {
        input.addEventListener('input', function (e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                let hours = value.substring(0, 2);
                // Ограничиваем часы от 00 до 23
                if (hours > 23) hours = '23';
                value = hours + ':' + value.substring(2, 4);
            }
            e.target.value = value;
        });
    });
}

// Добавить строку
function addRow() {
    // Валидация обязательных полей
    const numValue = document.getElementById("num").value;
    const time1 = document.getElementById("time1").value;
    const desc = document.getElementById("desc").value;
    const addr = document.getElementById("addr").value;

    if (!numValue || !time1 || !desc || !addr) {
        showNotification('Заполните обязательные поля: № заявки, Получено, Описание, Адрес', 'error');
        return;
    }

    // Валидация номера заявки
    const num = parseInt(numValue);
    if (isNaN(num) || num <= 0) {
        showNotification('Номер заявки должен быть положительным числом', 'error');
        return;
    }
    if (currentShift.entries.some(e => e.id === num && (editingRow === null || e.id !== currentShift.entries[editingRow].id))) {
        showNotification('Заявка с таким номером уже существует', 'error');
        return;
    }

    // Валидация времени
    if (!validateTime(time1) ||
        !validateTime(document.getElementById("time2").value) ||
        !validateTime(document.getElementById("time3").value)) {
        showNotification('Проверьте правильность введенного времени. Формат: ЧЧ:ММ', 'error');
        return;
    }

    const data = {
        id: num,
        type: document.getElementById("type").value,
        time1: time1,
        time2: document.getElementById("time2").value || '',
        time3: document.getElementById("time3").value || '',
        kusp: document.getElementById("kusp").value,
        desc: desc,
        addr: addr,
        result: document.getElementById("result").value
    };

    if (editingRow !== null) {
        // Редактирование существующей строки
        currentShift.entries[editingRow] = data;
        editingRow = null;
        document.querySelector('.add').textContent = 'Добавить';
        showNotification('Заявка обновлена');
    } else {
        // Добавление новой строки
        currentShift.entries.push(data);

        // Обновляем счетчик, если номер заявки больше текущего счетчика
        let maxId = Math.max(...currentShift.entries.map(e => e.id), 0);
        if (num >= maxId) {
            maxId = num + 1;
        }

        showNotification('Заявка добавлена');
    }

    currentShift.autoSaved = false;
    renderTable();
    updateStats();
    saveCurrentShift();

    // Сброс формы
    let nextId = Math.max(0, ...currentShift.entries.map(e => e.id)) + 1;
    document.getElementById("num").value = nextId;
    document.getElementById("time1").value = '';
    //setNow('time1');
    document.getElementById("time2").value = '';
    document.getElementById("time3").value = '';
    document.getElementById("kusp").value = '';
    document.getElementById("desc").value = '';
    document.getElementById("addr").value = '';
    document.getElementById("result").value = '';
}

// Редактирование строки
function editRow(index) {
    // ... заполняем поля
    document.getElementById("num").focus(); // добавить
    const data = currentShift.entries[index];

    document.getElementById("num").value = data.id;
    document.getElementById("type").value = data.type;
    document.getElementById("time1").value = data.time1;
    document.getElementById("time2").value = data.time2;
    document.getElementById("time3").value = data.time3;
    document.getElementById("kusp").value = data.kusp;
    document.getElementById("desc").value = data.desc;
    document.getElementById("addr").value = data.addr;
    document.getElementById("result").value = data.result;

    editingRow = index;
    document.querySelector('.add').textContent = 'Обновить';

    // Прокрутка к форме
    document.querySelector('.form').scrollIntoView({ behavior: 'smooth' });
}

// Удаление строки
function deleteRow(index) {
    if (confirm('Вы уверены, что хотите удалить эту заявку?')) {
        currentShift.entries.splice(index, 1);
        currentShift.autoSaved = false;
        renderTable();
        updateStats();
        saveCurrentShift();
        showNotification('Заявка удалена');

        // Обновляем nextId
        let nextId = Math.max(0, ...currentShift.entries.map(e => e.id)) + 1;
        document.getElementById("num").value = nextId;
    }
}

// Отображение таблицы
function renderTable() {
    const tbody = document.querySelector("#journal tbody");
    tbody.innerHTML = '';

    // Фильтрация данных
    let filteredEntries = currentShift.entries.filter(entry => {
        const matchesSearch = !currentSearchTerm ||
            Object.values(entry).some(value =>
                value && value.toString().toLowerCase().includes(currentSearchTerm)
            );
        const matchesType = !currentFilterType || entry.type === currentFilterType;
        return matchesSearch && matchesType;
    });

    // Сортируем данные по номеру заявки
    filteredEntries.sort((a, b) => a.id - b.id);

    filteredEntries.forEach((data, index) => {
        const originalIndex = currentShift.entries.findIndex(e => e.id === data.id);
        const row = tbody.insertRow();

        const cells = [
            data.id,
            data.type,
            data.time1,
            data.time2,
            data.time3,
            data.kusp,
            data.desc,
            data.addr,
            data.result
        ];

        cells.forEach((val, i) => {
            const cell = row.insertCell(i);
            cell.textContent = val || '';
            cell.title = val || ''; // Добавляем подсказку при наведении

            // Подсветка при поиске
            if (currentSearchTerm && val && val.toString().toLowerCase().includes(currentSearchTerm)) {
                cell.classList.add('highlight');
            }
        });

        // Добавляем ячейку с действиями
        const actionsCell = row.insertCell();
        actionsCell.className = 'actions-cell';
        actionsCell.innerHTML = `
          <button class="edit-btn" onclick="editRow(${originalIndex})">Изм.</button>
          <button class="delete-btn" onclick="deleteRow(${originalIndex})">Удл.</button>
        `;
    });
    document.getElementById('printShiftName').textContent = currentShift.name || 'Без названия';
}

// Отображение истории смен
function renderHistory() {
    const historyList = document.getElementById('historyList');
    const searchTerm = document.getElementById('historySearch').value.toLowerCase();

    historyList.innerHTML = '';

    let filteredHistory = shiftHistory.filter(shift =>
        !searchTerm || shift.name.toLowerCase().includes(searchTerm)
    );

    if (filteredHistory.length === 0) {
        historyList.innerHTML = '<div style="text-align: center; padding: 20px; color: #6c757d;">История смен пуста</div>';
        return;
    }

    filteredHistory.forEach((shift, index) => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';

        const startDate = new Date(shift.startTime);
        const formattedDate = startDate.toLocaleDateString('ru-RU') + ' ' + startDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        historyItem.innerHTML = `
          <div class="history-name">${shift.name}</div>
          <div class="history-date">${formattedDate}</div>
          <div class="history-count">${shift.entries.length}</div>
          <div class="history-actions">
            <button class="view-btn" onclick="viewShift(${index})">Просмотр</button>
            <button class="delete-history-btn" onclick="deleteShiftFromHistory(${index})">Удалить</button>
          </div>
        `;

        historyList.appendChild(historyItem);
    });

    updateStats();
}

// Просмотр смены из истории
function viewShift(index) {
    const shift = shiftHistory[index];
    const tbody = document.querySelector("#viewShiftTable tbody");
    tbody.innerHTML = '';

    document.getElementById('viewShiftTitle').textContent = `Просмотр смены: ${shift.name}`;

    // Сортируем данные по номеру заявки
    shift.entries.sort((a, b) => a.id - b.id);

    shift.entries.forEach((data) => {
        const row = tbody.insertRow();

        const cells = [
            data.id,
            data.type,
            data.time1,
            data.time2,
            data.time3,
            data.kusp,
            data.desc,
            data.addr,
            data.result
        ];

        cells.forEach((val, i) => {
            const cell = row.insertCell(i);
            cell.textContent = val || '';
            cell.title = val || '';
        });
    });

    document.getElementById('viewShiftModal').style.display = 'block';
}

// Удаление смены из истории
function deleteShiftFromHistory(index) {
    if (confirm('Вы уверены, что хотите удалить эту смену из истории? Это действие нельзя отменить.')) {
        shiftHistory.splice(index, 1);
        saveShiftHistory();
        renderHistory();
        updateStats();
        showNotification('Смена удалена из истории', 'success');
    }
}

// Скрыть модальное окно просмотра смены
function hideViewShiftModal() {
    document.getElementById('viewShiftModal').style.display = 'none';
}

// Показать модальное окно подтверждения очистки
function showClearConfirmation() {
    if (currentShift.entries.length === 0) {
        showNotification('Нет данных для очистки', 'warning');
        return;
    }
    document.getElementById('clearModal').style.display = 'block';
}

// Скрыть модальное окно подтверждения очистки
function hideClearConfirmation() {
    document.getElementById('clearModal').style.display = 'none';
}

// Очистить все данные
function clearAllData() {
    currentShift.entries = [];
    currentShift.autoSaved = false;
    renderTable();
    updateStats();
    saveCurrentShift();
    hideClearConfirmation();
    showNotification('Все данные очищены', 'success');
}

// Обработчики вкладок
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        // Убираем активный класс у всех вкладок
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Добавляем активный класс к выбранной вкладке
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-tab').classList.add('active');

        // Если переключились на вкладку истории, обновляем список
        if (tab.dataset.tab === 'history') {
            renderHistory();
        }
    });
});

// Автосохранение названия смены
document.getElementById('shiftName').addEventListener('input', function () {
    currentShift.name = this.value;
    currentShift.autoSaved = false;
    saveCurrentShift();
});

// Загрузка данных из localStorage при загрузке страницы
document.addEventListener('DOMContentLoaded', function () {
    loadTheme();
    initShift();
    setupTimeAutoComplete();
    //setNow('time1');

    let nextId = Math.max(0, ...currentShift.entries.map(e => e.id)) + 1;
    document.getElementById('num').value = nextId;

    // Добавляем обработчики событий
    document.getElementById('themeToggle').addEventListener('change', handleThemeToggle);
    document.getElementById('colorScheme').addEventListener('change', handleColorSchemeChange);
});

// Показать модальное окно информации
function showInfoModal() {
    document.getElementById('infoModal').style.display = 'block';
}

// Скрыть модальное окно информации
function hideInfoModal() {
    document.getElementById('infoModal').style.display = 'none';
}

// Закрытие модального окна при клике вне его
window.addEventListener('click', function (event) {
    const infoModal = document.getElementById('infoModal');
    if (event.target === infoModal) {
        hideInfoModal();
    }

    const viewShiftModal = document.getElementById('viewShiftModal');
    if (event.target === viewShiftModal) {
        hideViewShiftModal();
    }

    const clearModal = document.getElementById('clearModal');
    if (event.target === clearModal) {
        hideClearConfirmation();
    }
});