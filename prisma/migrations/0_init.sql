-- CreateTable
CREATE TABLE "Shop" (
    "shopifyDomain" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("shopifyDomain")
);

-- CreateTable
CREATE TABLE "AppCollection" (
    "id" SERIAL NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AppCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionSetting" (
    "id" SERIAL NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "useCustomSorting" BOOLEAN NOT NULL DEFAULT false,
    "primarySortOrder" TEXT NOT NULL DEFAULT 'random-high-low',
    "sortCriteria" TEXT,
    "sortOrderMode" TEXT,
    "lookbackPeriod" INTEGER NOT NULL DEFAULT 180,
    "includeDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "ordersRange" TEXT NOT NULL DEFAULT 'all-orders',
    "manualSortOrder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedProduct" (
    "id" SERIAL NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "featuredType" TEXT NOT NULL DEFAULT 'manual',
    "daysToFeature" INTEGER,
    "startDate" TIMESTAMP(3),
    "scheduleApplied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSettings" (
    "id" SERIAL NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "sortOrder" TEXT NOT NULL DEFAULT 'manual',
    "limitFeatured" INTEGER NOT NULL DEFAULT 0,
    "manualSortOrder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBehaviorRule" (
    "id" SERIAL NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "pushNewProductsUp" BOOLEAN NOT NULL DEFAULT true,
    "newProductDays" INTEGER NOT NULL DEFAULT 7,
    "pushDownOutOfStock" BOOLEAN NOT NULL DEFAULT true,
    "outOfStockVsNewPriority" TEXT NOT NULL DEFAULT 'push-down',
    "outOfStockVsFeaturedPriority" TEXT NOT NULL DEFAULT 'push-down',
    "outOfStockVsTagsPriority" TEXT NOT NULL DEFAULT 'position-defined',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductBehaviorRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagSortingRule" (
    "id" SERIAL NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "tagName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagSortingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT true,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT,
    "userId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT,
    "collaborator" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "bestsellersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bestsellersTag" TEXT NOT NULL DEFAULT 'bestsellers-resort',
    "bestsellersCount" INTEGER NOT NULL DEFAULT 50,
    "bestsellersLookback" INTEGER NOT NULL DEFAULT 180,
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
CREATE UNIQUE INDEX "AppCollection_shopifyDomain_collectionId_key" ON "AppCollection"("shopifyDomain", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSetting_shopifyDomain_collectionId_key" ON "CollectionSetting"("shopifyDomain", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedProduct_shopifyDomain_collectionId_productId_key" ON "FeaturedProduct"("shopifyDomain", "collectionId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedSettings_shopifyDomain_collectionId_key" ON "FeaturedSettings"("shopifyDomain", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBehaviorRule_shopifyDomain_collectionId_key" ON "ProductBehaviorRule"("shopifyDomain", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "TagSortingRule_shopifyDomain_collectionId_tagName_key" ON "TagSortingRule"("shopifyDomain", "collectionId", "tagName");

-- CreateIndex
CREATE UNIQUE INDEX "Session_shop_key" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "settings_shopifyDomain_key" ON "settings"("shopifyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "collections_shopifyId_key" ON "collections"("shopifyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_tags_shopifyId_tag_key" ON "product_tags"("shopifyId", "tag");

-- AddForeignKey
ALTER TABLE "AppCollection" ADD CONSTRAINT "AppCollection_shopifyDomain_fkey" FOREIGN KEY ("shopifyDomain") REFERENCES "Shop"("shopifyDomain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionSetting" ADD CONSTRAINT "CollectionSetting_shopifyDomain_collectionId_fkey" FOREIGN KEY ("shopifyDomain", "collectionId") REFERENCES "AppCollection"("shopifyDomain", "collectionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedProduct" ADD CONSTRAINT "FeaturedProduct_shopifyDomain_collectionId_fkey" FOREIGN KEY ("shopifyDomain", "collectionId") REFERENCES "AppCollection"("shopifyDomain", "collectionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSettings" ADD CONSTRAINT "FeaturedSettings_shopifyDomain_collectionId_fkey" FOREIGN KEY ("shopifyDomain", "collectionId") REFERENCES "AppCollection"("shopifyDomain", "collectionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBehaviorRule" ADD CONSTRAINT "ProductBehaviorRule_shopifyDomain_collectionId_fkey" FOREIGN KEY ("shopifyDomain", "collectionId") REFERENCES "AppCollection"("shopifyDomain", "collectionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagSortingRule" ADD CONSTRAINT "TagSortingRule_shopifyDomain_collectionId_fkey" FOREIGN KEY ("shopifyDomain", "collectionId") REFERENCES "AppCollection"("shopifyDomain", "collectionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_shopifyDomain_fkey" FOREIGN KEY ("shopifyDomain") REFERENCES "Shop"("shopifyDomain") ON DELETE CASCADE ON UPDATE CASCADE;

