CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "holdReason" TEXT,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewItem_bundleId_key" ON "ReviewItem"("bundleId");
CREATE INDEX "ReviewItem_status_updatedAt_idx" ON "ReviewItem"("status", "updatedAt");

CREATE TABLE "ReviewRevision" (
    "id" TEXT NOT NULL,
    "reviewItemId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "parentRevisionId" TEXT,
    "facts" JSONB NOT NULL,
    "sourceEvidence" JSONB NOT NULL,
    "evidenceUnits" JSONB NOT NULL,
    "rawDigest" TEXT,
    "canonicalHash" TEXT NOT NULL,
    "changeReason" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'worker_import',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validationState" TEXT NOT NULL DEFAULT 'none',

    CONSTRAINT "ReviewRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewRevision_reviewItemId_revisionNumber_key" ON "ReviewRevision"("reviewItemId", "revisionNumber");
CREATE INDEX "ReviewRevision_canonicalHash_idx" ON "ReviewRevision"("canonicalHash");

CREATE TABLE "ValidationTask" (
    "id" TEXT NOT NULL,
    "reviewRevisionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "validatorVersion" TEXT NOT NULL DEFAULT 'aptus-val-v1',
    "claimToken" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "result" JSONB,
    "errorDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ValidationTask_status_claimExpiresAt_idx" ON "ValidationTask"("status", "claimExpiresAt");
CREATE INDEX "ValidationTask_reviewRevisionId_validatorVersion_idx" ON "ValidationTask"("reviewRevisionId", "validatorVersion");

ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_currentRevisionId_fkey"
    FOREIGN KEY ("currentRevisionId") REFERENCES "ReviewRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReviewRevision" ADD CONSTRAINT "ReviewRevision_reviewItemId_fkey"
    FOREIGN KEY ("reviewItemId") REFERENCES "ReviewItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReviewRevision" ADD CONSTRAINT "ReviewRevision_parentRevisionId_fkey"
    FOREIGN KEY ("parentRevisionId") REFERENCES "ReviewRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ValidationTask" ADD CONSTRAINT "ValidationTask_reviewRevisionId_fkey"
    FOREIGN KEY ("reviewRevisionId") REFERENCES "ReviewRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
