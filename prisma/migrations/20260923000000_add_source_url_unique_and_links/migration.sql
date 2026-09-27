-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "notificationPdfUrl" TEXT,
ADD COLUMN     "officialSiteUrl" TEXT,
ADD COLUMN     "applyUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Source_url_key" ON "Source"("url");
