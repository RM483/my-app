/* public/js/app.js */

// グローバルで管理するカレンダーインスタンス
let calendar = null;
let currentMode = "detail";
let currentView = "today";
let currentScheduleDate = null;
let draggedScheduleTaskId = null;
let draggedScheduleId = null;
let draggedScheduleDurationSlots = 2;
let pendingAutoSchedulePreview = null;
const selectedPlacementTaskIds = new Set();
const placementTaskColors = new Map();
// 配置確認の分類は複数選択できるよう、手動選択と検索中の一時解除を分けて管理する。
const manualPlacementCategoryFilters = new Set();
const suppressedSearchPlacementCategories = new Set();
let placementSearchWasActive = false;
const placementMarkerPalette = [
  "#5b6ee1",
  "#805ad5",
  "#3182ce",
  "#319795",
  "#d53f8c",
  "#6b46c1",
  "#2b6cb0",
  "#4c51bf",
];

// 💡 【機能維持】画面の表示切り替えロジック
function switchView(viewName) {
  const allowedViews = ["today", "list", "calendar"];
  const normalizedView = allowedViews.includes(viewName) ? viewName : "today";
  const viewElements = {
    today: {
      area: document.getElementById("todayScheduleViewArea"),
      button: document.getElementById("todayScheduleViewBtn"),
    },
    list: {
      area: document.getElementById("listViewArea"),
      button: document.getElementById("listViewBtn"),
    },
    calendar: {
      area: document.getElementById("calendarViewArea"),
      button: document.getElementById("calendarViewBtn"),
    },
  };

  currentView = normalizedView;

  // 3画面を同じ規則で切り替え、選択中のボタンだけを有効にする
  Object.entries(viewElements).forEach(([view, elements]) => {
    elements.area?.classList.toggle("hidden", view !== normalizedView);
    elements.button?.classList.toggle("active", view === normalizedView);
  });

  if (normalizedView === "today") {
    renderTodaySchedule();
  } else if (normalizedView === "calendar" && calendar) {
    calendar.render();
  }

  const viewInput = document.getElementById("viewInput");
  if (viewInput) {
    viewInput.value = currentView;
  }
}

// 💡 【機能維持】バリデーションロジック
function formatDateLabel(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function formatTimeLabel(index) {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 === 0 ? "00" : "30";
  return `${hour}:${minute}`;
}

function normalizeDateKey(value) {
  if (!value) return null;

  const parsedDate = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeJapanDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value;
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

function getPlacedTaskCandidates() {
  return (window.scheduleTasks || []).filter(
    (todo) => (todo.schedules || []).length > 0,
  );
}

function getPlacementTaskColor(taskId) {
  const key = String(taskId);
  if (!placementTaskColors.has(key)) {
    placementTaskColors.set(
      key,
      placementMarkerPalette[placementTaskColors.size % placementMarkerPalette.length],
    );
  }
  return placementTaskColors.get(key);
}

function setPlacementTaskSelected(taskId, selected) {
  const key = String(taskId);
  if (selected) selectedPlacementTaskIds.add(key);
  else selectedPlacementTaskIds.delete(key);
  renderPlacementTaskInspector();
  renderPlacementMarkers();
}

function renderPlacementTaskInspector() {
  const searchInput = document.getElementById("placementTaskSearch");
  const categoryFilters = document.getElementById("placementCategoryFilters");
  const selectedCount = document.getElementById("placementSelectedCount");
  const selectedChips = document.getElementById("placementSelectedChips");
  const choices = document.getElementById("placementTaskChoices");
  const empty = document.getElementById("placementTaskEmpty");
  const clearButton = document.getElementById("clearPlacementSelection");
  if (
    !searchInput ||
    !categoryFilters ||
    !selectedCount ||
    !selectedChips ||
    !choices ||
    !empty ||
    !clearButton
  )
    return;

  const candidates = getPlacedTaskCandidates();
  const candidateIds = new Set(candidates.map((todo) => String(todo.id)));
  for (const taskId of selectedPlacementTaskIds) {
    if (!candidateIds.has(taskId)) selectedPlacementTaskIds.delete(taskId);
  }
  candidates.forEach((todo) => getPlacementTaskColor(todo.id));

  const categories = [
    ...new Set(candidates.map((todo) => todo.categoryName || "分類なし")),
  ].sort((a, b) => a.localeCompare(b, "ja"));

  // 配置がなくなった分類は、保持中のフィルターからも取り除く。
  for (const categoryName of manualPlacementCategoryFilters) {
    if (!categories.includes(categoryName)) {
      manualPlacementCategoryFilters.delete(categoryName);
    }
  }
  for (const categoryName of suppressedSearchPlacementCategories) {
    if (!categories.includes(categoryName)) {
      suppressedSearchPlacementCategories.delete(categoryName);
    }
  }

  const searchWord = searchInput.value.trim().toLocaleLowerCase("ja");
  const isSearchActive = searchWord.length > 0;
  if (!isSearchActive && placementSearchWasActive) {
    // 検索中だけ使った一時的な解除状態は、検索終了時に破棄する。
    suppressedSearchPlacementCategories.clear();
  }
  placementSearchWasActive = isSearchActive;

  const titleMatchedTasks = isSearchActive
    ? candidates.filter((todo) =>
        String(todo.title || "").toLocaleLowerCase("ja").includes(searchWord),
      )
    : [];
  const searchMatchedCategories = new Set(
    titleMatchedTasks.map((todo) => todo.categoryName || "分類なし"),
  );
  for (const categoryName of suppressedSearchPlacementCategories) {
    if (!searchMatchedCategories.has(categoryName)) {
      suppressedSearchPlacementCategories.delete(categoryName);
    }
  }

  // 検索中は一致タスクの分類を自動点灯し、手動選択は別に保持する。
  const activeCategories = new Set(manualPlacementCategoryFilters);
  if (isSearchActive) {
    for (const categoryName of searchMatchedCategories) {
      if (!suppressedSearchPlacementCategories.has(categoryName)) {
        activeCategories.add(categoryName);
      }
    }
  }
  const areAllCategoriesSelected =
    categories.length > 0 &&
    categories.every((categoryName) => activeCategories.has(categoryName));

  categoryFilters.innerHTML = "";
  const addCategoryButton = (value, label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "placement-category-chip";
    const isActive =
      value === null
        ? areAllCategoriesSelected
        : activeCategories.has(value);
    button.classList.toggle("active", isActive);
    button.textContent = label;
    button.addEventListener("click", () => {
      if (value === null) {
        if (areAllCategoriesSelected) {
          manualPlacementCategoryFilters.clear();
          suppressedSearchPlacementCategories.clear();
          if (isSearchActive) {
            for (const categoryName of searchMatchedCategories) {
              suppressedSearchPlacementCategories.add(categoryName);
            }
          }
        } else {
          for (const categoryName of categories) {
            manualPlacementCategoryFilters.add(categoryName);
          }
          suppressedSearchPlacementCategories.clear();
        }
      } else if (activeCategories.has(value)) {
        manualPlacementCategoryFilters.delete(value);
        if (isSearchActive && searchMatchedCategories.has(value)) {
          suppressedSearchPlacementCategories.add(value);
        }
      } else {
        manualPlacementCategoryFilters.add(value);
        suppressedSearchPlacementCategories.delete(value);
      }
      renderPlacementTaskInspector();
    });
    categoryFilters.appendChild(button);
  };
  addCategoryButton(null, "すべて");
  categories.forEach((category) => addCategoryButton(category, category));

  const filtered = candidates.filter((todo) => {
    const categoryName = todo.categoryName || "分類なし";
    const matchesSearch =
      !isSearchActive ||
      String(todo.title || "").toLocaleLowerCase("ja").includes(searchWord);
    return matchesSearch && activeCategories.has(categoryName);
  });

  choices.innerHTML = filtered
    .map((todo) => {
      const taskId = String(todo.id);
      const dates = new Set(
        (todo.schedules || [])
          .map((schedule) => normalizeJapanDateKey(schedule.scheduledStart))
          .filter(Boolean),
      );
      return `
        <label class="placement-task-choice" style="--placement-task-color:${getPlacementTaskColor(taskId)}">
          <input type="checkbox" value="${taskId}" ${selectedPlacementTaskIds.has(taskId) ? "checked" : ""}>
          <span class="placement-task-choice-dot"></span>
          <span class="placement-task-choice-main">
            <span class="placement-task-choice-title" title="${escapeScheduleText(todo.title)}">${escapeScheduleText(todo.title)}</span>
            <span class="placement-task-choice-meta">${escapeScheduleText(todo.categoryName || "分類なし")}・${dates.size}日 / ${(todo.schedules || []).length}件</span>
          </span>
        </label>
      `;
    })
    .join("");
  choices.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      setPlacementTaskSelected(checkbox.value, checkbox.checked);
    });
  });
  empty.classList.toggle("hidden", filtered.length > 0);

  const selectedTodos = candidates.filter((todo) =>
    selectedPlacementTaskIds.has(String(todo.id)),
  );
  selectedCount.textContent = `${selectedTodos.length}件`;
  clearButton.disabled = selectedTodos.length === 0;
  selectedChips.innerHTML = selectedTodos
    .map(
      (todo) => `
        <button type="button" class="placement-selected-chip" data-task-id="${todo.id}" title="${escapeScheduleText(todo.title)}" style="--placement-task-color:${getPlacementTaskColor(todo.id)}">
          <span class="placement-selected-chip-dot"></span>
          <span class="placement-selected-chip-label">${escapeScheduleText(todo.title)}</span>
          <span aria-hidden="true">×</span>
        </button>
      `,
    )
    .join("");
  selectedChips.querySelectorAll(".placement-selected-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      setPlacementTaskSelected(chip.dataset.taskId, false);
    });
  });
}

function renderPlacementMarkers() {
  document
    .querySelectorAll(".placement-date-markers")
    .forEach((marker) => marker.remove());
  if (!calendar || selectedPlacementTaskIds.size === 0) return;

  const markersByDate = new Map();
  getPlacedTaskCandidates()
    .filter((todo) => selectedPlacementTaskIds.has(String(todo.id)))
    .forEach((todo) => {
      const taskDates = new Set(
        (todo.schedules || [])
          .map((schedule) => normalizeJapanDateKey(schedule.scheduledStart))
          .filter(Boolean),
      );
      taskDates.forEach((dateKey) => {
        if (!markersByDate.has(dateKey)) markersByDate.set(dateKey, []);
        markersByDate.get(dateKey).push({
          title: todo.title,
          color: getPlacementTaskColor(todo.id),
        });
      });
    });

  markersByDate.forEach((markers, dateKey) => {
    const cell = document.querySelector(
      `#calendar .fc-daygrid-day[data-date="${dateKey}"]`,
    );
    const target = cell?.querySelector(".fc-daygrid-day-events");
    if (!target) return;
    const container = document.createElement("div");
    container.className = "placement-date-markers";
    markers.slice(0, 2).forEach((marker) => {
      const item = document.createElement("div");
      item.className = "placement-date-marker";
      item.title = marker.title;
      item.style.setProperty("--placement-task-color", marker.color);
      const dot = document.createElement("span");
      dot.className = "placement-date-marker-dot";
      const label = document.createElement("span");
      label.className = "placement-date-marker-label";
      label.textContent = marker.title;
      item.append(dot, label);
      container.appendChild(item);
    });
    if (markers.length > 2) {
      const more = document.createElement("div");
      more.className = "placement-date-marker-more";
      more.textContent = `＋${markers.length - 2}件`;
      container.appendChild(more);
    }
    target.appendChild(container);
  });
}

function refreshPlacementTaskInspector() {
  renderPlacementTaskInspector();
  renderPlacementMarkers();
}

function initializePlacementTaskInspector() {
  const searchInput = document.getElementById("placementTaskSearch");
  const clearButton = document.getElementById("clearPlacementSelection");
  if (!searchInput || !clearButton) return;
  if (searchInput.dataset.placementInspectorReady !== "true") {
    searchInput.dataset.placementInspectorReady = "true";
    searchInput.addEventListener("input", renderPlacementTaskInspector);
    clearButton.addEventListener("click", () => {
      selectedPlacementTaskIds.clear();
      refreshPlacementTaskInspector();
    });
  }
  refreshPlacementTaskInspector();
}

function buildFilterChips(tasks, filterType) {
  const values = [
    ...new Set(tasks.map((task) => task[filterType]).filter(Boolean)),
  ];
  if (values.length === 0) return "";

  return `
    <div class="filter-group">
      <span class="filter-group-title">${filterType === "priority" ? "重要度" : "分類"}</span>
      ${values
        .map(
          (value) => `
          <button type="button" class="filter-chip" data-filter-type="${filterType}" data-filter-value="${value}">
            ${value}
          </button>
        `,
        )
        .join("")}
    </div>
  `;
}

function renderUnscheduledTasks(tasks, selectedDate, overdueTasks = []) {
  const list = document.getElementById("unscheduledTaskList");
  const overdueList = document.getElementById("overdueTaskList");
  const filters = document.getElementById("unscheduledTaskFilters");
  const overdueFilters = document.getElementById("overdueTaskFilters");
  const overdueToggle = document.getElementById("overdueTaskToggle");
  const overdueContent = document.getElementById("overdueTaskContent");
  const overdueCount = document.getElementById("overdueTaskCount");
  if (
    !list ||
    !overdueList ||
    !filters ||
    !overdueFilters ||
    !overdueToggle ||
    !overdueContent ||
    !overdueCount
  )
    return;

  const orderedTasks = [...tasks].sort(
    (a, b) =>
      Number(normalizeDateKey(b.dueDate) === selectedDate) -
      Number(normalizeDateKey(a.dueDate) === selectedDate),
  );

  const activeFilters = {
    priority: null,
    categoryName: null,
  };
  const overdueActiveFilters = {
    priority: null,
    categoryName: null,
  };

  const applyFilters = () => {
    const filteredTasks = orderedTasks.filter((todo) => {
      if (activeFilters.priority && todo.priority !== activeFilters.priority)
        return false;
      if (
        activeFilters.categoryName &&
        (todo.categoryName || "分類なし") !== activeFilters.categoryName
      )
        return false;
      return true;
    });

    list.innerHTML =
      filteredTasks.length > 0
        ? filteredTasks
            .map((todo) => {
              const priorityClass =
                todo.priority === "高"
                  ? "priority-high"
                  : todo.priority === "低"
                    ? "priority-low"
                    : "priority-normal";
              const doneClass = todo.isCompleted ? "completed" : "";
              const dueOnSelectedDate =
                normalizeDateKey(todo.dueDate) === selectedDate;
              const dueDateClass = dueOnSelectedDate
                ? "due-on-selected-date"
                : "";
              const dueDateText = todo.dueDate
                ? `期日: ${normalizeDateKey(todo.dueDate)}`
                : "期日未設定";
              return `
                <div class="unscheduled-task-item ${priorityClass} ${doneClass} ${dueDateClass}" draggable="true" data-task-id="${todo.id}">
                  <div class="unscheduled-task-item-title-row">
                    <div class="unscheduled-task-item-title">${todo.title}</div>
                    <div class="unscheduled-task-item-date">${dueDateText}</div>
                  </div>
                  <div class="unscheduled-task-item-meta">${todo.categoryName || "分類なし"}</div>
                </div>
              `;
            })
            .join("")
        : '<div class="schedule-item-empty">条件に一致するタスクはありません</div>';
  };

  filters.innerHTML = [
    buildFilterChips(tasks, "priority"),
    buildFilterChips(tasks, "categoryName"),
  ]
    .filter(Boolean)
    .join("");

  filters.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const { filterType, filterValue } = button.dataset;
      if (!filterType || !filterValue) return;
      const currentValue = activeFilters[filterType];
      activeFilters[filterType] =
        currentValue === filterValue ? null : filterValue;
      filters
        .querySelectorAll(`.filter-chip[data-filter-type="${filterType}"]`)
        .forEach((chip) => {
          chip.classList.toggle(
            "active",
            chip.dataset.filterValue === activeFilters[filterType],
          );
        });
      applyFilters();
    });
  });

  const applyOverdueFilters = () => {
    const filteredTasks = overdueTasks.filter((todo) => {
      if (
        overdueActiveFilters.priority &&
        todo.priority !== overdueActiveFilters.priority
      )
        return false;
      if (
        overdueActiveFilters.categoryName &&
        (todo.categoryName || "分類なし") !==
          overdueActiveFilters.categoryName
      )
        return false;
      return true;
    });

    overdueList.innerHTML =
      filteredTasks.length > 0
        ? filteredTasks
            .map((todo) => {
              const priorityClass =
                todo.priority === "高"
                  ? "priority-high"
                  : todo.priority === "低"
                    ? "priority-low"
                    : "priority-normal";
              const doneClass = todo.isCompleted ? "completed" : "";
              const dueDateText = `期日: ${normalizeDateKey(todo.dueDate)}`;
              return `
                <div class="unscheduled-task-item ${priorityClass} ${doneClass}" draggable="true" data-task-id="${todo.id}">
                  <div class="unscheduled-task-item-title-row">
                    <div class="unscheduled-task-item-title">${todo.title}</div>
                    <div class="unscheduled-task-item-date">${dueDateText}</div>
                  </div>
                  <div class="unscheduled-task-item-meta">${todo.categoryName || "分類なし"}</div>
                </div>
              `;
            })
            .join("")
        : '<div class="schedule-item-empty">条件に一致する期日超過タスクはありません</div>';
  };

  overdueCount.textContent = `${overdueTasks.length}件`;
  overdueContent.classList.add("hidden");
  overdueToggle.setAttribute("aria-expanded", "false");
  overdueToggle.onclick = () => {
    const willExpand = overdueContent.classList.contains("hidden");
    overdueContent.classList.toggle("hidden", !willExpand);
    overdueToggle.setAttribute("aria-expanded", String(willExpand));
  };

  overdueFilters.innerHTML = [
    buildFilterChips(overdueTasks, "priority"),
    buildFilterChips(overdueTasks, "categoryName"),
  ]
    .filter(Boolean)
    .join("");

  overdueFilters.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const { filterType, filterValue } = button.dataset;
      if (!filterType || !filterValue) return;
      const currentValue = overdueActiveFilters[filterType];
      overdueActiveFilters[filterType] =
        currentValue === filterValue ? null : filterValue;
      overdueFilters
        .querySelectorAll(`.filter-chip[data-filter-type="${filterType}"]`)
        .forEach((chip) => {
          chip.classList.toggle(
            "active",
            chip.dataset.filterValue === overdueActiveFilters[filterType],
          );
        });
      applyOverdueFilters();
    });
  });

  applyOverdueFilters();
  applyFilters();
}

function getScheduledTasksForDate(dateStr) {
  return (window.scheduleTasks || []).flatMap((todo) =>
    (todo.schedules || [])
      .filter(
        (schedule) =>
          normalizeDateKey(schedule.scheduledStart) === dateStr,
      )
      .map((schedule) => ({
        ...todo,
        scheduleId: schedule.id,
        scheduledStart: schedule.scheduledStart,
        scheduledEnd: schedule.scheduledEnd,
      })),
  );
}

function getTodayDateKey() {
  return normalizeDateKey(new Date());
}

function renderTodaySchedule() {
  const timeline = document.getElementById("todayScheduleTimeline");
  const title = document.getElementById("todayScheduleTitle");
  const subtitle = document.getElementById("todayScheduleSubtitle");
  if (!timeline || !title || !subtitle) return;

  const dateStr = getTodayDateKey();
  const scheduledTasks = getScheduledTasksForDate(dateStr);
  title.textContent = `今日のスケジュール（${formatDateLabel(dateStr)}）`;

  setupInteractiveSchedule(dateStr, scheduledTasks, {
    timeline,
    taskSidebar: null,
    subtitle,
  });

  const now = new Date();
  const currentSlot = Math.floor((now.getHours() * 60 + now.getMinutes()) / 30);
  timeline.scrollTop = Math.max(0, currentSlot * 48 - 120);
}

function refreshScheduleViews() {
  renderTodaySchedule();

  const overlay = document.getElementById("dayScheduleOverlay");
  if (
    currentScheduleDate &&
    overlay &&
    !overlay.classList.contains("hidden")
  ) {
    openDaySchedule(currentScheduleDate);
  }

  refreshAutoScheduleCandidates();
  refreshPlacementTaskInspector();
}

function formatAutoScheduleHours(minutes) {
  const hours = minutes / 60;
  return Number.isInteger(hours)
    ? String(hours)
    : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function getRemainingAutoScheduleMinutes(todo) {
  const scheduledMilliseconds = (todo.schedules || []).reduce(
    (total, schedule) => {
      const duration =
        new Date(schedule.scheduledEnd).getTime() -
        new Date(schedule.scheduledStart).getTime();
      return total + Math.max(0, Number.isFinite(duration) ? duration : 0);
    },
    0,
  );
  return Math.max(
    0,
    Number(todo.estimatedMinutes || 0) - scheduledMilliseconds / 60000,
  );
}

// 予定保存後の最新状態から、自動配置候補と残り時間を作り直す
function refreshAutoScheduleCandidates() {
  const select = document.getElementById("autoScheduleTodoSelect");
  const runButton = document.getElementById("autoSchedulePreviewBtn");
  const emptyMessage = document.getElementById("autoScheduleEmpty");
  if (!select || !runButton || !emptyMessage) return;

  if (pendingAutoSchedulePreview) resetAutoSchedulePreview();
  const selectedTodoId = select.value;
  const candidates = (window.scheduleTasks || [])
    .map((todo) => ({
      todo,
      remainingMinutes: getRemainingAutoScheduleMinutes(todo),
    }))
    .filter(
      ({ todo, remainingMinutes }) =>
        !todo.isCompleted &&
        todo.dueDate &&
        Number(todo.estimatedMinutes) > 0 &&
        remainingMinutes > 0 &&
        (!todo.isSplittable || Number(todo.splitMinutes) > 0),
    );

  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "対象タスクを選択";
  select.appendChild(placeholder);

  candidates.forEach(({ todo, remainingMinutes }) => {
    const option = document.createElement("option");
    option.value = String(todo.id);
    const splitSummary =
      todo.isSplittable && todo.splitMinutes
        ? ` / ${formatAutoScheduleHours(todo.splitMinutes)}時間ずつ`
        : "";
    option.textContent = `${todo.title}　⏱ 見積 ${formatAutoScheduleHours(todo.estimatedMinutes)}時間${splitSummary}・残り${formatAutoScheduleHours(remainingMinutes)}時間`;
    select.appendChild(option);
  });

  const selectedStillExists = candidates.some(
    ({ todo }) => String(todo.id) === selectedTodoId,
  );
  select.value = selectedStillExists ? selectedTodoId : "";
  runButton.disabled = candidates.length === 0;
  emptyMessage.classList.toggle("hidden", candidates.length > 0);
}

function openDaySchedule(dateStr) {
  currentScheduleDate = dateStr;
  const overlay = document.getElementById("dayScheduleOverlay");
  const title = document.getElementById("scheduleDateTitle");
  const subtitle = document.getElementById("scheduleDateSubtitle");
  const timeline = document.getElementById("scheduleTimeline");
  const unscheduledTaskList = document.getElementById("unscheduledTaskList");

  if (!overlay || !title || !subtitle || !timeline || !unscheduledTaskList)
    return;

  const selectedTasks = (window.scheduleTasks || [])
    .filter((todo) => {
      if (!todo.dueDate) {
        return true;
      }
      return normalizeDateKey(todo.dueDate) === dateStr;
    })
    .sort((a, b) => {
      const priorityOrder = { 高: 0, 中: 1, 低: 2 };
      const priorityDiff =
        (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
      if (priorityDiff !== 0) return priorityDiff;
      return a.title.localeCompare(b.title, "ja");
    });

  const unassignedTasks = (window.scheduleTasks || []).filter(
    (todo) =>
      !(todo.schedules || []).some(
        (schedule) =>
          normalizeDateKey(schedule.scheduledStart) === dateStr,
      ),
  );
  const overdueTasks = unassignedTasks
    .filter((todo) => {
      const dueDate = normalizeDateKey(todo.dueDate);
      return Boolean(dueDate && dueDate < dateStr);
    })
    .sort((a, b) =>
      normalizeDateKey(a.dueDate).localeCompare(normalizeDateKey(b.dueDate)),
    );
  const unscheduledTasks = unassignedTasks.filter((todo) => {
    const dueDate = normalizeDateKey(todo.dueDate);
    return !dueDate || dueDate >= dateStr;
  });

  title.textContent = `${formatDateLabel(dateStr)} のスケジュール`;
  subtitle.textContent =
    selectedTasks.length > 0
      ? `${selectedTasks.length}件の予定があります`
      : "予定はまだありません";

  renderUnscheduledTasks(unscheduledTasks, dateStr, overdueTasks);

  const scheduledTasks = getScheduledTasksForDate(dateStr);
  setupInteractiveSchedule(dateStr, scheduledTasks);

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function getScheduleTask(taskId) {
  return (window.scheduleTasks || []).find(
    (todo) => String(todo.id) === String(taskId),
  );
}

function getScheduleDurationSlots(todo) {
  if (!todo?.scheduledStart || !todo?.scheduledEnd) return 2;
  const minutes =
    (new Date(todo.scheduledEnd).getTime() -
      new Date(todo.scheduledStart).getTime()) /
    60000;
  return Math.max(1, Math.min(48, Math.round(minutes / 30)));
}

function getScheduleStartSlot(todo) {
  if (!todo?.scheduledStart) return 0;
  const start = new Date(todo.scheduledStart);
  return Math.max(
    0,
    Math.min(47, Math.round((start.getHours() * 60 + start.getMinutes()) / 30)),
  );
}

function calculateScheduleOverlapLayout(tasks) {
  const entries = tasks
    .map((todo, index) => {
      const startSlot = getScheduleStartSlot(todo);
      return {
        todo,
        index,
        startSlot,
        endSlot: Math.min(
          48,
          startSlot + getScheduleDurationSlots(todo),
        ),
        column: 0,
      };
    })
    .sort(
      (a, b) =>
        a.startSlot - b.startSlot ||
        b.endSlot - a.endSlot ||
        a.index - b.index,
    );

  const layouts = new Map();
  let maximumColumns = 1;
  let cluster = [];
  let clusterEndSlot = -1;

  const finishCluster = () => {
    if (cluster.length === 0) return;

    const activeEntries = [];
    let clusterColumns = 1;

    cluster.forEach((entry) => {
      for (let index = activeEntries.length - 1; index >= 0; index -= 1) {
        if (activeEntries[index].endSlot <= entry.startSlot) {
          activeEntries.splice(index, 1);
        }
      }

      const usedColumns = new Set(
        activeEntries.map((activeEntry) => activeEntry.column),
      );
      let column = 0;
      while (usedColumns.has(column)) column += 1;

      entry.column = column;
      activeEntries.push(entry);
      clusterColumns = Math.max(clusterColumns, column + 1);
    });

    cluster.forEach((entry) => {
      layouts.set(String(entry.todo.scheduleId), {
        column: entry.column,
        columnCount: clusterColumns,
      });
    });
    maximumColumns = Math.max(maximumColumns, clusterColumns);
  };

  entries.forEach((entry) => {
    if (cluster.length > 0 && entry.startSlot >= clusterEndSlot) {
      finishCluster();
      cluster = [];
      clusterEndSlot = -1;
    }

    cluster.push(entry);
    clusterEndSlot = Math.max(clusterEndSlot, entry.endSlot);
  });
  finishCluster();

  return { layouts, maximumColumns };
}

function buildScheduleIso(dateStr, slot) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, 0, slot * 30).toISOString();
}

async function persistTaskSchedule(
  taskId,
  startSlot,
  endSlot,
  scheduleId = null,
  dateStr = currentScheduleDate,
) {
  const todo = getScheduleTask(taskId);
  if (!todo || !dateStr) return;

  const isUnscheduled = startSlot === null && endSlot === null;
  const scheduledStart = isUnscheduled
    ? null
    : buildScheduleIso(dateStr, startSlot);
  const scheduledEnd = isUnscheduled
    ? null
    : buildScheduleIso(dateStr, endSlot);

  try {
    const response = await fetch(`/todos/${todo.id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduleId,
        scheduledStart,
        scheduledEnd,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "スケジュールを保存できませんでした");
    }

    todo.schedules = todo.schedules || [];
    if (isUnscheduled) {
      todo.schedules = todo.schedules.filter(
        (schedule) => String(schedule.id) !== String(scheduleId),
      );
    } else {
      const savedSchedule = {
        id: result.scheduleId,
        scheduledStart: result.scheduledStart,
        scheduledEnd: result.scheduledEnd,
      };
      const scheduleIndex = todo.schedules.findIndex(
        (schedule) => String(schedule.id) === String(scheduleId),
      );
      if (scheduleIndex >= 0) {
        todo.schedules[scheduleIndex] = savedSchedule;
      } else {
        todo.schedules.push(savedSchedule);
      }
    }
    refreshScheduleViews();
  } catch (error) {
    alert(error.message);
  }
}

function setupInteractiveSchedule(
  dateStr,
  scheduledTasks,
  {
    timeline = document.getElementById("scheduleTimeline"),
    taskSidebar = document.getElementById("scheduleTaskSidebar"),
    subtitle = document.getElementById("scheduleDateSubtitle"),
  } = {},
) {
  if (!timeline) return;

  if (subtitle) {
    subtitle.textContent =
      scheduledTasks.length > 0
        ? `${scheduledTasks.length}件を配置済みです（30分単位）`
        : taskSidebar
          ? "左のタスクを時間枠へドラッグしてください"
          : "今日の配置済みタスクはありません";
  }

  const rows = Array.from(
    { length: 48 },
    (_, slot) => `
      <div class="schedule-drop-row" data-slot="${slot}">
        <div class="schedule-time">${formatTimeLabel(slot)}</div>
        <div class="schedule-drop-lane"></div>
      </div>
    `,
  ).join("");

  const overlapLayout = calculateScheduleOverlapLayout(scheduledTasks);
  const gridMinimumWidth =
    overlapLayout.maximumColumns >= 4
      ? 76 + overlapLayout.maximumColumns * 160
      : null;

  const taskBlocks = scheduledTasks
    .map((todo) => {
      const startSlot = getScheduleStartSlot(todo);
      const durationSlots = Math.min(
        getScheduleDurationSlots(todo),
        48 - startSlot,
      );
      const layout = overlapLayout.layouts.get(String(todo.scheduleId)) || {
        column: 0,
        columnCount: 1,
      };
      const columnWidth = 100 / layout.columnCount;
      const columnLeft = columnWidth * layout.column;
      const priorityClass =
        todo.priority === "高"
          ? "priority-high"
          : todo.priority === "低"
            ? "priority-low"
            : "priority-normal";
      const completedClass = todo.isCompleted ? "completed" : "";
      const normalizedDueDate = normalizeDateKey(todo.dueDate);
      const dueDateClass =
        normalizedDueDate === dateStr
          ? "due-on-selected-date"
          : normalizedDueDate && normalizedDueDate < dateStr
            ? "overdue-on-selected-date"
            : "";

      return `
        <div class="scheduled-task-block ${priorityClass} ${completedClass} ${dueDateClass}"
             draggable="true"
             data-task-id="${todo.id}"
             data-schedule-id="${todo.scheduleId}"
             data-start-slot="${startSlot}"
             data-duration-slots="${durationSlots}"
             data-overlap-column="${layout.column}"
             data-overlap-columns="${layout.columnCount}"
             style="top:${startSlot * 48 + 2}px;height:${durationSlots * 48 - 4}px;left:calc(${columnLeft}% + 3px);width:calc(${columnWidth}% - 6px)">
          <div class="scheduled-task-time">${formatTimeLabel(startSlot)}〜${formatTimeLabel(startSlot + durationSlots)}</div>
          <div class="scheduled-task-title">${escapeScheduleText(todo.title)}</div>
          <div class="scheduled-task-meta">${escapeScheduleText(todo.categoryName || "分類なし")}</div>
          <button type="button" class="schedule-resize-handle schedule-resize-handle-top" aria-label="開始時刻を変更" title="上下にドラッグして開始時刻を変更"></button>
          <button type="button" class="schedule-resize-handle schedule-resize-handle-bottom" aria-label="終了時刻を変更" title="上下にドラッグして終了時刻を変更"></button>
        </div>
      `;
    })
    .join("");

  timeline.innerHTML = `
    <div class="schedule-grid"${gridMinimumWidth ? ` style="min-width:${gridMinimumWidth}px"` : ""}>
      ${rows}
      <div class="scheduled-task-layer">${taskBlocks}</div>
    </div>
  `;

  timeline.ondragstart = (event) => {
    const block = event.target.closest(".scheduled-task-block");
    if (!block || event.target.closest(".schedule-resize-handle")) {
      event.preventDefault();
      return;
    }
    draggedScheduleTaskId = block.dataset.taskId;
    draggedScheduleId = block.dataset.scheduleId;
    draggedScheduleDurationSlots = Number(block.dataset.durationSlots);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedScheduleTaskId);
    block.classList.add("dragging");
  };
  timeline.ondragend = (event) => {
    event.target.closest(".scheduled-task-block")?.classList.remove("dragging");
  };
  timeline.ondragover = (event) => {
    const row = event.target.closest(".schedule-drop-row");
    if (!row) return;
    event.preventDefault();
    timeline
      .querySelectorAll(".schedule-drop-row.drop-target")
      .forEach((item) => item.classList.remove("drop-target"));
    row.classList.add("drop-target");
  };
  timeline.ondrop = (event) => {
    const row = event.target.closest(".schedule-drop-row");
    if (!row) return;
    event.preventDefault();
    row.classList.remove("drop-target");
    const taskId =
      event.dataTransfer.getData("text/plain") || draggedScheduleTaskId;
    if (!getScheduleTask(taskId)) return;
    const startSlot = Number(row.dataset.slot);
    const endSlot = Math.min(
      48,
      startSlot + (draggedScheduleDurationSlots || 2),
    );
    persistTaskSchedule(
      taskId,
      startSlot,
      endSlot,
      draggedScheduleId,
      dateStr,
    );
  };

  if (taskSidebar) {
    taskSidebar.ondragstart = (event) => {
      const item = event.target.closest(".unscheduled-task-item");
      if (!item) return;
      draggedScheduleTaskId = item.dataset.taskId;
      draggedScheduleId = null;
      draggedScheduleDurationSlots = 2;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedScheduleTaskId);
      item.classList.add("dragging");
    };
    taskSidebar.ondragend = (event) => {
      event.target.closest(".unscheduled-task-item")?.classList.remove("dragging");
    };
    taskSidebar.ondragover = (event) => {
      event.preventDefault();
      taskSidebar.classList.add("drop-target");
    };
    taskSidebar.ondragleave = (event) => {
      if (!taskSidebar.contains(event.relatedTarget)) {
        taskSidebar.classList.remove("drop-target");
      }
    };
    taskSidebar.ondrop = (event) => {
      event.preventDefault();
      taskSidebar.classList.remove("drop-target");
      const taskId =
        event.dataTransfer.getData("text/plain") || draggedScheduleTaskId;
      if (taskId && draggedScheduleId) {
        persistTaskSchedule(
          taskId,
          null,
          null,
          draggedScheduleId,
          dateStr,
        );
      }
    };
  }


  timeline.querySelectorAll(".schedule-resize-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const block = handle.closest(".scheduled-task-block");
      const originalStartSlot = Number(block.dataset.startSlot);
      const originalDuration = Number(block.dataset.durationSlots);
      const originalEndSlot = originalStartSlot + originalDuration;
      const isTopHandle = handle.classList.contains(
        "schedule-resize-handle-top",
      );
      const startY = event.clientY;
      let nextStartSlot = originalStartSlot;
      let nextEndSlot = originalEndSlot;
      let finished = false;

      block.draggable = false;
      block.classList.add("resizing");
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent) => {
        const delta = Math.round((moveEvent.clientY - startY) / 48);
        if (isTopHandle) {
          nextStartSlot = Math.max(
            0,
            Math.min(originalEndSlot - 1, originalStartSlot + delta),
          );
        } else {
          nextEndSlot = Math.max(
            originalStartSlot + 1,
            Math.min(48, originalEndSlot + delta),
          );
        }

        const nextDuration = nextEndSlot - nextStartSlot;
        block.style.top = `${nextStartSlot * 48 + 2}px`;
        block.style.height = `${nextDuration * 48 - 4}px`;
        block.querySelector(".scheduled-task-time").textContent =
          `${formatTimeLabel(nextStartSlot)}〜${formatTimeLabel(nextEndSlot)}`;
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        block.draggable = true;
        block.classList.remove("resizing");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        if (
          nextStartSlot !== originalStartSlot ||
          nextEndSlot !== originalEndSlot
        ) {
          persistTaskSchedule(
            block.dataset.taskId,
            nextStartSlot,
            nextEndSlot,
            block.dataset.scheduleId,
            dateStr,
          );
        }
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
  });
}

function escapeScheduleText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 解析結果の案内を、登録エラーとは別の領域へ表示する
function showTaskAnalysisMessage(message, isError = false) {
  const messageBox = document.getElementById("taskAnalysisMessage");
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.classList.remove("hidden");
  messageBox.classList.toggle("error", isError);
}

// 検証済みの構造化データだけを既存の詳細入力欄へ反映する
function applyParsedTaskToDetailForm(parsedTask) {
  const titleDetail = document.getElementById("titleDetail");
  const dueDateField = document.getElementById("dueDateField");
  const prioritySelect = document.getElementById("prioritySelect");
  const categorySelect = document.getElementById("categorySelect");
  const newCategoryInput = document.getElementById("newCategoryInput");
  const simpleMode = document.getElementById("simpleInputMode");
  const detailMode = document.getElementById("detailInputMode");
  const toggleBtn = document.getElementById("toggleModeBtn");

  if (
    !titleDetail ||
    !dueDateField ||
    !prioritySelect ||
    !categorySelect ||
    !newCategoryInput ||
    !simpleMode ||
    !detailMode ||
    !toggleBtn
  )
    return false;

  titleDetail.value = parsedTask.title;
  dueDateField.value = parsedTask.dueDate || "";
  prioritySelect.value = parsedTask.priority;

  const matchingCategory = Array.from(categorySelect.options).find(
    (option) =>
      option.value !== "指定なし" &&
      option.value !== "__NEW__" &&
      option.textContent.trim() === parsedTask.categoryName,
  );

  if (matchingCategory) {
    categorySelect.value = matchingCategory.value;
    newCategoryInput.value = "";
  } else if (parsedTask.categoryName) {
    // 未登録分類はDBへ保存せず、既存の新規分類入力へ設定する
    categorySelect.value = "__NEW__";
    newCategoryInput.value = parsedTask.categoryName;
  } else {
    categorySelect.value = "指定なし";
    newCategoryInput.value = "";
  }

  handleCategoryChange();
  currentMode = "detail";
  simpleMode.classList.add("hidden");
  detailMode.classList.remove("hidden");
  toggleBtn.innerText = "💬 メモ風に自由に入力する";
  return true;
}

// 自由文を解析し、ユーザーが確認できる詳細入力画面へ切り替える
function analyzeSimpleTaskInput() {
  const titleSimple = document.getElementById("titleSimple");
  const errorBox = document.getElementById("validationErrorBox");
  const sourceText = titleSimple?.value.trim() || "";

  if (!sourceText) {
    if (errorBox) errorBox.classList.remove("hidden");
    showTaskAnalysisMessage("解析する文章を入力してください。", true);
    return false;
  }
  if (!window.TaskTextParser) {
    showTaskAnalysisMessage("解析機能を読み込めませんでした。", true);
    return false;
  }

  const parsedTask = window.TaskTextParser.parse(sourceText);
  const validatedTask = window.TaskTextParser.validate(parsedTask, sourceText);
  if (!validatedTask.title) {
    showTaskAnalysisMessage("タスク名を読み取れませんでした。", true);
    return false;
  }

  if (!applyParsedTaskToDetailForm(validatedTask)) {
    showTaskAnalysisMessage("解析結果を詳細入力へ反映できませんでした。", true);
    return false;
  }

  if (errorBox) errorBox.classList.add("hidden");
  showTaskAnalysisMessage(
    "解析結果を詳細入力へ反映しました。内容を確認・修正してから「タスクを追加」を押してください。",
  );
  return true;
}

function showAutoScheduleMessage(message, isError = false) {
  const messageBox = document.getElementById("autoScheduleMessage");
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.classList.remove("hidden");
  messageBox.classList.toggle("error", isError);
}

function resetAutoSchedulePreview() {
  const previewToDiscard = pendingAutoSchedulePreview;
  pendingAutoSchedulePreview = null;
  if (previewToDiscard?.previewId) {
    fetch(`/todos/${previewToDiscard.todoId}/auto-schedule/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previewId: previewToDiscard.previewId }),
    }).catch(() => {});
  }
  const preview = document.getElementById("autoSchedulePreview");
  const list = document.getElementById("autoSchedulePreviewList");
  const messageBox = document.getElementById("autoScheduleMessage");
  if (preview) preview.classList.add("hidden");
  if (list) list.innerHTML = "";
  if (messageBox) messageBox.classList.add("hidden");
}

async function executeAutoSchedulePreview() {
  const select = document.getElementById("autoScheduleTodoSelect");
  const runButton = document.getElementById("autoSchedulePreviewBtn");
  const todoId = select?.value;
  if (!todoId) {
    showAutoScheduleMessage("対象タスクを選択してください。", true);
    return;
  }

  resetAutoSchedulePreview();
  if (runButton) runButton.disabled = true;
  try {
    const response = await fetch(`/todos/${todoId}/auto-schedule/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "自動配置のプレビューを作成できませんでした");
    }

    pendingAutoSchedulePreview = result;
    const preview = document.getElementById("autoSchedulePreview");
    const list = document.getElementById("autoSchedulePreviewList");
    if (list) {
      list.innerHTML = "";
      result.placements.forEach((placement) => {
        const item = document.createElement("li");
        item.textContent = placement.label;
        list.appendChild(item);
      });
    }
    if (preview) preview.classList.remove("hidden");
    showAutoScheduleMessage(
      `${result.todoTitle} の配置候補を作成しました。確定するまで保存されません。`,
    );
  } catch (error) {
    showAutoScheduleMessage(error.message, true);
  } finally {
    if (runButton) runButton.disabled = false;
  }
}

async function confirmAutoSchedule() {
  if (!pendingAutoSchedulePreview) return;

  const confirmButton = document.querySelector(".auto-schedule-confirm-btn");
  if (confirmButton) confirmButton.disabled = true;
  try {
    const response = await fetch(
      `/todos/${pendingAutoSchedulePreview.todoId}/auto-schedule/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewId: pendingAutoSchedulePreview.previewId,
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "自動配置を確定できませんでした");
    }

    pendingAutoSchedulePreview = null;
    showAutoScheduleMessage("自動配置を保存しました。");
    window.location.href = "/?view=calendar";
  } catch (error) {
    showAutoScheduleMessage(error.message, true);
    if (confirmButton) confirmButton.disabled = false;
  }
}

function cancelAutoSchedulePreview() {
  resetAutoSchedulePreview();
  showAutoScheduleMessage("自動配置のプレビューをキャンセルしました。");
}

function closeDaySchedule() {
  const overlay = document.getElementById("dayScheduleOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
}

const AUTO_PLACEMENT_CONSISTENCY_MESSAGES = {
  splitExceedsEstimate:
    "1回あたりの時間は、見積時間以下にしてください。",
  splitExceedsDailyLimit:
    "1回あたりの時間は、1日の実施時間上限以下にしてください。",
};

// 見積未設定・分割不可は対象外とし、該当する整合性エラーをすべて返す。
function getAutoPlacementConsistencyErrors(form) {
  const estimatedHours = form.querySelector('input[name="estimatedHours"]');
  const isSplittable = form.querySelector('select[name="isSplittable"]');
  const splitHours = form.querySelector('input[name="splitHours"]');
  const dailyLimitHours = form.querySelector(
    'input[name="dailyLimitHours"]',
  );
  if (
    !estimatedHours ||
    estimatedHours.value.trim() === "" ||
    isSplittable?.value !== "true" ||
    !splitHours ||
    !dailyLimitHours
  ) {
    return [];
  }

  const estimatedValue = Number(estimatedHours.value);
  const splitValue = Number(splitHours.value);
  const dailyLimitValue = Number(dailyLimitHours.value);
  if (
    !Number.isFinite(estimatedValue) ||
    !Number.isFinite(splitValue) ||
    !Number.isFinite(dailyLimitValue)
  ) {
    return [];
  }

  const errors = [];
  if (splitValue > estimatedValue) errors.push("splitExceedsEstimate");
  if (splitValue > dailyLimitValue) {
    errors.push("splitExceedsDailyLimit");
  }
  return errors;
}

function parseOptionalHours(value) {
  if (String(value ?? "").trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 変更項目を1つずつ保存値へ戻したとき、違反が解消する項目だけを抽出する。
function getConsistencyRollbackInputNames(form, consistencyErrors) {
  const submitted = {
    estimatedHours: parseOptionalHours(
      form.querySelector('input[name="estimatedHours"]')?.value,
    ),
    splitHours: parseOptionalHours(
      form.querySelector('input[name="splitHours"]')?.value,
    ),
    dailyLimitHours: parseOptionalHours(
      form.querySelector('input[name="dailyLimitHours"]')?.value,
    ),
  };
  const saved = {
    estimatedHours: parseOptionalHours(form.dataset.savedEstimatedHours),
    splitHours: parseOptionalHours(form.dataset.savedSplitHours),
    dailyLimitHours: parseOptionalHours(form.dataset.savedDailyLimitHours),
  };
  const changed = (field) => submitted[field] !== saved[field];
  const resolves = (leftValue, rightValue) =>
    leftValue === null || rightValue === null || leftValue <= rightValue;
  const rollbackFields = new Set();

  const collectCauses = (leftField, rightField) => {
    const leftChanged = changed(leftField);
    const rightChanged = changed(rightField);
    const revertingLeftResolves =
      leftChanged && resolves(saved[leftField], submitted[rightField]);
    const revertingRightResolves =
      rightChanged && resolves(submitted[leftField], saved[rightField]);
    if (revertingLeftResolves) rollbackFields.add(leftField);
    if (revertingRightResolves) rollbackFields.add(rightField);
    if (
      !revertingLeftResolves &&
      !revertingRightResolves &&
      leftChanged &&
      rightChanged
    ) {
      rollbackFields.add(leftField);
      rollbackFields.add(rightField);
    }
  };

  if (consistencyErrors.includes("splitExceedsEstimate")) {
    collectCauses("splitHours", "estimatedHours");
  }
  if (consistencyErrors.includes("splitExceedsDailyLimit")) {
    collectCauses("splitHours", "dailyLimitHours");
  }
  return rollbackFields;
}

function showAutoPlacementValidationErrors(errorBox, consistencyErrors) {
  const message = errorBox?.querySelector("span:last-child");
  const messages = consistencyErrors.map(
    (errorType) => AUTO_PLACEMENT_CONSISTENCY_MESSAGES[errorType],
  );
  if (message) {
    message.textContent =
      messages.length > 1
        ? messages.map((item) => `・${item}`).join("\n")
        : messages[0] || "";
  }
  errorBox?.classList.remove("hidden");
}

window.addEventListener("DOMContentLoaded", () => {
  restoreTaskFilterState();
  switchView(window.initialView || "today");
  handleCategoryChange();
  renderTodaySchedule();

  const analyzeSimpleTaskBtn = document.getElementById("analyzeSimpleTaskBtn");
  if (analyzeSimpleTaskBtn) {
    analyzeSimpleTaskBtn.addEventListener("click", analyzeSimpleTaskInput);
  }

  const todoForm = document.getElementById("todoForm");
  if (todoForm) {
    todoForm.addEventListener("submit", function (e) {
      const errorBox = document.getElementById("validationErrorBox");
      const viewInput = document.getElementById("viewInput");
      const titleSimple = document.getElementById("titleSimple");
      const titleDetail = document.getElementById("titleDetail");
      let isFormEmpty = false;

      if (viewInput) {
        viewInput.value = currentView;
      }

      if (currentMode === "simple") {
        if (titleSimple.value.trim() === "") {
          isFormEmpty = true;
        } else {
          // 自由入力時は即登録せず、解析結果の確認を必須にする
          e.preventDefault();
          errorBox.classList.add("hidden");
          analyzeSimpleTaskInput();
          return;
        }
      } else if (titleDetail.value.trim() === "") {
        isFormEmpty = true;
      }

      const consistencyErrors =
        getAutoPlacementConsistencyErrors(todoForm);
      if (!isFormEmpty && consistencyErrors.length > 0) {
        e.preventDefault();
        showAutoPlacementValidationErrors(errorBox, consistencyErrors);
        window.scrollTo({ top: errorBox.offsetTop - 20, behavior: "smooth" });
        return;
      }

      if (isFormEmpty) {
        e.preventDefault();
        errorBox.classList.remove("hidden");
        window.scrollTo({ top: errorBox.offsetTop - 20, behavior: "smooth" });
      } else {
        errorBox.classList.add("hidden");
      }
    });
  }

  document.querySelectorAll(".auto-placement-editor-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      const consistencyErrors = getAutoPlacementConsistencyErrors(form);
      if (consistencyErrors.length === 0) return;

      event.preventDefault();
      const rollbackFields = getConsistencyRollbackInputNames(
        form,
        consistencyErrors,
      );
      const inputs = {
        estimatedHours: form.querySelector('input[name="estimatedHours"]'),
        splitHours: form.querySelector('input[name="splitHours"]'),
        dailyLimitHours: form.querySelector(
          'input[name="dailyLimitHours"]',
        ),
      };
      const savedDatasetKeys = {
        estimatedHours: "savedEstimatedHours",
        splitHours: "savedSplitHours",
        dailyLimitHours: "savedDailyLimitHours",
      };
      for (const field of rollbackFields) {
        if (inputs[field]) {
          inputs[field].value = form.dataset[savedDatasetKeys[field]] || "";
        }
      }
      const errorBox = document.getElementById(form.dataset.errorTarget);
      showAutoPlacementValidationErrors(errorBox, consistencyErrors);
      errorBox?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  const overlay = document.getElementById("dayScheduleOverlay");
  const closeBtn = document.getElementById("closeDayScheduleBtn");
  if (overlay) {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeDaySchedule();
      }
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeDaySchedule);
  }
});

// 💡 【機能維持】全体リセット
function resetWholeForm() {
  document.getElementById("validationErrorBox").classList.add("hidden");
  const analysisMessage = document.getElementById("taskAnalysisMessage");
  if (analysisMessage) analysisMessage.classList.add("hidden");
  document.getElementById("titleSimple").value = "";
  document.getElementById("titleDetail").value = "";
  document.getElementById("dueDateField").value = "";
  document.getElementById("newCategoryInput").value = "";
  document.getElementById("prioritySelect").value = "中";
  const estimatedHoursField = document.getElementById("estimatedHoursField");
  const isSplittableField = document.getElementById("isSplittableField");
  const splitHoursField = document.getElementById("splitHoursField");
  const dailyLimitHoursField = document.getElementById("dailyLimitHoursField");
  if (estimatedHoursField) estimatedHoursField.value = "";
  if (isSplittableField) isSplittableField.value = "false";
  if (splitHoursField) splitHoursField.value = "1";
  if (dailyLimitHoursField) dailyLimitHoursField.value = "2";
  updateSplitEstimateVisibility(
    "isSplittableField",
    "splitHoursGroup",
    "splitHoursField",
    "dailyLimitHoursGroup",
    "dailyLimitHoursField",
  );
  const catSelect = document.getElementById("categorySelect");
  catSelect.value = "指定なし";
  handleCategoryChange();
}

// 💡 【機能維持】一覧内のインラインカテゴリ変更
function handleInlineCategoryChange(selectElem, todoId) {
  if (selectElem.value === "__INLINE_NEW__") {
    document.getElementById(`catForm-${todoId}`).classList.add("hidden");
    const inputForm = document.getElementById(`newCatForm-${todoId}`);
    inputForm.classList.remove("hidden");
    inputForm.querySelector('input[type="text"]').focus();
  } else {
    selectElem.form.submit();
  }
}

function cancelInlineCategory(todoId) {
  setTimeout(() => {
    const selectForm = document.getElementById(`catForm-${todoId}`);
    const inputForm = document.getElementById(`newCatForm-${todoId}`);
    if (inputForm.querySelector('input[type="text"]').value.trim() === "") {
      inputForm.classList.add("hidden");
      selectForm.classList.remove("hidden");
      selectForm.querySelector("select").value = "指定なし";
    } else {
      inputForm.submit();
    }
  }, 200);
}

// 分割可否に応じて、分割時だけ必要な2つの時間設定をまとめて切り替える
function updateSplitEstimateVisibility(
  selectId,
  groupId,
  inputId,
  dailyLimitGroupId,
  dailyLimitInputId,
) {
  const select = document.getElementById(selectId);
  const group = document.getElementById(groupId);
  const input = document.getElementById(inputId);
  if (!select || !group || !input) return;

  const dailyLimitGroup = dailyLimitGroupId
    ? document.getElementById(dailyLimitGroupId)
    : null;
  const dailyLimitInput = dailyLimitInputId
    ? document.getElementById(dailyLimitInputId)
    : null;
  const isSplittable = select.value === "true";
  group.classList.toggle("hidden", !isSplittable);
  input.disabled = !isSplittable;
  input.required = isSplittable;
  if (dailyLimitGroup) {
    dailyLimitGroup.classList.toggle("hidden", !isSplittable);
  }
  if (dailyLimitInput) {
    dailyLimitInput.disabled = !isSplittable;
    dailyLimitInput.required = isSplittable;
  }

  // 新しく分割可へ切り替えたときだけ、推奨初期値を補う。
  if (isSplittable && input.value === "") input.value = "1";
  if (isSplittable && dailyLimitInput?.value === "") {
    dailyLimitInput.value = "2";
  }
}

function toggleAutoPlacementEditor(todoId) {
  const editorId = `autoPlacementEditor-${todoId}`;
  const editor = document.getElementById(editorId);
  if (!editor) return;

  const willOpen = editor.classList.contains("hidden");
  document.querySelectorAll(".auto-placement-editor").forEach((item) => {
    item.classList.add("hidden");
  });
  document.querySelectorAll(".auto-placement-summary").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });

  if (willOpen) {
    editor.classList.remove("hidden");
    const button = document.querySelector(`[aria-controls="${editorId}"]`);
    if (button) button.setAttribute("aria-expanded", "true");
    const firstInput = editor.querySelector('input[name="estimatedHours"]');
    if (firstInput) firstInput.focus();
  }
}

function cancelAutoPlacementEditor(todoId) {
  const editor = document.getElementById(`autoPlacementEditor-${todoId}`);
  if (!editor) return;

  const form = editor.querySelector("form");
  if (form) {
    form.reset();
    updateSplitEstimateVisibility(
      `todoSplittable-${todoId}`,
      `todoSplitHoursGroup-${todoId}`,
      `todoSplitHours-${todoId}`,
      `todoDailyLimitHoursGroup-${todoId}`,
      `todoDailyLimitHours-${todoId}`,
    );
  }
  editor.classList.add("hidden");
  const button = document.querySelector(
    `[aria-controls="autoPlacementEditor-${todoId}"]`,
  );
  if (button) button.setAttribute("aria-expanded", "false");
}

// DBへ保存せず、この編集領域の入力値だけを初期設定へ戻す
function resetAutoPlacementEditor(todoId) {
  const editor = document.getElementById(`autoPlacementEditor-${todoId}`);
  if (!editor) return;

  const estimatedHours = editor.querySelector(
    'input[name="estimatedHours"]',
  );
  const isSplittable = document.getElementById(`todoSplittable-${todoId}`);
  const splitHours = document.getElementById(`todoSplitHours-${todoId}`);
  const dailyLimitHours = document.getElementById(
    `todoDailyLimitHours-${todoId}`,
  );
  if (!estimatedHours || !isSplittable || !splitHours || !dailyLimitHours) {
    return;
  }

  estimatedHours.value = "";
  isSplittable.value = "false";
  splitHours.value = "";
  dailyLimitHours.value = "";
  updateSplitEstimateVisibility(
    `todoSplittable-${todoId}`,
    `todoSplitHoursGroup-${todoId}`,
    `todoSplitHours-${todoId}`,
    `todoDailyLimitHoursGroup-${todoId}`,
    `todoDailyLimitHours-${todoId}`,
  );
  estimatedHours.focus();
}

// 💡 【機能維持】カテゴリ別フィルター＆キーワード爆速検索
function toggleCategoryFilter(btn) {
  btn.classList.toggle("off");
  btn.querySelector(".check-mark").innerText = btn.classList.contains("off")
    ? ""
    : "✓";
  applyFilters();
}

// タスク編集後の再読み込みでも、現在の絞り込み条件を維持する
const TASK_FILTER_STORAGE_KEY = "task-list-filter-state";

function saveTaskFilterState(searchValue, categoryButtons) {
  try {
    const disabledCategoryIds = Array.from(categoryButtons)
      .filter((btn) => btn.classList.contains("off"))
      .map((btn) => btn.getAttribute("data-category-id"))
      .filter(Boolean);

    window.sessionStorage.setItem(
      TASK_FILTER_STORAGE_KEY,
      JSON.stringify({ searchValue, disabledCategoryIds }),
    );
  } catch (error) {
    console.warn("絞り込み条件を保存できませんでした:", error);
  }
}

function restoreTaskFilterState() {
  const searchInput = document.getElementById("taskSearchInput");
  const categoryButtons = document.querySelectorAll(".category-btn");
  if (!searchInput) return;

  try {
    const storedState = window.sessionStorage.getItem(TASK_FILTER_STORAGE_KEY);
    if (storedState) {
      const parsedState = JSON.parse(storedState);
      const disabledCategoryIds = Array.isArray(
        parsedState?.disabledCategoryIds,
      )
        ? parsedState.disabledCategoryIds.filter(
            (categoryId) => typeof categoryId === "string",
          )
        : [];

      searchInput.value =
        typeof parsedState?.searchValue === "string"
          ? parsedState.searchValue
          : "";
      categoryButtons.forEach((btn) => {
        const isDisabled = disabledCategoryIds.includes(
          btn.getAttribute("data-category-id"),
        );
        btn.classList.toggle("off", isDisabled);
        const checkMark = btn.querySelector(".check-mark");
        if (checkMark) checkMark.innerText = isDisabled ? "" : "✓";
      });
    }
  } catch (error) {
    console.warn("絞り込み条件を復元できませんでした:", error);
    window.sessionStorage.removeItem(TASK_FILTER_STORAGE_KEY);
  }

  applyFilters();
}

function toggleMasterFilter() {
  const masterBtn = document.getElementById("masterFilterBtn");
  const categoryButtons = document.querySelectorAll(".category-btn");
  const turnOff = !masterBtn.classList.contains("off");
  masterBtn.classList.toggle("off", turnOff);
  masterBtn.querySelector(".icon").innerText = turnOff ? "❌" : "📄";
  categoryButtons.forEach((btn) => {
    btn.classList.toggle("off", turnOff);
    btn.querySelector(".check-mark").innerText = turnOff ? "" : "✓";
  });
  applyFilters();
}

function applyFilters() {
  const masterBtn = document.getElementById("masterFilterBtn");
  const categoryButtons = document.querySelectorAll(".category-btn");
  const todoItems = document.querySelectorAll(".todo-item");
  const searchInput = document.getElementById("taskSearchInput");
  const searchValue = searchInput ? searchInput.value : "";
  const searchWord = searchValue.toLowerCase().trim();
  const activeCategoryIds = [];

  if (categoryButtons.length > 0) {
    categoryButtons.forEach((btn) => {
      if (!btn.classList.contains("off"))
        activeCategoryIds.push(btn.getAttribute("data-category-id"));
    });
    if (masterBtn) {
      if (activeCategoryIds.length === categoryButtons.length) {
        masterBtn.classList.remove("off");
        masterBtn.querySelector(".icon").innerText = "📄";
      } else if (activeCategoryIds.length === 0) {
        masterBtn.classList.add("off");
        masterBtn.querySelector(".icon").innerText = "❌";
      } else {
        masterBtn.classList.add("off");
        masterBtn.querySelector(".icon").innerText = "➖";
      }
    }
  }

  todoItems.forEach((item) => {
    const isCategoryMatch =
      categoryButtons.length === 0 ||
      activeCategoryIds.includes(item.getAttribute("data-cat"));
    const isSearchMatch =
      searchWord === "" || item.getAttribute("data-title").includes(searchWord);
    item.classList.toggle("hidden", !(isCategoryMatch && isSearchMatch));
  });

  let visibleTodoCount = 0;
  document.querySelectorAll(".todo-category-column").forEach((column) => {
    const visibleItems = Array.from(column.querySelectorAll(".todo-item")).filter(
      (item) => !item.classList.contains("hidden"),
    );
    const count = column.querySelector(".todo-category-visible-count");
    if (count) {
      count.textContent = String(visibleItems.length);
    }
    visibleTodoCount += visibleItems.length;
    column.classList.toggle("hidden", visibleItems.length === 0);
  });

  const emptyState = document.getElementById("todoFilterEmptyState");
  if (emptyState) {
    emptyState.classList.toggle(
      "hidden",
      todoItems.length === 0 || visibleTodoCount > 0,
    );
  }

  saveTaskFilterState(searchValue, categoryButtons);
}

// 💡 【機能維持】メモ風入力 ↔ 詳細入力の切り替え
function toggleInputMode() {
  const analysisMessage = document.getElementById("taskAnalysisMessage");
  if (analysisMessage) analysisMessage.classList.add("hidden");
  const toggleBtn = document.getElementById("toggleModeBtn");
  const simpleMode = document.getElementById("simpleInputMode");
  const detailMode = document.getElementById("detailInputMode");
  const titleSimple = document.getElementById("titleSimple");
  const titleDetail = document.getElementById("titleDetail");

  currentMode = currentMode === "detail" ? "simple" : "detail";
  toggleBtn.innerText =
    currentMode === "detail"
      ? "💬 メモ風に自由に入力する"
      : "📋 詳細に項目を指定して入力する";
  detailMode.classList.toggle("hidden", currentMode === "simple");
  simpleMode.classList.toggle("hidden", currentMode === "detail");
  if (currentMode === "simple") titleSimple.value = titleDetail.value;
  else titleDetail.value = titleSimple.value;
}

// 💡 【機能維持】タスク追加フォームのカテゴリ選択肢連動＆削除
function handleCategoryChange() {
  const select = document.getElementById("categorySelect");
  const newWrapper = document.getElementById("newCategoryWrapper");
  const deleteBtn = document.getElementById("deleteCategoryBtn");
  if (select && newWrapper && deleteBtn) {
    newWrapper.classList.toggle("hidden", select.value !== "__NEW__");
    deleteBtn.classList.toggle(
      "hidden",
      select.value === "指定なし" || select.value === "__NEW__",
    );
  }
}

function deleteSelectedCategory() {
  const select = document.getElementById("categorySelect");
  const form = document.getElementById("todoForm");
  if (confirm("この分類を選択肢から削除しますか？")) {
    form.action = "/categories/" + select.value + "/hide";
    form.submit();
  }
}
