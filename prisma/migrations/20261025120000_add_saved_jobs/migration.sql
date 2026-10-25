CREATE TABLE "SavedJob" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedJob_authUserId_postId_key" ON "SavedJob"("authUserId", "postId");
CREATE INDEX "SavedJob_authUserId_savedAt_idx" ON "SavedJob"("authUserId", "savedAt");

ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_authUserId_fkey"
    FOREIGN KEY ("authUserId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SavedJob" ADD CONSTRAINT "SavedJob_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
