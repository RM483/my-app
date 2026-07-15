import "dotenv/config";
import express from "express";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { registerUserSettingsRoutes } from "./user-settings";
import {
  calculateRemainingMinutes,
  registerAutoScheduleRoutes,
} from "./auto-schedule";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });
const app = express();
const PORT = process.env.PORT || 8888;

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// タスク管理処理から独立したユーザー共通設定画面

// 単一タスクの自動配置プレビューと確定
registerAutoScheduleRoutes(app, prisma);
registerUserSettingsRoutes(app, prisma);

function getErrorMessage(errorType: string | undefined) {
  switch (errorType) {
    case "duplicate":
      return "同じ内容のタスクがすでに存在します。別の名前にしてください。";
    case "emptyTitle":
      return "タスク名を入力してください。";
    case "listDuplicate":
      return "この内容は既に存在するため、変更できませんでした。";
    case "listEmptyTitle":
      return "タスク名を入力してください。";
    case "invalidAutoPlacement":
      return "自動配置用設定を確認してください。各時間は正の数で入力してください。";
    case "listInvalidAutoPlacement":
      return "自動配置用設定を保存できませんでした。各時間は正の数で入力してください。";
    case "splitExceedsDailyLimit":
    case "listSplitExceedsDailyLimit":
      return "1回あたりの時間は、1日の実施時間上限以下にしてください。";
    case "splitExceedsEstimate":
    case "listSplitExceedsEstimate":
      return "1回あたりの時間は、見積時間以下にしてください。";
    default:
      return null;
  }
}
function formatAutoPlacementConsistencyErrors(errorTypes: string[]) {
  const messages = errorTypes
    .map((errorType) => getErrorMessage(errorType))
    .filter((message): message is string => Boolean(message));
  if (messages.length <= 1) return messages[0] || null;
  return messages.map((message) => `・${message}`).join("\n");
}

type AutoPlacementTimeField =
  | "estimatedMinutes"
  | "splitMinutes"
  | "dailyLimitMinutes";


// 画面識別子を3種類へ正規化し、不正値は今日画面へ戻す
function normalizeView(value: unknown) {
  if (value === "list" || value === "calendar") return value;
  return "today";
}

function getViewUrl(view: string) {
  if (view === "list") return "/?view=list";
  if (view === "calendar") return "/?view=calendar";
  return "/";
}

function getDateInputValue(dateValue: Date | null) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getHoursInputValue(minutes: number | null | undefined) {
  if (!minutes) return "";
  return String(minutes / 60);
}

// 画面の「時間」入力を、自動配置処理で扱いやすい分単位へ正規化する
function parseAutoPlacementSettings(body: Record<string, any>) {
  const estimatedHoursValue = String(body.estimatedHours ?? "").trim();
  if (estimatedHoursValue === "") {
    return {
      estimatedMinutes: null,
      isSplittable: false,
      splitMinutes: null,
      dailyLimitMinutes: null,
      error: null,
    };
  }

  const estimatedHours = Number(estimatedHoursValue);
  const estimatedMinutes = Math.round(estimatedHours * 60);
  if (
    !Number.isFinite(estimatedHours) ||
    estimatedHours <= 0 ||
    Math.abs(estimatedHours * 60 - estimatedMinutes) > 0.000001
  ) {
    return { error: "invalidEstimatedHours" };
  }

  const isSplittable = body.isSplittable === "true";
  if (!isSplittable) {
    return {
      estimatedMinutes,
      isSplittable: false,
      splitMinutes: null,
      dailyLimitMinutes: null,
      error: null,
    };
  }

  const splitHours = Number(String(body.splitHours ?? "").trim());
  const splitMinutes = Math.round(splitHours * 60);
  const dailyLimitHours = Number(
    String(body.dailyLimitHours ?? "").trim(),
  );
  const dailyLimitMinutes = Math.round(dailyLimitHours * 60);
  if (
    !Number.isFinite(splitHours) ||
    splitHours <= 0 ||
    Math.abs(splitHours * 60 - splitMinutes) > 0.000001
  ) {
    return { error: "invalidSplitHours" };
  }
  if (
    !Number.isFinite(dailyLimitHours) ||
    dailyLimitHours <= 0 ||
    Math.abs(dailyLimitHours * 60 - dailyLimitMinutes) > 0.000001
  ) {
    return { error: "invalidDailyLimitHours" };
  }
  const consistencyErrors: string[] = [];
  if (splitMinutes > estimatedMinutes) {
    consistencyErrors.push("splitExceedsEstimate");
  }
  if (splitMinutes > dailyLimitMinutes) {
    consistencyErrors.push("splitExceedsDailyLimit");
  }
  if (consistencyErrors.length > 0) {
    return {
      estimatedMinutes,
      isSplittable: true,
      splitMinutes,
      dailyLimitMinutes,
      error: consistencyErrors[0],
      consistencyErrors,
    };
  }

  return {
    estimatedMinutes,
    isSplittable: true,
    splitMinutes,
    dailyLimitMinutes,
    error: null,
    consistencyErrors: [],
  };
}

// 違反に関係する変更項目のうち、保存値へ戻すことで違反が解消する項目を求める。
function getConsistencyRollbackFields(currentTodo: any, settings: any) {
  const saved: Record<AutoPlacementTimeField, number | null> = {
    estimatedMinutes: currentTodo.estimatedMinutes,
    splitMinutes: currentTodo.splitMinutes,
    dailyLimitMinutes: currentTodo.dailyLimitMinutes,
  };
  const submitted: Record<AutoPlacementTimeField, number | null> = {
    estimatedMinutes: settings.estimatedMinutes,
    splitMinutes: settings.splitMinutes,
    dailyLimitMinutes: settings.dailyLimitMinutes,
  };
  const changed = (field: AutoPlacementTimeField) =>
    submitted[field] !== saved[field];
  const resolves = (
    leftValue: number | null,
    rightValue: number | null,
  ) =>
    leftValue === null ||
    rightValue === null ||
    leftValue <= rightValue;
  const rollbackFields = new Set<AutoPlacementTimeField>();

  const collectConstraintCauses = (
    leftField: AutoPlacementTimeField,
    rightField: AutoPlacementTimeField,
  ) => {
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

  for (const errorType of settings.consistencyErrors || []) {
    if (errorType === "splitExceedsEstimate") {
      collectConstraintCauses("splitMinutes", "estimatedMinutes");
    }
    if (errorType === "splitExceedsDailyLimit") {
      collectConstraintCauses("splitMinutes", "dailyLimitMinutes");
    }
  }
  return rollbackFields;
}

function buildEmptyFormValues() {
  return {
    title: "",
    titleSimple: "",
    dueDate: "",
    priority: "中",
    categoryId: "指定なし",
    newCategory: "",
    currentMode: "detail",
    estimatedHours: "",
    isSplittable: "false",
    splitHours: "1",
    dailyLimitHours: "2",
  };
}

function buildFormValues(body: Record<string, any> = {}, currentTodo?: any) {
  const titleValue = body.title ?? body.titleSimple ?? "";
  const titleSimpleValue = body.titleSimple ?? body.title ?? "";
  const dueDateValue = body.dueDate ?? "";
  const priorityValue = body.priority ?? "中";
  const categoryIdValue = body.categoryId ?? "指定なし";
  const newCategoryValue = body.newCategory ?? "";
  const currentMode = body.titleSimple && !body.title ? "simple" : "detail";
  const estimatedHoursValue =
    body.estimatedHours ?? getHoursInputValue(currentTodo?.estimatedMinutes);
  const isSplittableValue =
    body.isSplittable ?? String(currentTodo?.isSplittable ?? false);
  const splitHoursValue =
    body.splitHours ??
    (currentTodo
      ? getHoursInputValue(currentTodo.splitMinutes) ||
        (currentTodo.isSplittable ? "1" : "")
      : "1");
  const dailyLimitHoursValue =
    body.dailyLimitHours ??
    (currentTodo
      ? getHoursInputValue(currentTodo.dailyLimitMinutes) ||
        (currentTodo.isSplittable ? "2" : "")
      : "2");

  const values: Record<string, any> = {
    title: titleValue,
    titleSimple: titleSimpleValue,
    dueDate: dueDateValue,
    priority: priorityValue,
    categoryId: categoryIdValue,
    newCategory: newCategoryValue,
    currentMode,
    estimatedHours: estimatedHoursValue,
    isSplittable: isSplittableValue,
    splitHours: splitHoursValue,
    dailyLimitHours: dailyLimitHoursValue,
  };

  if (currentTodo) {
    values["todo-" + currentTodo.id + "-title"] =
      body.title ?? currentTodo.title;
    values["todo-" + currentTodo.id + "-dueDate"] =
      body.dueDate ?? getDateInputValue(currentTodo.dueDate);
    values["todo-" + currentTodo.id + "-priority"] =
      body.priority ?? currentTodo.priority;
    values["todo-" + currentTodo.id + "-estimatedHours"] =
      estimatedHoursValue;
    values["todo-" + currentTodo.id + "-isSplittable"] =
      isSplittableValue;
    values["todo-" + currentTodo.id + "-splitHours"] =
      splitHoursValue;
    values["todo-" + currentTodo.id + "-dailyLimitHours"] =
      dailyLimitHoursValue;
  }

  return values;
}

async function renderIndexPage(
  res: express.Response,
  options: {
    todos: any[];
    errorType?: string;
    formValues?: Record<string, any>;
    errorMessage?: string | null;
    duplicateTodoId?: number | null;
    activeView?: string;
    autoPlacementEditTodoId?: number | null;
  },
) {
  const activeCategories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
  });

  const orphanedCategories = await prisma.category.findMany({
    where: {
      isActive: false,
      todos: { some: {} },
    },
    orderBy: { id: "asc" },
  });

  const allDisplayCategories = [...activeCategories, ...orphanedCategories];
  const todoIds = options.todos.map((todo) => todo.id);
  const schedules =
    todoIds.length > 0
      ? await prisma.todoSchedule.findMany({
          where: { todoId: { in: todoIds } },
          orderBy: { scheduledStart: "asc" },
        })
      : [];
  const todosWithSchedules = options.todos.map((todo) => {
    const todoSchedules = schedules.filter(
      (schedule) => schedule.todoId === todo.id,
    );
    return {
      ...todo,
      schedules: todoSchedules,
      // 候補表示も自動配置APIと同じ計算方法で残り時間を判定する
      remainingEstimatedMinutes: calculateRemainingMinutes(
        todo.estimatedMinutes,
        todoSchedules,
      ),
    };
  });
  const sortedTodos = [...todosWithSchedules].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) {
      return a.isCompleted ? 1 : -1;
    }
    if (a.dueDate && b.dueDate) {
      if (a.dueDate.getTime() !== b.dueDate.getTime()) {
        return a.dueDate.getTime() - b.dueDate.getTime();
      }
    } else if (a.dueDate) {
      return -1;
    } else if (b.dueDate) {
      return 1;
    }
    const priorityMap: { [key: string]: number } = { 高: 1, 中: 2, 低: 3 };
    const priorityA = priorityMap[a.priority] || 2;
    const priorityB = priorityMap[b.priority] || 2;
    return priorityA - priorityB;
  });

  const activeView = normalizeView(options.activeView);

  res.render("index", {
    todos: sortedTodos,
    categories: allDisplayCategories,
    error: options.errorType,
    errorMessage: options.errorMessage ?? getErrorMessage(options.errorType),
    formValues: options.formValues || {},
    duplicateTodoId: options.duplicateTodoId ?? null,
    initialView: activeView,
    autoPlacementEditTodoId: options.autoPlacementEditTodoId ?? null,
  });
}

// 💡 1. タスク一覧の取得（自動並び替え ＆ カテゴリ維持ロジック付き）
app.get("/", async (req, res) => {
  try {
    const errorType = req.query.error as string | undefined;
    const requestedView = normalizeView(req.query.view);

    const todos = await prisma.todo.findMany({
      include: { category: true },
    });

    await renderIndexPage(res, {
      todos,
      errorType,
      formValues: {},
      activeView: requestedView,
    });
  } catch (error) {
    console.error("データ取得に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 💡 2. 新しいタスクの追加（重複防止ロジック付き）
app.post("/todos", async (req, res) => {
  try {
    const {
      title,
      dueDate,
      categoryId,
      newCategory,
      priority,
      titleSimple,
      view,
      estimatedHours,
      isSplittable,
      splitHours,
      dailyLimitHours,
    } = req.body;

    const requestedView = normalizeView(view);
    const rawTitle = title || titleSimple;
    if (!rawTitle || rawTitle.trim() === "") {
      const todos = await prisma.todo.findMany({ include: { category: true } });
      return renderIndexPage(res, {
        todos,
        errorType: "emptyTitle",
        formValues: buildEmptyFormValues(),
        activeView: requestedView,
      });
    }

    const cleanedTitle = rawTitle.trim();

    let parsedDueDate: Date | null = null;
    if (dueDate && dueDate.trim() !== "") {
      parsedDueDate = new Date(dueDate);
      parsedDueDate.setHours(0, 0, 0, 0);
    }

    const autoPlacementSettings = parseAutoPlacementSettings({
      estimatedHours,
      isSplittable,
      splitHours,
      dailyLimitHours,
    });
    if (autoPlacementSettings.error) {
      const todos = await prisma.todo.findMany({ include: { category: true } });
      const consistencyErrors: string[] =
        (autoPlacementSettings as any).consistencyErrors || [];
      const errorTypeMap: Record<string, string> = {
        splitExceedsDailyLimit: "splitExceedsDailyLimit",
        splitExceedsEstimate: "splitExceedsEstimate",
      };
      const errorType =
        errorTypeMap[autoPlacementSettings.error] || "invalidAutoPlacement";
      return renderIndexPage(res, {
        todos,
        errorType,
        errorMessage:
          formatAutoPlacementConsistencyErrors(consistencyErrors),
        formValues: buildFormValues(req.body),
        activeView: requestedView,
      });
    }

    // 重複防止チェック
    const existingTodo = await prisma.todo.findFirst({
      where: {
        title: cleanedTitle,
        dueDate: parsedDueDate,
      },
    });

    if (existingTodo) {
      const todos = await prisma.todo.findMany({ include: { category: true } });
      return renderIndexPage(res, {
        todos,
        errorType: "duplicate",
        formValues: buildEmptyFormValues(),
        duplicateTodoId: null,
        activeView: requestedView,
      });
    }

    let targetCategoryId: number | null = null;

    if (categoryId === "__NEW__" && newCategory && newCategory.trim() !== "") {
      const categoryName = newCategory.trim();

      let category = await prisma.category.findFirst({
        where: { name: categoryName },
      });

      if (category) {
        category = await prisma.category.update({
          where: { id: category.id },
          data: { isActive: true },
        });
      } else {
        category = await prisma.category.create({
          data: { name: categoryName },
        });
      }
      targetCategoryId = category.id;
    } else if (
      categoryId &&
      categoryId !== "指定なし" &&
      categoryId !== "__NEW__"
    ) {
      targetCategoryId = Number(categoryId);
    }

    await prisma.todo.create({
      data: {
        title: cleanedTitle,
        dueDate: parsedDueDate,
        categoryId: targetCategoryId,
        priority: priority || "中",
        estimatedMinutes: autoPlacementSettings.estimatedMinutes,
        isSplittable: autoPlacementSettings.isSplittable,
        splitMinutes: autoPlacementSettings.splitMinutes,
        dailyLimitMinutes: autoPlacementSettings.dailyLimitMinutes,
      },
    });

    res.redirect(getViewUrl(requestedView));
  } catch (error) {
    console.error("タスクの追加に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 💡 3. タスク名・期日・重要度のその場更新ルート（重複チェック付き強化版）
app.post("/todos/:id/update", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const { title, dueDate, priority } = req.body;

    const currentTodo = await prisma.todo.findUnique({
      where: { id: todoId },
    });
    if (!currentTodo) return res.status(404).send("タスクが見つかりません");

    const finalTitle = title !== undefined ? title.trim() : currentTodo.title;

    let finalDueDate: Date | null = currentTodo.dueDate;
    if (dueDate !== undefined) {
      if (dueDate.trim() === "") {
        finalDueDate = null;
      } else {
        finalDueDate = new Date(dueDate);
        finalDueDate.setHours(0, 0, 0, 0);
      }
    }

    if (finalTitle === "") {
      const todos = await prisma.todo.findMany({ include: { category: true } });
      return renderIndexPage(res, {
        todos,
        errorType: "listEmptyTitle",
        formValues: buildFormValues({}, currentTodo),
        activeView: "list",
      });
    }

    // 重複チェック
    const duplicateTodo = await prisma.todo.findFirst({
      where: {
        id: { not: todoId },
        title: finalTitle,
        dueDate: finalDueDate,
      },
    });

    if (duplicateTodo) {
      const todos = await prisma.todo.findMany({ include: { category: true } });
      return renderIndexPage(res, {
        todos,
        errorType: "listDuplicate",
        formValues: buildFormValues({}, currentTodo),
        duplicateTodoId: todoId,
        activeView: "list",
      });
    }

    const updateData: any = {};
    if (title !== undefined) updateData.title = finalTitle;
    if (priority !== undefined) updateData.priority = priority;
    if (dueDate !== undefined) updateData.dueDate = finalDueDate;

    await prisma.todo.update({
      where: { id: todoId },
      data: updateData,
    });

    res.redirect("/?view=list");
  } catch (error) {
    console.error("タスクの直接更新に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 自動配置用設定だけを更新し、手動で配置したスケジュール時間には触れない
app.post("/todos/:id/auto-placement", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const currentTodo = await prisma.todo.findUnique({
      where: { id: todoId },
    });
    if (!currentTodo) return res.status(404).send("タスクが見つかりません");

    const autoPlacementSettings = parseAutoPlacementSettings(req.body);
    if (autoPlacementSettings.error) {
      const todos = await prisma.todo.findMany({ include: { category: true } });
      const consistencyErrors: string[] =
        (autoPlacementSettings as any).consistencyErrors || [];
      const formValues = buildFormValues(req.body, currentTodo);
      const rollbackFields = getConsistencyRollbackFields(
        currentTodo,
        autoPlacementSettings,
      );
      const savedInputValues: Record<AutoPlacementTimeField, string> = {
        estimatedMinutes: getHoursInputValue(currentTodo.estimatedMinutes),
        splitMinutes: getHoursInputValue(currentTodo.splitMinutes),
        dailyLimitMinutes: getHoursInputValue(currentTodo.dailyLimitMinutes),
      };
      const formValueKeys: Record<AutoPlacementTimeField, string> = {
        estimatedMinutes: "estimatedHours",
        splitMinutes: "splitHours",
        dailyLimitMinutes: "dailyLimitHours",
      };
      for (const field of rollbackFields) {
        formValues[`todo-${todoId}-${formValueKeys[field]}`] =
          savedInputValues[field];
      }

      const primaryError = consistencyErrors[0];
      const listErrorTypeMap: Record<string, string> = {
        splitExceedsDailyLimit: "listSplitExceedsDailyLimit",
        splitExceedsEstimate: "listSplitExceedsEstimate",
      };
      return renderIndexPage(res, {
        todos,
        errorType:
          listErrorTypeMap[primaryError] || "listInvalidAutoPlacement",
        errorMessage:
          formatAutoPlacementConsistencyErrors(consistencyErrors),
        formValues,
        activeView: "list",
        autoPlacementEditTodoId: todoId,
      });
    }

    await prisma.todo.update({
      where: { id: todoId },
      data: {
        estimatedMinutes: autoPlacementSettings.estimatedMinutes,
        isSplittable: autoPlacementSettings.isSplittable,
        splitMinutes: autoPlacementSettings.splitMinutes,
        dailyLimitMinutes: autoPlacementSettings.dailyLimitMinutes,
      },
    });

    res.redirect("/?view=list");
  } catch (error) {
    console.error("自動配置用設定の更新に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 💡 4. タスクのカテゴリ（分類）更新
app.post("/todos/:id/category", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const { categoryId } = req.body;
    const targetCategoryId =
      categoryId === "指定なし" ? null : Number(categoryId);

    await prisma.todo.update({
      where: { id: todoId },
      data: { categoryId: targetCategoryId },
    });
    res.redirect("/?view=list");
  } catch (error) {
    console.error("タスクの分類更新に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 💡 4-2. ★新機能★ タスク一覧のプルダウンから「新しく分類を作ってその場でセット」するルート
app.post("/todos/:id/category/create", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const { newCategoryName } = req.body;

    if (!newCategoryName || newCategoryName.trim() === "") {
      return res.redirect("/?view=list");
    }

    const categoryName = newCategoryName.trim();

    // 既に存在するかチェック
    let category = await prisma.category.findFirst({
      where: { name: categoryName },
    });

    if (category) {
      // 存在していたら、もし非表示なら有効に戻す
      category = await prisma.category.update({
        where: { id: category.id },
        data: { isActive: true },
      });
    } else {
      // 全く新しい名前なら新規作成
      category = await prisma.category.create({
        data: { name: categoryName },
      });
    }

    // 対象のタスクにこのカテゴリをセット
    await prisma.todo.update({
      where: { id: todoId },
      data: { categoryId: category.id },
    });

    res.redirect("/?view=list");
  } catch (error) {
    console.error("タスク一覧からのカテゴリ新規追加に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 💡 5. タスクの完了 / 未完了の切り替え
app.post("/todos/:id/toggle", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const currentTodo = await prisma.todo.findUnique({ where: { id: todoId } });
    if (!currentTodo) return res.status(404).send("タスクが見つかりません");

    await prisma.todo.update({
      where: { id: todoId },
      data: { isCompleted: !currentTodo.isCompleted },
    });
    res.redirect("/?view=list");
  } catch (error) {
    console.error("タスクの更新に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 💡 6. タスクの削除
app.post("/todos/:id/delete", async (req, res) => {
  try {
    const poolTodoId = Number(req.params.id);
    await prisma.todo.delete({ where: { id: poolTodoId } });
    res.redirect("/?view=list");
  } catch (error) {
    console.error("タスクの削除に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 一日スケジュールへの配置・移動・時間変更・未配置化
app.post("/todos/:id/schedule", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    if (!Number.isInteger(todoId)) {
      return res.status(400).json({ error: "タスクIDが正しくありません" });
    }

    const { scheduleId, scheduledStart, scheduledEnd } = req.body;
    const parsedScheduleId =
      scheduleId === null || scheduleId === undefined
        ? null
        : Number(scheduleId);
    const isUnscheduled = scheduledStart === null && scheduledEnd === null;

    if (isUnscheduled) {
      if (!Number.isInteger(parsedScheduleId)) {
        return res.status(400).json({ error: "配置IDが正しくありません" });
      }

      await prisma.todoSchedule.deleteMany({
        where: { id: parsedScheduleId, todoId },
      });
      return res.json({
        scheduleId: parsedScheduleId,
        scheduledStart: null,
        scheduledEnd: null,
      });
    }

    const parsedStart = new Date(scheduledStart);
    const parsedEnd = new Date(scheduledEnd);
    if (
      Number.isNaN(parsedStart.getTime()) ||
      Number.isNaN(parsedEnd.getTime()) ||
      parsedEnd <= parsedStart
    ) {
      return res
        .status(400)
        .json({ error: "開始・終了時刻が正しくありません" });
    }

    const durationMinutes =
      (parsedEnd.getTime() - parsedStart.getTime()) / (1000 * 60);
    if (durationMinutes < 30 || durationMinutes > 24 * 60) {
      return res.status(400).json({
        error: "タスクの時間は30分以上24時間以内にしてください",
      });
    }

    let schedule;
    if (Number.isInteger(parsedScheduleId)) {
      const existingSchedule = await prisma.todoSchedule.findFirst({
        where: { id: parsedScheduleId, todoId },
      });
      if (!existingSchedule) {
        return res.status(404).json({ error: "配置が見つかりません" });
      }

      schedule = await prisma.todoSchedule.update({
        where: { id: parsedScheduleId },
        data: {
          scheduledStart: parsedStart,
          scheduledEnd: parsedEnd,
        },
      });
    } else {
      schedule = await prisma.todoSchedule.create({
        data: {
          todoId,
          scheduledStart: parsedStart,
          scheduledEnd: parsedEnd,
        },
      });
    }

    res.json({
      scheduleId: schedule.id,
      scheduledStart: schedule.scheduledStart.toISOString(),
      scheduledEnd: schedule.scheduledEnd.toISOString(),
    });
  } catch (error) {
    console.error("一日スケジュールの更新に失敗したぞよ:", error);
    res.status(500).json({ error: "スケジュールを保存できませんでした" });
  }
});

// 💡 7. カテゴリの非表示（論理削除）
app.post("/categories/:id/hide", async (req, res) => {
  try {
    const categoryId = Number(req.params.id);
    await prisma.category.update({
      where: { id: categoryId },
      data: { isActive: false },
    });
    res.redirect(getViewUrl(normalizeView(req.body.view)));
  } catch (error) {
    console.error("分類の非表示化に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

app.listen(PORT, () => {
  console.log(`サーバーが動いておるぞ！ http://localhost:${PORT}`);
});
