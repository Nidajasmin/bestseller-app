-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "bestsellersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bestsellersTag" TEXT NOT NULL DEFAULT 'bestsellers-resort',
    "bestsellersCount" INTEGER NOT NULL DEFAULT 50,
    "bestsellersBy" TEXT NOT NULL DEFAULT 'sales',
    "bestsellersLookback" INTEGER NOT NULL DEFAULT 20,
    "bestsellersExcludeOOS" BOOLEAN NOT NULL DEFAULT true,
    "bestsellersCreateCollection" BOOLEAN NOT NULL DEFAULT true,
    "bestsellersCollectionId" TEXT,
    "trendingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "trendingTag" TEXT NOT NULL DEFAULT 'br-trending',
    "trendingCount" INTEGER NOT NULL DEFAULT 50,
    "trendingLookback" INTEGER NOT NULL DEFAULT 7,
    "trendingExcludeOOS" BOOLEAN NOT NULL DEFAULT false,
    "trendingCreateCollection" BOOLEAN NOT NULL DEFAULT false,
    "trendingCollectionId" TEXT,
    "trendingCollectionTitle" TEXT,
    "newArrivalsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "newArrivalsTag" TEXT NOT NULL DEFAULT 'br-new',
    "newArrivalsCount" INTEGER NOT NULL DEFAULT 50,
    "newArrivalsPeriod" INTEGER NOT NULL DEFAULT 7,
    "newArrivalsExcludeOOS" BOOLEAN NOT NULL DEFAULT true,
    "newArrivalsCreateCollection" BOOLEAN NOT NULL DEFAULT true,
    "newArrivalsCollectionId" TEXT,
    "newArrivalsCollectionTitle" TEXT,
    "agingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "agingTag" TEXT NOT NULL DEFAULT 'br-aging',
    "agingCount" INTEGER NOT NULL DEFAULT 50,
    "agingLookback" INTEGER NOT NULL DEFAULT 90,
    "agingCreateCollection" BOOLEAN NOT NULL DEFAULT true,
    "agingCollectionId" TEXT,
    "agingCollectionTitle" TEXT,
    "excludeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "excludeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "id" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settings_shopifyDomain_key" ON "settings"("shopifyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "collections_shopifyId_key" ON "collections"("shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_tags_shopifyId_tag_key" ON "product_tags"("shopifyId", "tag");

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_shopifyDomain_fkey" FOREIGN KEY ("shopifyDomain") REFERENCES "Shop"("shopifyDomain") ON DELETE CASCADE ON UPDATE CASCADE;
