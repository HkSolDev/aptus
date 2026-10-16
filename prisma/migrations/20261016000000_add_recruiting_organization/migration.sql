-- Existing posts remain unknown until their notices are re-extracted.
ALTER TABLE "Post" ADD COLUMN "organization" TEXT;
