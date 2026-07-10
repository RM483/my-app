/* public/js/app.js */

// グローバルで管理するカレンダーインスタンス
let calendar = null;
let currentMode = "detail";
let currentView = "list";

// 💡 【機能維持】画面の表示切り替えロジック
function switchView(viewName) {
  const normalizedView = viewName === "calendar" ? "calendar" : "list";
  const listViewArea = document.getElementById("listViewArea");
  const calendarViewArea = document.getElementById("calendarViewArea");
  const listViewBtn = document.getElementById("listViewBtn");
  const calendarViewBtn = document.getElementById("calendarViewBtn");

  currentView = normalizedView;

  if (normalizedView === "list") {
    listViewArea.classList.remove("hidden");
    calendarViewArea.classList.add("hidden");
    listViewBtn.classList.add("active");
    calendarViewBtn.classList.remove("active");
  } else {
    listViewArea.classList.add("hidden");
    calendarViewArea.classList.remove("hidden");
    listViewBtn.classList.remove("active");
    calendarViewBtn.classList.add("active");
    if (calendar) {
      calendar.render();
    }
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

function openDaySchedule(dateStr) {
  const overlay = document.getElementById("dayScheduleOverlay");
  const title = document.getElementById("scheduleDateTitle");
  const subtitle = document.getElementById("scheduleDateSubtitle");
  const timeline = document.getElementById("scheduleTimeline");

  if (!overlay || !title || !subtitle || !timeline) return;

  const selectedTasks = (window.scheduleTasks || [])
    .filter((todo) => todo.dueDate && todo.dueDate.slice(0, 10) === dateStr)
    .sort((a, b) => {
      const priorityOrder = { 高: 0, 中: 1, 低: 2 };
      const priorityDiff =
        (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
      if (priorityDiff !== 0) return priorityDiff;
      return a.title.localeCompare(b.title, "ja");
    });

  title.textContent = `${formatDateLabel(dateStr)} のスケジュール`;
  subtitle.textContent =
    selectedTasks.length > 0
      ? `${selectedTasks.length}件の予定があります`
      : "予定はまだありません";

  const slots = Array.from({ length: 48 }, (_, index) => ({
    time: formatTimeLabel(index),
    items: [],
  }));

  selectedTasks.forEach((todo, index) => {
    const slotIndex = index % 48;
    slots[slotIndex].items.push(todo);
  });

  timeline.innerHTML = slots
    .map((slot) => {
      if (slot.items.length === 0) {
        return `
          <div class="schedule-slot">
            <div class="schedule-time">${slot.time}</div>
            <div class="schedule-item-list">
              <div class="schedule-item-empty">予定なし</div>
            </div>
          </div>
        `;
      }

      return `
        <div class="schedule-slot">
          <div class="schedule-time">${slot.time}</div>
          <div class="schedule-item-list">
            ${slot.items
              .map((todo) => {
                const priorityClass =
                  todo.priority === "高"
                    ? "priority-high"
                    : todo.priority === "低"
                      ? "priority-low"
                      : "priority-normal";
                const doneClass = todo.isCompleted ? "completed" : "";
                return `
                  <div class="schedule-item ${priorityClass} ${doneClass}">
                    <div class="schedule-item-title">${todo.title}</div>
                    <div class="schedule-item-meta">${todo.categoryName || "分類なし"}</div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function closeDaySchedule() {
  const overlay = document.getElementById("dayScheduleOverlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  switchView(window.initialView || "list");
  handleCategoryChange();

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
          titleDetail.value = titleSimple.value;
        }
      } else {
        if (titleDetail.value.trim() === "") {
          isFormEmpty = true;
        }
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
  const searchWord = searchInput ? searchInput.value.toLowerCase().trim() : "";
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
}

// 💡 【機能維持】メモ風入力 ↔ 詳細入力の切り替え
function toggleInputMode() {
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
