-- CreateEnum
CREATE TYPE "PostGroup" AS ENUM ('A', 'B', 'C', 'D');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "postGroup" "PostGroup";
