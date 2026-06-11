-- PUBLIC house-maintenance complaints: no SAIL plant location/installation, carry an address
ALTER TABLE "Complaint" ALTER COLUMN "locationId" DROP NOT NULL;
ALTER TABLE "Complaint" ALTER COLUMN "installationTypeId" DROP NOT NULL;
ALTER TABLE "Complaint" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "Complaint" ADD COLUMN "address" TEXT;
