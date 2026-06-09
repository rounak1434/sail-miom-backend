-- Google auth: nullable password/employeeId for Google-only accounts, add googleId + authProvider
ALTER TABLE "User" ALTER COLUMN "employeeId" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
ALTER TABLE "User" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
