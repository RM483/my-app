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

// 一覧表示：DBからTodo（タスク）を全件取得して画面に渡す
app.get("/", async (req, res) => {
  try {
    const todos = await prisma.todo.findMany({
      orderBy: { id: "asc" },
    });
    res.render("index", { todos });
  } catch (error) {
    console.error("データ取得に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 【変更】タスクの追加処理（Create）：期日も一緒に保存できるように拡張
app.post("/todos", async (req, res) => {
  try {
    const { title, dueDate } = req.body; // 画面から title と dueDate を受け取る

    if (!title || title.trim() === "") {
      return res.redirect("/");
    }

    // データベースに保存する用のデータ型を作る
    let parsedDueDate: Date | null = null;
    if (dueDate && dueDate.trim() !== "") {
      // 画面から日付が送られてきたら、文字列から「日付オブジェクト（Date）」に変換する
      parsedDueDate = new Date(dueDate);
    }

    await prisma.todo.create({
      data: {
        title: title,
        dueDate: parsedDueDate, // 【追加】変換した期日を保存する（入力がなければ null）
      },
    });
    res.redirect("/");
  } catch (error) {
    console.error("タスクの追加に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// タスクの状態更新処理（Update）
app.post("/todos/:id/toggle", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    const currentTodo = await prisma.todo.findUnique({
      where: { id: todoId },
    });

    if (!currentTodo) {
      return res.status(404).send("タスクが見つかりません");
    }

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

// タスクの削除処理（Delete）
app.post("/todos/:id/delete", async (req, res) => {
  try {
    const todoId = Number(req.params.id);
    await prisma.todo.delete({
      where: { id: todoId },
    });
    res.redirect("/");
  } catch (error) {
    console.error("タスクの削除に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

app.listen(PORT, () => {
  console.log(`サーバーが動いておるぞ！ http://localhost:${PORT}`);
});
