import "dotenv/config";
import express from "express";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });
const app = express();
const PORT = process.env.PORT || 8888;

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

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
    default:
      return null;
  }
}

function getDateInputValue(dateValue: Date | null) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

  const values: Record<string, any> = {
    title: titleValue,
    titleSimple: titleSimpleValue,
    dueDate: dueDateValue,
    priority: priorityValue,
    categoryId: categoryIdValue,
    newCategory: newCategoryValue,
    currentMode,
  };

  if (currentTodo) {
    values["todo-" + currentTodo.id + "-title"] =
      body.title ?? currentTodo.title;
    values["todo-" + currentTodo.id + "-dueDate"] =
      body.dueDate ?? getDateInputValue(currentTodo.dueDate);
    values["todo-" + currentTodo.id + "-priority"] =
      body.priority ?? currentTodo.priority;
  }

  return values;
}

async function renderIndexPage(
  res: express.Response,
  options: {
    todos: any[];
    errorType?: string;
    formValues?: Record<string, any>;
    duplicateTodoId?: number | null;
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
  const sortedTodos = [...options.todos].sort((a, b) => {
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

  res.render("index", {
    todos: sortedTodos,
    categories: allDisplayCategories,
    error: options.errorType,
    errorMessage: getErrorMessage(options.errorType),
    formValues: options.formValues || {},
    duplicateTodoId: options.duplicateTodoId ?? null,
  });
}

// 💡 1. タスク一覧の取得（自動並び替え ＆ カテゴリ維持ロジック付き）
app.get("/", async (req, res) => {
  try {
    const errorType = req.query.error as string | undefined;

    const todos = await prisma.todo.findMany({
      include: { category: true },
    });

    await renderIndexPage(res, {
      todos,
      errorType,
      formValues: {},
    });
  } catch (error) {
    console.error("データ取得に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 💡 2. 新しいタスクの追加（重複防止ロジック付き）
app.post("/todos", async (req, res) => {
  try {
    const { title, dueDate, categoryId, newCategory, priority, titleSimple } =
      req.body;

    const rawTitle = title || titleSimple;
    if (!rawTitle || rawTitle.trim() === "") {
      const todos = await prisma.todo.findMany({ include: { category: true } });
      return renderIndexPage(res, {
        todos,
        errorType: "emptyTitle",
        formValues: buildEmptyFormValues(),
      });
    }

    const cleanedTitle = rawTitle.trim();

    let parsedDueDate: Date | null = null;
    if (dueDate && dueDate.trim() !== "") {
      parsedDueDate = new Date(dueDate);
      parsedDueDate.setHours(0, 0, 0, 0);
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
      },
    });
    res.redirect("/");
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

    res.redirect("/");
  } catch (error) {
    console.error("タスクの直接更新に失敗したぞよ:", error);
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
    res.redirect("/");
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
      return res.redirect("/");
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

    res.redirect("/");
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
    res.redirect("/");
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
    res.redirect("/");
  } catch (error) {
    console.error("タスクの削除に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
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
    res.redirect("/");
  } catch (error) {
    console.error("分類の非表示化に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

app.listen(PORT, () => {
  console.log(`サーバーが動いておるぞ！ http://localhost:${PORT}`);
});
