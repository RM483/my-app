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

// タスクの追加処理（Create）
app.post("/todos", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || title.trim() === "") {
      return res.redirect("/");
    }
    await prisma.todo.create({
      data: { title: title },
    });
    res.redirect("/");
  } catch (error) {
    console.error("タスクの追加に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 【変更】タスクの状態更新処理（Update）
app.post("/todos/:id/toggle", async (req, res) => {
  try {
    // URLからタスクのIDを取得し、数値（number）に変換する
    const todoId = Number(req.params.id);

    // 1. まず、現在のタスクの状態をデータベースから1件取得して調べる
    const currentTodo = await prisma.todo.findUnique({
      where: { id: todoId },
    });

    if (!currentTodo) {
      return res.status(404).send("タスクが見つかりません");
    }

    // 2. Prismaを使って、isCompleted の真偽値（true / false）を反転させて更新する
    await prisma.todo.update({
      where: { id: todoId },
      data: {
        isCompleted: !currentTodo.isCompleted, // trueならfalseに、falseならtrueにする
      },
    });

    // 更新が終わったらトップ画面に戻す
    res.redirect("/");
  } catch (error) {
    console.error("タスクの更新に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

app.listen(PORT, () => {
  console.log(`サーバーが動いておるぞ！ http://localhost:${PORT}`);
});
