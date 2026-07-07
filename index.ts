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
app.use(express.urlencoded({ extended: true }));

// 💡 1. タスク一覧の取得（自動並び替えロジック付き）
app.get("/", async (req, res) => {
  try {
    const errorType = req.query.error as string | undefined;

    // データベースからすべてのタスクを取得
    const todos = await prisma.todo.findMany({
      include: { category: true },
    });

    // 💡 ryotoさん特製：自動並び替えロジック
    const sortedTodos = todos.sort((a, b) => {
      // ① 未完了を上に、完了したものを下に並べる
      if (a.isCompleted !== b.isCompleted) {
        return a.isCompleted ? 1 : -1;
      }

      // ② 期日が近いものを上に並べる（期日なしは一番下）
      if (a.dueDate && b.dueDate) {
        if (a.dueDate.getTime() !== b.dueDate.getTime()) {
          return a.dueDate.getTime() - b.dueDate.getTime();
        }
      } else if (a.dueDate) {
        return -1; // aだけ期日ありならaが上
      } else if (b.dueDate) {
        return 1; // bだけ期日ありならbが上
      }

      // ③ 重要度が高い順に並べる（高 > 中 > 低）
      const priorityMap: { [key: string]: number } = { 高: 1, 中: 2, 低: 3 };
      const priorityA = priorityMap[a.priority] || 2;
      const priorityB = priorityMap[b.priority] || 2;
      return priorityA - priorityB;
    });

    // 有効なカテゴリを取得
    const activeCategories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });

    // 並び替えたタスク（sortedTodos）を画面に渡す
    res.render("index", {
      todos: sortedTodos,
      categories: activeCategories,
      error: errorType,
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

    // 自由入力モードと詳細入力モードのどちらから来てもタイトルを取得できるようにする
    const rawTitle = title || titleSimple;

    if (!rawTitle || rawTitle.trim() === "") {
      return res.redirect("/");
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
      return res.redirect("/?error=duplicate");
    }

    let targetCategoryId: number | null = null;

    // 新しいカテゴリの追加処理
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

    // タスク作成
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

// 💡 3. ★新機能★ タスク名・期日・重要度のその場更新ルート（重複チェック付き強化版）
app.post("/todos/:id/update", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const { title, dueDate, priority } = req.body;

    // 現在のタスクの情報を一度取得（変更されなかった値と比較するため）
    const currentTodo = await prisma.todo.findUnique({
      where: { id: todoId },
    });
    if (!currentTodo) return res.status(404).send("タスクが見つかりません");

    // 1. 変更後の「タスク名」と「期日」を確定させる
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

    // 空文字にされようとした場合は無視して戻す
    if (finalTitle === "") return res.redirect("/");

    // 2. 🚨 【重要】重複チェック（自分以外のタスクで、名前と期日がかぶるものがないか？）
    const duplicateTodo = await prisma.todo.findFirst({
      where: {
        id: { not: todoId }, // 自分自身は除外する
        title: finalTitle,
        dueDate: finalDueDate,
      },
    });

    // かぶるタスクがあったら、更新せずにエラーを返す
    if (duplicateTodo) {
      return res.redirect("/?error=duplicate");
    }

    // 3. 重複がなければデータベースを更新
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
    const todoId = Number(req.params.id);
    await prisma.todo.delete({ where: { id: todoId } });
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
