/*
  Warnings:

  - Made the column `primarySortOrder` on table `CollectionSetting` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "AppCollection" ADD COLUMN     "isManagedByApp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalSortOrder" TEXT;

-- AlterTable
ALTER TABLE "CollectionSetting" ADD COLUMN     "manualSortOrder" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "primarySortOrder" SET NOT NULL,
ALTER COLUMN "primarySortOrder" SET DEFAULT 'random-high-low',
ALTER COLUMN "lookbackPeriod" SET DEFAULT 180;

-- AlterTable
ALTER TABLE "FeaturedSettings" ADD COLUMN     "manualSortOrder" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductBehaviorRule" ALTER COLUMN "pushNewProductsUp" SET DEFAULT true,
ALTER COLUMN "pushDownOutOfStock" SET DEFAULT true,
ALTER COLUMN "outOfStockVsNewPriority" SET DEFAULT 'push-down',
ALTER COLUMN "outOfStockVsFeaturedPriority" SET DEFAULT 'push-down',
ALTER COLUMN "outOfStockVsTagsPriority" SET DEFAULT 'position-defined';
