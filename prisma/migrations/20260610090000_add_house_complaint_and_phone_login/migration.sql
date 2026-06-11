-- House-maintenance complaint detail fields
ALTER TABLE "Complaint" ADD COLUMN "houseOwnerName" TEXT;
ALTER TABLE "Complaint" ADD COLUMN "houseOwnerPhone" TEXT;
ALTER TABLE "Complaint" ADD COLUMN "landmark" TEXT;
-- Phone-number login identifier (unique; required for PUBLIC at the app layer)
ALTER TABLE "User" ADD COLUMN "phoneNumber" TEXT;
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");
