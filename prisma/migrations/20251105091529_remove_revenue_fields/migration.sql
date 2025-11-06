/*
  Warnings:

  - You are about to drop the column `bestsellersBy` on the `settings` table. All the data in the column will be lost.
  - You are about to drop the column `bestsellersRevenueCollectionId` on the `settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "settings" DROP COLUMN "bestsellersBy",
DROP COLUMN "bestsellersRevenueCollectionId",
ALTER COLUMN "bestsellersLookback" SET DEFAULT 180;
