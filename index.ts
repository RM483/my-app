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

// 一覧表示：タスク一覧と有効な分類一覧を取得して画面に渡す
app.get("/", async (req, res) => {
  try {
    // URLのパラメータからエラーの種類（あれば）を取得
    const errorType = req.query.error as string | undefined;

    // タスク一覧を取得
    const todos = await prisma.todo.findMany({
      include: { category: true },
      orderBy: { id: "asc" },
    });

    // 有効な分類一覧を取得
    const activeCategories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });

    // 画面に errorType も一緒に渡す
    res.render("index", {
      todos,
      categories: activeCategories,
      error: errorType,
    });
  } catch (error) {
    console.error("データ取得に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// タスクの追加処理
app.post("/todos", async (req, res) => {
  try {
    const { title, dueDate, categoryId, newCategory, priority } = req.body;

    if (!title || title.trim() === "") {
      return res.redirect("/");
    }

    const cleanedTitle = title.trim();

    // 期日のデータ整形
    let parsedDueDate: Date | null = null;
    if (dueDate && dueDate.trim() !== "") {
      // 日時が被っているかを正確に判定するため、時間のズレをなくした「日付のみ」の状態にする
      parsedDueDate = new Date(dueDate);
      parsedDueDate.setHours(0, 0, 0, 0);
    }

    // 🚨【新設】タスクの重複チェックロジック
    // 「タイトルが一致」かつ「期日が一致（両方なし、または同じ日付）」のものを探す
    const existingTodo = await prisma.todo.findFirst({
      where: {
        title: cleanedTitle,
        dueDate: parsedDueDate, // null 同士、または同じ日付オブジェクト同士で比較
      },
    });

    // もし既に見つかった場合は、URLにエラーをつけてトップに戻す（追加しない）
    if (existingTodo) {
      return res.redirect("/?error=duplicate");
    }

    // 分類IDの決定ロジック
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

    // 重複がなければタスクをデータベースに保存
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

// タスクの「分類のみ」をその場で直接変更・消去する処理
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

// タスクの状態更新処理（完了・未完了の切り替え）
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

// タスクの削除処理
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

// 分類を「非表示（論理削除）」にする処理
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
