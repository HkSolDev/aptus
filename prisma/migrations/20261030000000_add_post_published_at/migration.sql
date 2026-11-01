-- First-publication timestamp for "Newest" ordering.
-- Backfill only from reviewedAt, which the reviewed-publication path writes
-- at publication time. Rows without reviewedAt keep NULL: their first
-- publication time is unknown, and they sort last under "Newest" rather
-- than being silently assigned the migration time.
ALTER TABLE "Post" ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "Post" SET "publishedAt" = "reviewedAt" WHERE "reviewedAt" IS NOT NULL;

CREATE INDEX "Post_publishedAt_idx" ON "Post"("publishedAt");
