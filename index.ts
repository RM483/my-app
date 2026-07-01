import "dotenv/config";
import express from "express";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// 【解説】データベースとの接続設定（Prisma 7の推奨構成）
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });

const app = express();
const PORT = process.env.PORT || 8888;

app.set("view engine", "ejs");
app.set("views", "./views");
app.use(express.urlencoded({ extended: true }));

// 【変更】一覧表示：DBからTodo（タスク）を全件取得して画面に渡す
app.get("/", async (req, res) => {
  try {
    // Prismaを使って、TodoテーブルからデータをIDが昇順（古い順）になるように取得
    const todos = await prisma.todo.findMany({
      orderBy: { id: "asc" },
    });
    // index.ejs をレンダリング（表示）。その際、取得したtodosデータを画面に渡す
    res.render("index", { todos });
  } catch (error) {
    console.error("データ取得に失敗したぞよ:", error);
    res.status(500).send("エラーが発生しました");
  }
});

// 【一時変更】古いユーザー追加処理は一旦無効化（次のステップでタスク追加に書き換えます）
app.post("/users", async (req, res) => {
  console.log("ユーザー追加は現在無効化されています");
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`サーバーが動いておるぞ！ http://localhost:${PORT}`);
});
