CREATE TABLE "ExtractionCandidate" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'needs_review',
    "facts" JSONB NOT NULL,
    "review" JSONB NOT NULL,
    "evidenceUnits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtractionCandidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExtractionCandidate_status_check" CHECK ("status" = 'needs_review')
);
CREATE UNIQUE INDEX "ExtractionCandidate_contentHash_key" ON "ExtractionCandidate"("contentHash");
CREATE INDEX "ExtractionCandidate_bundleId_createdAt_idx" ON "ExtractionCandidate"("bundleId", "createdAt");
