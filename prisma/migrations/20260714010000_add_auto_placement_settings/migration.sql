-- AlterTable: 手動のスケジュール配置時間とは独立した自動配置用設定
ALTER TABLE "Todo"
ADD COLUMN "estimatedMinutes" INTEGER,
ADD COLUMN "isSplittable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "splitMinutes" INTEGER;

