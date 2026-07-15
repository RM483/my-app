-- AlterTable: タスクごとの1日の自動配置時間上限（既存タスクは未設定のまま保持）
ALTER TABLE "Todo"
ADD COLUMN "dailyLimitMinutes" INTEGER;
