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

// 一覧表示：DBから年齢も含めて取得する
app.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: "asc" }, // ID順に並べると見やすいぞ
  });
  res.render("index", { users });
});

// 追加処理：フォームから名前と年齢を受け取る
app.post("/users", async (req, res) => {
  const name = req.body.name;
  // 年齢は文字列で届くので、Number() で数字に変換するのじゃ
  const age = req.body.age ? Number(req.body.age) : null;

  if (name) {
    try {
      await prisma.user.create({
        data: { name, age },
      });
      console.log(`${name}さん（${age}歳）を追加したぞ！`);
    } catch (error) {
      console.error("保存に失敗したぞよ:", error);
    }
  }
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`サーバーが動いておるぞ！ http://localhost:${PORT}`);
});
