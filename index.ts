import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// データベースに接続するための準備じゃ
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter, log: ["query"] });

async function main() {
  console.log("DBにデータを書き込んでみるぞ...");

  // ユーザーを 1 件追加する
  await prisma.user.create({
    data: { name: `ユーザー ${new Date().toISOString()}` },
  });

  // 追加されたユーザーも含め、全員分を表示する
  const users = await prisma.user.findMany();
  console.log("現在のユーザー一覧:", users);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  // prisma と pool の両方を閉じないと、プログラムが終了せずに残ってしまうのじゃ
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
