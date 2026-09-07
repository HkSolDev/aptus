-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "rawHash" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "postName" TEXT NOT NULL,
    "payLevel" TEXT,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "educationRequired" TEXT,
    "minMarksPercent" DOUBLE PRECISION,
    "categoryRelaxationApplies" BOOLEAN,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
