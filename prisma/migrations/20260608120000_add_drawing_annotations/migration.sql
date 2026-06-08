-- CreateTable
CREATE TABLE "DrawingAnnotation" (
    "id" SERIAL NOT NULL,
    "drawingId" INTEGER NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'stroke',
    "data" JSONB NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DrawingAnnotation_drawingId_idx" ON "DrawingAnnotation"("drawingId");

-- AddForeignKey
ALTER TABLE "DrawingAnnotation" ADD CONSTRAINT "DrawingAnnotation_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingAnnotation" ADD CONSTRAINT "DrawingAnnotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
