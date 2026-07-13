/* public/js/app.js */

// グローバルで管理するカレンダーインスタンス
let calendar = null;
let currentMode = "detail";
let currentView = "today";
let currentScheduleDate = null;
let draggedScheduleTaskId = null;
let draggedScheduleId = null;
let draggedScheduleDurationSlots = 2;

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

function closeDaySchedule() {
  const overlay = document.getElementById("dayScheduleOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
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

      if (isFormEmpty) {
        e.preventDefault();
        errorBox.classList.remove("hidden");
        window.scrollTo({ top: errorBox.offsetTop - 20, behavior: "smooth" });
      } else {
        errorBox.classList.add("hidden");
      }
    });
  }

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
