/*
  Warnings:

  - You are about to drop the column `isManagedByApp` on the `AppCollection` table. All the data in the column will be lost.
  - You are about to drop the column `originalSortOrder` on the `AppCollection` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AppCollection" DROP COLUMN "isManagedByApp",
DROP COLUMN "originalSortOrder";
