-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('TENTH', 'TWELFTH', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'PHD');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "minEducationLevel" "EducationLevel";

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "categoryRelaxationRules" JSONB;
