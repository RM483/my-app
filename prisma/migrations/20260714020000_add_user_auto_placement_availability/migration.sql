-- CreateTable: 将来ユーザー単位で設定を分けられる共通設定
CREATE TABLE "UserSetting" (
    "id" SERIAL NOT NULL,
    "userKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 曜日ごとの自動配置許可
CREATE TABLE "AutoPlacementDay" (
    "id" SERIAL NOT NULL,
    "userSettingId" INTEGER NOT NULL,
    "weekday" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AutoPlacementDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 曜日ごとの複数の許可時間帯
CREATE TABLE "AutoPlacementTimeRange" (
    "id" SERIAL NOT NULL,
    "dayId" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "AutoPlacementTimeRange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSetting_userKey_key"
    ON "UserSetting"("userKey");

CREATE UNIQUE INDEX "AutoPlacementDay_userSettingId_weekday_key"
    ON "AutoPlacementDay"("userSettingId", "weekday");

CREATE INDEX "AutoPlacementDay_userSettingId_idx"
    ON "AutoPlacementDay"("userSettingId");

CREATE INDEX "AutoPlacementTimeRange_dayId_idx"
    ON "AutoPlacementTimeRange"("dayId");

ALTER TABLE "AutoPlacementDay"
    ADD CONSTRAINT "AutoPlacementDay_userSettingId_fkey"
    FOREIGN KEY ("userSettingId") REFERENCES "UserSetting"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AutoPlacementTimeRange"
    ADD CONSTRAINT "AutoPlacementTimeRange_dayId_fkey"
    FOREIGN KEY ("dayId") REFERENCES "AutoPlacementDay"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
