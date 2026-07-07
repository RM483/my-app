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
    // タスク一覧を取得（紐づく分類データも一緒に読み込む）
    const todos = await prisma.todo.findMany({
      include: { category: true },
      orderBy: { id: "asc" },
    });

    // 選択肢用のプルダウンに並べる「有効な分類」だけを取得する
    const activeCategories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });

    res.render("index", { todos, categories: activeCategories });
  } catch (error) {
    console.error("データ取得に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// タスクの追加処理
app.post("/todos", async (req, res) => {
  try {
    const { title, dueDate, categoryId, newCategory } = req.body;

    if (!title || title.trim() === "") {
      return res.redirect("/");
    }

    // 期日のデータ整形
    let parsedDueDate: Date | null = null;
    if (dueDate && dueDate.trim() !== "") {
      parsedDueDate = new Date(dueDate);
    }

    // 分類IDの決定ロジック
    let targetCategoryId: number | null = null;

    if (categoryId === "__NEW__" && newCategory && newCategory.trim() !== "") {
      // 「新しい分類を追加」が選ばれ、手入力がある場合はテーブルに新規登録
      const categoryName = newCategory.trim();

      // 過去に同じ名前が非表示であれば復活させ、なければ新規作成する（upsert）
      const category = await prisma.category.upsert({
        where: { name: categoryName },
        update: { isActive: true },
        create: { name: categoryName },
      });
      targetCategoryId = category.id;
    } else if (
      categoryId &&
      categoryId !== "指定なし" &&
      categoryId !== "__NEW__"
    ) {
      // 既存の分類が選ばれた場合
      targetCategoryId = Number(categoryId);
    }

    // タスクをデータベースに保存
    await prisma.todo.create({
      data: {
        title: title,
        dueDate: parsedDueDate,
        categoryId: targetCategoryId,
      },
    });
    res.redirect("/");
  } catch (error) {
    console.error("タスクの追加に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 【新設】タスクの「分類のみ」をその場で直接変更・消去する処理
app.post("/todos/:id/category", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const { categoryId } = req.body;

    // 「指定なし」が選ばれたらnullにし、それ以外は数値に変換して上書き
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

// 【新設】分類を「非表示（論理削除）」にする処理
app.post("/categories/:id/hide", async (req, res) => {
  try {
    const categoryId = Number(req.params.id);

    // データベースから完全に消さず、有効フラグをfalseにして隠す
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
