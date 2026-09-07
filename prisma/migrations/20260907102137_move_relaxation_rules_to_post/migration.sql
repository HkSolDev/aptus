/*
  Warnings:

  - You are about to drop the column `categoryRelaxationRules` on the `Source` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "categoryRelaxationRules" JSONB;

-- AlterTable
ALTER TABLE "Source" DROP COLUMN "categoryRelaxationRules";
