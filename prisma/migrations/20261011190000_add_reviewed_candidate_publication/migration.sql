ALTER TABLE "Post"
ADD COLUMN "extractionCandidateId" TEXT,
ADD COLUMN "candidatePostIndex" INTEGER,
ADD COLUMN "reviewedDetails" JSONB,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "Post" ADD CONSTRAINT "Post_extractionCandidateId_fkey"
FOREIGN KEY ("extractionCandidateId") REFERENCES "ExtractionCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_candidate_publication_check" CHECK (
("extractionCandidateId" IS NULL AND "candidatePostIndex" IS NULL) OR
("extractionCandidateId" IS NOT NULL AND "candidatePostIndex" IS NOT NULL AND "candidatePostIndex" >= 0 AND "reviewedDetails" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL AND length(trim("reviewNote")) > 0));
CREATE UNIQUE INDEX "Post_extractionCandidateId_candidatePostIndex_key" ON "Post"("extractionCandidateId", "candidatePostIndex");
