-- Add login identities without rewriting existing applicant data.
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- No default or backfill: every existing profile receives NULL ownership.
ALTER TABLE "User" ADD COLUMN "authUserId" TEXT;
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");
ALTER TABLE "User" ADD CONSTRAINT "User_authUserId_fkey"
    FOREIGN KEY ("authUserId") REFERENCES "AuthUser"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
