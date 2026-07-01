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

// 【変更】タスクの追加処理（Create）
app.post("/todos", async (req, res) => {
  try {
    // 画面の入力フォーム（name="title"）から送信された文字を取得
    const { title } = req.body;

    // もし入力が空っぽなら、何もせずトップ画面に戻す（安全対策）
    if (!title || title.trim() === "") {
      return res.redirect("/");
    }

    // Prismaを使って、データベースのTodoテーブルに新しいレコードを挿入（保存）
    await prisma.todo.create({
      data: {
        title: title, // 入力されたタスク名
        // isCompleted は初期値(false)が自動で入るため、ここでは省略してOKです
      },
    });

    // 保存が終わったら、新しくなったリストを表示するためにトップ画面にリダイレクト（再読み込み）
    res.redirect("/");
  } catch (error) {
    console.error("タスクの追加に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 古いユーザー追加用ルートは、もう使わないので削除または無効化
app.post("/users", (req, res) => {
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`サーバーが動いておるぞ！ http://localhost:${PORT}`);
});
