import type express from "express";
import type { PrismaClient } from "./generated/prisma/client";

const DEFAULT_USER_KEY = "default";
type DefaultDayDefinition = {
  weekday: number;
  name: string;
  isEnabled: boolean;
  ranges: ReadonlyArray<readonly [number, number]>;
};

// 初期設定は全曜日を許可し、自動配置時間を9:00〜18:00にする
const DAY_DEFINITIONS: ReadonlyArray<DefaultDayDefinition> = [
  { weekday: 1, name: "月曜日", isEnabled: true, ranges: [[540, 1080]] },
  { weekday: 2, name: "火曜日", isEnabled: true, ranges: [[540, 1080]] },
  { weekday: 3, name: "水曜日", isEnabled: true, ranges: [[540, 1080]] },
  { weekday: 4, name: "木曜日", isEnabled: true, ranges: [[540, 1080]] },
  { weekday: 5, name: "金曜日", isEnabled: true, ranges: [[540, 1080]] },
  { weekday: 6, name: "土曜日", isEnabled: true, ranges: [[540, 1080]] },
  { weekday: 7, name: "日曜日", isEnabled: true, ranges: [[540, 1080]] },
];

type SettingsDayView = {
  weekday: number;
  name: string;
  isEnabled: boolean;
  ranges: Array<{ startTime: string; endTime: string }>;
};

type ParsedSettingsDay = {
  weekday: number;
  isEnabled: boolean;
  ranges: Array<{ startMinute: number; endMinute: number }>;
};

function minuteToTime(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
    minute % 60,
  ).padStart(2, "0")}`;
}

function timeToMinute(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function toStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === undefined || value === null) return [];
  return [String(value)];
}

export async function ensureDefaultUserSettings(prisma: PrismaClient) {
  const existing = await prisma.userSetting.findUnique({
    where: { userKey: DEFAULT_USER_KEY },
    include: {
      autoPlacementDays: {
        include: { timeRanges: { orderBy: { startMinute: "asc" } } },
        orderBy: { weekday: "asc" },
      },
    },
  });
  if (existing) return existing;

  // 初回だけ、全曜日許可・9:00〜18:00の初期設定を作成する
  return prisma.userSetting.create({
    data: {
      userKey: DEFAULT_USER_KEY,
      autoPlacementDays: {
        create: DAY_DEFINITIONS.map((day) => ({
          weekday: day.weekday,
          isEnabled: day.isEnabled,
          timeRanges: {
            create: day.ranges.map(([startMinute, endMinute]) => ({
              startMinute,
              endMinute,
            })),
          },
        })),
      },
    },
    include: {
      autoPlacementDays: {
        include: { timeRanges: { orderBy: { startMinute: "asc" } } },
        orderBy: { weekday: "asc" },
      },
    },
  });
}

function buildSettingsView(settings: Awaited<ReturnType<typeof ensureDefaultUserSettings>>) {
  return DAY_DEFINITIONS.map((definition): SettingsDayView => {
    const savedDay = settings.autoPlacementDays.find(
      (day) => day.weekday === definition.weekday,
    );
    return {
      weekday: definition.weekday,
      name: definition.name,
      isEnabled: savedDay?.isEnabled ?? false,
      ranges: (savedDay?.timeRanges ?? []).map((range) => ({
        startTime: minuteToTime(range.startMinute),
        endTime: minuteToTime(range.endMinute),
      })),
    };
  });
}

function parseSubmittedSettings(body: Record<string, unknown>) {
  const errors: string[] = [];
  const viewDays: SettingsDayView[] = [];
  const parsedDays: ParsedSettingsDay[] = [];

  DAY_DEFINITIONS.forEach((definition) => {
    const isEnabled = body[`enabled-${definition.weekday}`] === "true";
    const starts = toStringArray(body[`start-${definition.weekday}`]);
    const ends = toStringArray(body[`end-${definition.weekday}`]);
    const inputCount = Math.max(starts.length, ends.length);
    const viewRanges = Array.from({ length: inputCount }, (_, index) => ({
      startTime: starts[index] ?? "",
      endTime: ends[index] ?? "",
    }));
    const parsedRanges: ParsedSettingsDay["ranges"] = [];

    if (isEnabled) {
      if (inputCount === 0) {
        errors.push(`${definition.name}：許可する場合は時間帯を1つ以上設定してください。`);
      }

      viewRanges.forEach((range) => {
        const startMinute = timeToMinute(range.startTime);
        const endMinute = timeToMinute(range.endTime);
        if (
          startMinute === null ||
          endMinute === null ||
          startMinute >= endMinute
        ) {
          errors.push(
            `${definition.name}：開始時刻が終了時刻より前になるように入力してください。`,
          );
          return;
        }
        parsedRanges.push({ startMinute, endMinute });
      });

      const sortedRanges = [...parsedRanges].sort(
        (a, b) => a.startMinute - b.startMinute,
      );
      for (let index = 1; index < sortedRanges.length; index += 1) {
        if (sortedRanges[index].startMinute < sortedRanges[index - 1].endMinute) {
          errors.push(`${definition.name}：時間帯が重複しています。`);
          break;
        }
      }
    }

    viewDays.push({
      weekday: definition.weekday,
      name: definition.name,
      isEnabled,
      ranges: viewRanges,
    });
    parsedDays.push({
      weekday: definition.weekday,
      isEnabled,
      ranges: isEnabled ? parsedRanges : [],
    });
  });

  return { errors: [...new Set(errors)], viewDays, parsedDays };
}

export function registerUserSettingsRoutes(
  app: express.Express,
  prisma: PrismaClient,
) {
  app.get("/settings", async (req, res) => {
    try {
      const settings = await ensureDefaultUserSettings(prisma);
      res.render("settings", {
        days: buildSettingsView(settings),
        errors: [],
        saved: req.query.saved === "1",
        reset: req.query.reset === "1",
      });
    } catch (error) {
      console.error("ユーザー設定の取得に失敗したぞよ:", error);
      res.status(500).send("設定の取得中にエラーが発生しました");
    }
  });

  app.post("/settings/reset", async (_req, res) => {
    try {
      const settings = await ensureDefaultUserSettings(prisma);
      // 保存済み時間帯を削除し、全曜日許可・9:00〜18:00へ戻す
      await prisma.$transaction(async (transaction) => {
        for (const definition of DAY_DEFINITIONS) {
          const day = await transaction.autoPlacementDay.upsert({
            where: {
              userSettingId_weekday: {
                userSettingId: settings.id,
                weekday: definition.weekday,
              },
            },
            update: { isEnabled: true },
            create: {
              userSettingId: settings.id,
              weekday: definition.weekday,
              isEnabled: true,
            },
          });
          await transaction.autoPlacementTimeRange.deleteMany({
            where: { dayId: day.id },
          });
          await transaction.autoPlacementTimeRange.createMany({
            data: definition.ranges.map(([startMinute, endMinute]) => ({
              dayId: day.id,
              startMinute,
              endMinute,
            })),
          });
        }
      });
      res.redirect("/settings?reset=1");
    } catch (error) {
      console.error("ユーザー設定のリセットに失敗したぞよ:", error);
      res.status(500).send("設定のリセット中にエラーが発生しました");
    }
  });

  app.post("/settings", async (req, res) => {
    try {
      const { errors, viewDays, parsedDays } = parseSubmittedSettings(req.body);
      if (errors.length > 0) {
        return res.status(400).render("settings", {
          days: viewDays,
          errors,
          saved: false,
          reset: false,
        });
      }

      const settings = await ensureDefaultUserSettings(prisma);
      // 全曜日を同一トランザクションで更新し、途中状態を保存しない
      await prisma.$transaction(async (transaction) => {
        for (const dayInput of parsedDays) {
          const day = await transaction.autoPlacementDay.upsert({
            where: {
              userSettingId_weekday: {
                userSettingId: settings.id,
                weekday: dayInput.weekday,
              },
            },
            update: { isEnabled: dayInput.isEnabled },
            create: {
              userSettingId: settings.id,
              weekday: dayInput.weekday,
              isEnabled: dayInput.isEnabled,
            },
          });

          await transaction.autoPlacementTimeRange.deleteMany({
            where: { dayId: day.id },
          });
          if (dayInput.ranges.length > 0) {
            await transaction.autoPlacementTimeRange.createMany({
              data: dayInput.ranges.map((range) => ({
                dayId: day.id,
                startMinute: range.startMinute,
                endMinute: range.endMinute,
              })),
            });
          }
        }
      });

      res.redirect("/settings?saved=1");
    } catch (error) {
      console.error("ユーザー設定の保存に失敗したぞよ:", error);
      res.status(500).send("設定の保存中にエラーが発生しました");
    }
  });
}
