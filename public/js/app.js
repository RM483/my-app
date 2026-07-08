/* public/js/app.js */

// グローバルで管理するカレンダーインスタンス
let calendar = null;
let currentMode = "detail";

// 💡 【機能維持】画面の表示切り替えロジック
function switchView(viewName) {
  const listViewArea = document.getElementById("listViewArea");
  const calendarViewArea = document.getElementById("calendarViewArea");
  const listViewBtn = document.getElementById("listViewBtn");
  const calendarViewBtn = document.getElementById("calendarViewBtn");

  if (viewName === "list") {
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
}

// 💡 【機能維持】バリデーションロジック
window.addEventListener("DOMContentLoaded", () => {
  const todoForm = document.getElementById("todoForm");
  if (todoForm) {
    todoForm.addEventListener("submit", function (e) {
      const errorBox = document.getElementById("validationErrorBox");
      const titleSimple = document.getElementById("titleSimple");
      const titleDetail = document.getElementById("titleDetail");
      let isFormEmpty = false;

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
