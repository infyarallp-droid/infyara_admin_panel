-- Online (Zoom) classes, shown to students enrolled in the course.

-- CreateTable
CREATE TABLE "zoom_classes" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "class_timing_id" UUID,
    "title" TEXT NOT NULL,
    "meeting_url" TEXT NOT NULL,
    "meeting_id" TEXT,
    "passcode" TEXT,
    "days" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_time" TEXT,
    "starts_at" TIMESTAMP(3),
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zoom_classes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zoom_classes_course_id_is_active_idx" ON "zoom_classes"("course_id", "is_active");

-- AddForeignKey
ALTER TABLE "zoom_classes" ADD CONSTRAINT "zoom_classes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zoom_classes" ADD CONSTRAINT "zoom_classes_class_timing_id_fkey" FOREIGN KEY ("class_timing_id") REFERENCES "class_timings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
