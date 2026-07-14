function createTimeRangeRow(weekday, dayName) {
  const row = document.createElement("div");
  row.className = "availability-time-range";

  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.name = `start-${weekday}`;
  startInput.required = true;
  startInput.setAttribute("aria-label", `${dayName}の開始時刻`);

  const separator = document.createElement("span");
  separator.className = "availability-time-separator";
  separator.textContent = "〜";

  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.name = `end-${weekday}`;
  endInput.required = true;
  endInput.setAttribute("aria-label", `${dayName}の終了時刻`);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "availability-remove-btn";
  removeButton.textContent = "削除";
  removeButton.addEventListener("click", () => removeTimeRange(removeButton));

  row.append(startInput, separator, endInput, removeButton);
  return row;
}

function addTimeRange(weekday, dayName) {
  const list = document.getElementById(`ranges-list-${weekday}`);
  if (!list) return;

  const row = createTimeRangeRow(weekday, dayName);
  list.appendChild(row);
  row.querySelector('input[type="time"]').focus();
}

function removeTimeRange(button) {
  const row = button.closest(".availability-time-range");
  if (row) row.remove();
}

function toggleDayAvailability(weekday) {
  const select = document.getElementById(`enabled-${weekday}`);
  const editor = document.getElementById(`ranges-editor-${weekday}`);
  const disabledMark = document.getElementById(`ranges-disabled-${weekday}`);
  const list = document.getElementById(`ranges-list-${weekday}`);
  if (!select || !editor || !disabledMark || !list) return;

  const isEnabled = select.value === "true";
  editor.classList.toggle("hidden", !isEnabled);
  disabledMark.classList.toggle("hidden", isEnabled);
  editor.querySelectorAll('input[type="time"]').forEach((input) => {
    input.disabled = !isEnabled;
  });

  if (isEnabled && list.children.length === 0) {
    const dayName =
      select.closest(".availability-day-row")
        ?.querySelector(".availability-weekday")
        ?.textContent?.trim() || "曜日";
    addTimeRange(weekday, dayName);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".availability-day-row").forEach((row) => {
    toggleDayAvailability(row.getAttribute("data-weekday"));
  });
});
