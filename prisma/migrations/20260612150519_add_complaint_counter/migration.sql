-- CreateTable
CREATE TABLE "ComplaintCounter" (
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ComplaintCounter_pkey" PRIMARY KEY ("year")
);
