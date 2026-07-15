import type express from "express";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "./generated/prisma/client";
import { ensureDefaultUserSettings } from "./user-settings";

const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const DEFAULT_USER_KEY = "default";
const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

type AutoScheduleDatabase = Pick<
  PrismaClient,
  "todo" | "todoSchedule" | "userSetting"
>;

type Placement = {
  scheduledStart: Date;
  scheduledEnd: Date;
};

type StoredAutoSchedulePreview = {
  previewId: string;
  todoId: number;
  placements: Placement[];
  createdAt: number;
};

const storedPreviews = new Map<string, StoredAutoSchedulePreview>();

// 現在保存されている全配置の長さを見積時間から差し引く
export function calculateRemainingMinutes(
  estimatedMinutes: number | null | undefined,
  schedules: Placement[],
) {
  if (!estimatedMinutes || estimatedMinutes <= 0) return 0;

  const scheduledMilliseconds = schedules.reduce((total, schedule) => {
    const duration =
      schedule.scheduledEnd.getTime() - schedule.scheduledStart.getTime();
    return total + Math.max(0, duration);
  }, 0);

  return Math.max(0, estimatedMinutes - scheduledMilliseconds / 60000);
}

class AutoScheduleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function getJapanDateParts(value: Date) {
  const shifted = new Date(value.getTime() + JAPAN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function startOfJapanDay(value: Date) {
  const parts = getJapanDateParts(value);
  return new Date(
    Date.UTC(parts.year, parts.month, parts.date) - JAPAN_OFFSET_MS,
  );
}

function addJapanDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function dateAtMinute(day: Date, minute: number) {
  return new Date(day.getTime() + minute * 60 * 1000);
}

function alignUpToHalfHour(value: Date) {
  return new Date(Math.ceil(value.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS);
}

function alignDownToHalfHour(value: Date) {
  return new Date(Math.floor(value.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS);
}

function overlaps(start: Date, end: Date, busy: Placement) {
  return start < busy.scheduledEnd && end > busy.scheduledStart;
}

// 日本時間の日付ごとに、同じタスクがすでに配置されている時間を集計する
function calculateScheduledMinutesByJapanDay(schedules: Placement[]) {
  const minutesByDay = new Map<number, number>();

  for (const schedule of schedules) {
    if (schedule.scheduledEnd <= schedule.scheduledStart) continue;

    for (
      let day = startOfJapanDay(schedule.scheduledStart);
      day < schedule.scheduledEnd;
      day = addJapanDays(day, 1)
    ) {
      const nextDay = addJapanDays(day, 1);
      const overlapStart = Math.max(
        schedule.scheduledStart.getTime(),
        day.getTime(),
      );
      const overlapEnd = Math.min(
        schedule.scheduledEnd.getTime(),
        nextDay.getTime(),
      );
      if (overlapStart >= overlapEnd) continue;

      const dayKey = day.getTime();
      const durationMinutes = (overlapEnd - overlapStart) / 60000;
      minutesByDay.set(
        dayKey,
        (minutesByDay.get(dayKey) ?? 0) + durationMinutes,
      );
    }
  }

  return minutesByDay;
}

function findEarliestSlot(
  durationMinutes: number,
  windows: Placement[],
  busyPeriods: Placement[],
) {
  const durationMs = durationMinutes * 60 * 1000;

  for (const window of windows) {
    let candidateStart = alignUpToHalfHour(window.scheduledStart);
    const windowEnd = alignDownToHalfHour(window.scheduledEnd);

    while (candidateStart.getTime() + durationMs <= windowEnd.getTime()) {
      const candidateEnd = new Date(candidateStart.getTime() + durationMs);
      const conflict = busyPeriods
        .filter((busy) => overlaps(candidateStart, candidateEnd, busy))
        .sort(
          (a, b) =>
            a.scheduledEnd.getTime() - b.scheduledEnd.getTime(),
        )[0];

      if (!conflict) {
        return { scheduledStart: candidateStart, scheduledEnd: candidateEnd };
      }

      candidateStart = alignUpToHalfHour(
        new Date(
          Math.max(
            candidateStart.getTime() + HALF_HOUR_MS,
            conflict.scheduledEnd.getTime(),
          ),
        ),
      );
    }
  }

  return null;
}

function serializePlacement(placement: Placement, index: number) {
  return {
    order: index + 1,
    scheduledStart: placement.scheduledStart.toISOString(),
    scheduledEnd: placement.scheduledEnd.toISOString(),
    label: formatPlacementLabel(placement),
  };
}

function formatPlacementLabel(placement: Placement) {
  const start = getJapanDateParts(placement.scheduledStart);
  const end = getJapanDateParts(placement.scheduledEnd);
  const startTime = `${String(start.hour).padStart(2, "0")}:${String(
    start.minute,
  ).padStart(2, "0")}`;
  const endTime = `${String(end.hour).padStart(2, "0")}:${String(
    end.minute,
  ).padStart(2, "0")}`;
  return `${start.month + 1}月${start.date}日（${
    WEEKDAY_NAMES[start.weekday]
  }） ${startTime}〜${endTime}`;
}

function removeExpiredPreviews() {
  const expiresBefore = Date.now() - PREVIEW_TTL_MS;
  for (const [previewId, preview] of storedPreviews) {
    if (preview.createdAt < expiresBefore) storedPreviews.delete(previewId);
  }
}

function storePreview(todoId: number, placements: Placement[]) {
  removeExpiredPreviews();
  const previewId = randomUUID();
  storedPreviews.set(previewId, {
    previewId,
    todoId,
    placements: placements.map((placement) => ({
      scheduledStart: new Date(placement.scheduledStart),
      scheduledEnd: new Date(placement.scheduledEnd),
    })),
    createdAt: Date.now(),
  });
  return previewId;
}

async function calculateAutoSchedule(
  database: AutoScheduleDatabase,
  todoId: number,
  now = new Date(),
) {
  const todo = await database.todo.findUnique({ where: { id: todoId } });
  if (!todo) throw new AutoScheduleError("タスクが見つかりません", 404);
  if (todo.isCompleted) {
    throw new AutoScheduleError("完了済みのタスクは自動配置できません");
  }
  if (!todo.estimatedMinutes || todo.estimatedMinutes <= 0) {
    throw new AutoScheduleError("見積時間が設定されていません");
  }
  if (!todo.dueDate) {
    throw new AutoScheduleError("期日が未設定のタスクは自動配置できません");
  }
  if (todo.isSplittable && (!todo.splitMinutes || todo.splitMinutes <= 0)) {
    throw new AutoScheduleError("1回あたりの見積時間が設定されていません");
  }
  if (
    todo.isSplittable &&
    (!todo.dailyLimitMinutes || todo.dailyLimitMinutes <= 0)
  ) {
    throw new AutoScheduleError("1日の実施時間上限が設定されていません");
  }

  const todoSchedules = await database.todoSchedule.findMany({
    where: { todoId },
    select: { scheduledStart: true, scheduledEnd: true },
  });
  const remainingEstimatedMinutes = calculateRemainingMinutes(
    todo.estimatedMinutes,
    todoSchedules,
  );
  if (remainingEstimatedMinutes <= 0) {
    throw new AutoScheduleError("見積時間のすべてがすでに配置されています");
  }

  // 保存済み配置には、手動配置や移動・リサイズ後の配置もすべて含まれる
  const scheduledMinutesByDay = todo.isSplittable
    ? calculateScheduledMinutesByJapanDay(todoSchedules)
    : new Map<number, number>();

  const today = startOfJapanDay(now);
  const dueDate = startOfJapanDay(todo.dueDate);
  if (dueDate < today) {
    throw new AutoScheduleError("期日を過ぎたタスクは自動配置できません");
  }

  const settings = await database.userSetting.findUnique({
    where: { userKey: DEFAULT_USER_KEY },
    include: {
      autoPlacementDays: {
        include: { timeRanges: { orderBy: { startMinute: "asc" } } },
      },
    },
  });
  if (!settings) {
    throw new AutoScheduleError(
      "ユーザー設定で自動配置可能時間を設定してください",
    );
  }

  const searchEnd = addJapanDays(dueDate, 1);
  const busySchedules = await database.todoSchedule.findMany({
    where: {
      scheduledStart: { lt: searchEnd },
      scheduledEnd: { gt: today },
    },
    select: { scheduledStart: true, scheduledEnd: true },
  });
  const busyPeriods: Placement[] = busySchedules.map((schedule) => ({
    scheduledStart: schedule.scheduledStart,
    scheduledEnd: schedule.scheduledEnd,
  }));

  const daySettings = new Map(
    settings.autoPlacementDays.map((day) => [day.weekday, day]),
  );
  const windows: Placement[] = [];
  for (
    let day = new Date(today);
    day <= dueDate;
    day = addJapanDays(day, 1)
  ) {
    const japanWeekday = getJapanDateParts(day).weekday;
    const weekday = japanWeekday === 0 ? 7 : japanWeekday;
    const setting = daySettings.get(weekday);
    if (!setting?.isEnabled) continue;

    for (const range of setting.timeRanges) {
      let rangeStart = dateAtMinute(day, range.startMinute);
      const rangeEnd = dateAtMinute(day, range.endMinute);
      if (day.getTime() === today.getTime() && rangeStart < now) {
        rangeStart = alignUpToHalfHour(now);
      }
      if (rangeStart < rangeEnd) {
        windows.push({
          scheduledStart: rangeStart,
          scheduledEnd: rangeEnd,
        });
      }
    }
  }

  // 保存済みの見積値は変えず、残り時間だけを配置時に30分単位へ切り上げる
  const totalMinutes = Math.ceil(remainingEstimatedMinutes / 30) * 30;
  const unitMinutes = todo.isSplittable
    ? Math.ceil((todo.splitMinutes as number) / 30) * 30
    : totalMinutes;
  const placements: Placement[] = [];
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > 0) {
    // 通常は1回あたりの時間を使い、全体の最後の端数だけ短くする
    const durationMinutes = todo.isSplittable
      ? Math.min(unitMinutes, remainingMinutes)
      : totalMinutes;
    const availableWindows = todo.isSplittable
      ? windows.filter((window) => {
          const dayKey = startOfJapanDay(window.scheduledStart).getTime();
          const alreadyScheduled = scheduledMinutesByDay.get(dayKey) ?? 0;
          return (
            alreadyScheduled + durationMinutes <=
            (todo.dailyLimitMinutes as number)
          );
        })
      : windows;
    const placement = findEarliestSlot(
      durationMinutes,
      availableWindows,
      busyPeriods,
    );
    if (!placement) {
      // 上限を外せば空き枠がある場合は、配置不能の理由を明確に伝える
      const blockedByDailyLimit =
        todo.isSplittable &&
        findEarliestSlot(durationMinutes, windows, busyPeriods) !== null;
      throw new AutoScheduleError(
        blockedByDailyLimit
          ? "1日の実施時間上限を守ると、期日までに必要な時間を配置できませんでした。"
          : todo.isSplittable
            ? "期日までに必要な空き時間を確保できませんでした"
            : "期日までに見積時間を連続して確保できる空き時間がありませんでした",
      );
    }

    placements.push(placement);
    busyPeriods.push(placement);
    if (todo.isSplittable) {
      const dayKey = startOfJapanDay(placement.scheduledStart).getTime();
      scheduledMinutesByDay.set(
        dayKey,
        (scheduledMinutesByDay.get(dayKey) ?? 0) + durationMinutes,
      );
    }
    remainingMinutes -= durationMinutes;
    if (!todo.isSplittable) break;
  }

  placements.sort(
    (a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime(),
  );

  return { todo, placements, totalMinutes };
}

function getStoredPreview(previewId: unknown, todoId: number) {
  removeExpiredPreviews();
  if (typeof previewId !== "string") return null;
  const preview = storedPreviews.get(previewId);
  return preview?.todoId === todoId ? preview : null;
}

function sendAutoScheduleError(
  res: express.Response,
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof AutoScheduleError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

export function registerAutoScheduleRoutes(
  app: express.Express,
  prisma: PrismaClient,
) {
  app.post("/todos/:id/auto-schedule/preview", async (req, res) => {
    try {
      const todoId = Number(req.params.id);
      if (!Number.isInteger(todoId)) {
        throw new AutoScheduleError("タスクIDが正しくありません");
      }
      await ensureDefaultUserSettings(prisma);
      const result = await calculateAutoSchedule(prisma, todoId);
      const previewId = storePreview(todoId, result.placements);
      res.json({
        previewId,
        todoId,
        todoTitle: result.todo.title,
        roundedEstimatedMinutes: result.totalMinutes,
        placements: result.placements.map(serializePlacement),
      });
    } catch (error) {
      sendAutoScheduleError(
        res,
        error,
        "自動配置のプレビュー作成に失敗しました",
      );
    }
  });

  app.post("/todos/:id/auto-schedule/confirm", async (req, res) => {
    try {
      const todoId = Number(req.params.id);
      if (!Number.isInteger(todoId)) {
        throw new AutoScheduleError("タスクIDが正しくありません");
      }
      const preview = getStoredPreview(req.body.previewId, todoId);
      if (!preview) {
        throw new AutoScheduleError(
          "プレビューの有効期限が切れています。もう一度プレビューしてください",
          409,
        );
      }

      const savedSchedules = await prisma.$transaction(async (transaction) => {
        const firstStart = preview.placements[0].scheduledStart;
        const lastEnd = preview.placements.reduce(
          (latest, placement) =>
            placement.scheduledEnd > latest ? placement.scheduledEnd : latest,
          preview.placements[0].scheduledEnd,
        );
        const currentSchedules = await transaction.todoSchedule.findMany({
          where: {
            scheduledStart: { lt: lastEnd },
            scheduledEnd: { gt: firstStart },
          },
          select: { scheduledStart: true, scheduledEnd: true },
        });
        const hasNewConflict = preview.placements.some((placement) =>
          currentSchedules.some((schedule) =>
            overlaps(
              placement.scheduledStart,
              placement.scheduledEnd,
              schedule,
            ),
          ),
        );
        if (hasNewConflict) {
          throw new AutoScheduleError(
            "プレビュー後に予定が変更されました。もう一度プレビューしてください",
            409,
          );
        }

        const createdSchedules = [];
        for (const placement of preview.placements) {
          createdSchedules.push(
            await transaction.todoSchedule.create({
              data: {
                todoId,
                scheduledStart: placement.scheduledStart,
                scheduledEnd: placement.scheduledEnd,
              },
            }),
          );
        }
        return createdSchedules;
      });
      storedPreviews.delete(preview.previewId);

      res.json({
        todoId,
        schedules: savedSchedules.map((schedule) => ({
          scheduleId: schedule.id,
          scheduledStart: schedule.scheduledStart.toISOString(),
          scheduledEnd: schedule.scheduledEnd.toISOString(),
        })),
      });
    } catch (error) {
      sendAutoScheduleError(res, error, "自動配置の確定に失敗しました");
    }
  });

  app.post("/todos/:id/auto-schedule/cancel", (req, res) => {
    const todoId = Number(req.params.id);
    const preview = getStoredPreview(req.body.previewId, todoId);
    if (preview) storedPreviews.delete(preview.previewId);
    res.status(204).send();
  });
}
