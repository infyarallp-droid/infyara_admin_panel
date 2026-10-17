-- Blog articles on the website.

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "cover_image_url" TEXT,
    "cover_alt" TEXT,
    "author_name" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seo_title" TEXT,
    "seo_description" TEXT,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_published_at_idx" ON "blog_posts"("status", "published_at");
