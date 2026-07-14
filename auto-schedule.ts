import type express from "express";
import type { PrismaClient } from "./generated/prisma/client";
import { ensureDefaultUserSettings } from "./user-settings";

const HALF_HOUR_MS = 30 * 60 * 1000;
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

class AutoScheduleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function dateAtMinute(day: Date, minute: number) {
  const date = startOfLocalDay(day);
  date.setMinutes(minute);
  return date;
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

function serializePlacement(placement: Placement) {
  return {
    scheduledStart: placement.scheduledStart.toISOString(),
    scheduledEnd: placement.scheduledEnd.toISOString(),
    label: formatPlacementLabel(placement),
  };
}

function formatPlacementLabel(placement: Placement) {
  const start = placement.scheduledStart;
  const end = placement.scheduledEnd;
  const startTime = `${String(start.getHours()).padStart(2, "0")}:${String(
    start.getMinutes(),
  ).padStart(2, "0")}`;
  const endTime = `${String(end.getHours()).padStart(2, "0")}:${String(
    end.getMinutes(),
  ).padStart(2, "0")}`;
  return `${start.getMonth() + 1}月${start.getDate()}日（${
    WEEKDAY_NAMES[start.getDay()]
  }） ${startTime}〜${endTime}`;
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

  const today = startOfLocalDay(now);
  const dueDate = startOfLocalDay(todo.dueDate);
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

  const searchEnd = addLocalDays(dueDate, 1);
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
    day = addLocalDays(day, 1)
  ) {
    const weekday = day.getDay() === 0 ? 7 : day.getDay();
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

  const totalMinutes = Math.ceil(todo.estimatedMinutes / 30) * 30;
  const unitMinutes = todo.isSplittable
    ? Math.ceil((todo.splitMinutes as number) / 30) * 30
    : totalMinutes;
  const placements: Placement[] = [];
  let remainingMinutes = totalMinutes;

  while (remainingMinutes > 0) {
    const durationMinutes = todo.isSplittable
      ? Math.min(unitMinutes, remainingMinutes)
      : totalMinutes;
    const placement = findEarliestSlot(
      durationMinutes,
      windows,
      busyPeriods,
    );
    if (!placement) {
      throw new AutoScheduleError(
        todo.isSplittable
          ? "期日までに必要な空き時間を確保できませんでした"
          : "期日までに見積時間を連続して確保できる空き時間がありませんでした",
      );
    }

    placements.push(placement);
    busyPeriods.push(placement);
    remainingMinutes -= durationMinutes;
    if (!todo.isSplittable) break;
  }

  placements.sort(
    (a, b) => a.scheduledStart.getTime() - b.scheduledStart.getTime(),
  );

  return { todo, placements, totalMinutes };
}

function placementsMatch(expected: unknown, actual: Placement[]) {
  if (!Array.isArray(expected) || expected.length !== actual.length) {
    return false;
  }
  return actual.every((placement, index) => {
    const candidate = expected[index];
    return (
      candidate &&
      typeof candidate === "object" &&
      (candidate as Record<string, unknown>).scheduledStart ===
        placement.scheduledStart.toISOString() &&
      (candidate as Record<string, unknown>).scheduledEnd ===
        placement.scheduledEnd.toISOString()
    );
  });
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
      res.json({
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
      await ensureDefaultUserSettings(prisma);

      const savedSchedules = await prisma.$transaction(async (transaction) => {
        const result = await calculateAutoSchedule(transaction, todoId);
        if (!placementsMatch(req.body.placements, result.placements)) {
          throw new AutoScheduleError(
            "空き時間の状況が変わりました。もう一度プレビューしてください",
            409,
          );
        }

        const createdSchedules = [];
        for (const placement of result.placements) {
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
}
