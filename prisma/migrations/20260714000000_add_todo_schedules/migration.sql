-- CreateTable
CREATE TABLE IF NOT EXISTS "TodoSchedule" (
    "id" SERIAL NOT NULL,
    "todoId" INTEGER NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoSchedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TodoSchedule_todoId_fkey"
      FOREIGN KEY ("todoId") REFERENCES "Todo"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS
  "TodoSchedule_todoId_scheduledStart_scheduledEnd_key"
  ON "TodoSchedule"("todoId", "scheduledStart", "scheduledEnd");

CREATE INDEX IF NOT EXISTS
  "TodoSchedule_scheduledStart_idx"
  ON "TodoSchedule"("scheduledStart");

-- Preserve schedules created before the one-to-many schedule model was added.
INSERT INTO "TodoSchedule" ("todoId", "scheduledStart", "scheduledEnd")
SELECT "id", "scheduledStart", "scheduledEnd"
FROM "Todo"
WHERE "scheduledStart" IS NOT NULL AND "scheduledEnd" IS NOT NULL
ON CONFLICT ("todoId", "scheduledStart", "scheduledEnd") DO NOTHING;
