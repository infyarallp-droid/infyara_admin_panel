import { Router } from 'express';
import { CONTENT_BLOCKS } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { safeEqual } from '../../lib/tokens.js';

// Public, read-only website content. One request returns everything the website
// renders; the website caches it and is told to refresh when an admin publishes.
// ?preview=1 (website server only, with the service key) includes unpublished drafts.
export const publicContentRouter = Router();

const DELIVERY: Record<string, string> = { OFFLINE: 'Studio', ONLINE: 'Online', HYBRID: 'Studio & Online' };
const DISCIPLINE: Record<string, string> = { YOGA: 'Yoga', PILATES: 'Pilates', DANCE: 'Dance' };

publicContentRouter.get(
  '/site',
  asyncHandler(async (req, res) => {
    const preview = req.query.preview === '1';
    if (preview && !safeEqual(req.headers['x-service-key'] as string | undefined, env.WEBSITE_SERVICE_KEY)) {
      throw new HttpError(401, 'Preview is only available to the website');
    }
    const site = await loadPublicSite(preview);
    res.setHeader('Cache-Control', preview ? 'no-store' : 'public, max-age=30, stale-while-revalidate=300');
    // The chatbot's extra facts and instructions are for the assistant only, not the public site data.
    const bot = site.blocks['chatbot.settings'] as Record<string, unknown> | null;
    const blocks = { ...site.blocks, 'chatbot.settings': bot && { ...bot, knowledge: undefined, rules: undefined } };
    res.json({ ok: true, ...site, blocks });
  }),
);

// ───────────────────────── Blog ─────────────────────────
// Articles are not part of /site (bodies can be long): the list and each article load separately.

function previewRequested(req: { query: Record<string, unknown>; headers: Record<string, unknown> }) {
  const preview = req.query.preview === '1';
  if (preview && !safeEqual(req.headers['x-service-key'] as string | undefined, env.WEBSITE_SERVICE_KEY)) {
    throw new HttpError(401, 'Preview is only available to the website');
  }
  return preview;
}

const blogVisible = (preview: boolean) =>
  preview ? { status: { in: ['PUBLISHED', 'DRAFT'] as ('PUBLISHED' | 'DRAFT')[] } } : { status: 'PUBLISHED' as const, publishedAt: { lte: new Date() } };
const blogOrder = [{ isFeatured: 'desc' as const }, { publishedAt: { sort: 'desc' as const, nulls: 'first' as const } }, { createdAt: 'desc' as const }];
const blogCard = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageUrl: true,
  coverAlt: true,
  authorName: true,
  tags: true,
  isFeatured: true,
  publishedAt: true,
  status: true,
} as const;

/** About 200 words a minute, at least one. */
const readMinutes = (body: string) => Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));

// GET /api/public/blog — every visible article, without the body.
publicContentRouter.get(
  '/blog',
  asyncHandler(async (req, res) => {
    const preview = previewRequested(req);
    const posts = await prisma.blogPost.findMany({ where: blogVisible(preview), orderBy: blogOrder, select: { ...blogCard, body: true } });
    res.setHeader('Cache-Control', preview ? 'no-store' : 'public, max-age=30, stale-while-revalidate=300');
    res.json({ ok: true, posts: posts.map(({ body, ...p }) => ({ ...p, readMinutes: readMinutes(body) })) });
  }),
);

// GET /api/public/blog/:slug — one article with a few others to read next.
publicContentRouter.get(
  '/blog/:slug',
  asyncHandler(async (req, res) => {
    const preview = previewRequested(req);
    const slug = String(req.params.slug).toLowerCase().slice(0, 100);
    const post = await prisma.blogPost.findFirst({ where: { ...blogVisible(preview), slug } });
    if (!post) throw new HttpError(404, 'Article not found');
    const others = await prisma.blogPost.findMany({
      where: { ...blogVisible(preview), id: { not: post.id } },
      orderBy: [{ publishedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: { ...blogCard, body: true },
      take: 12,
    });
    // Prefer articles that share a tag, then the newest.
    const shared = (tags: string[]) => tags.filter((t) => post.tags.includes(t)).length;
    const related = others
      .map((p, i) => ({ p, score: shared(p.tags) * 100 - i }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ p: { body, ...p } }) => ({ ...p, readMinutes: readMinutes(body) }));
    res.setHeader('Cache-Control', preview ? 'no-store' : 'public, max-age=30, stale-while-revalidate=300');
    res.json({
      ok: true,
      post: {
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        body: post.body,
        coverImageUrl: post.coverImageUrl,
        coverAlt: post.coverAlt,
        authorName: post.authorName,
        tags: post.tags,
        seoTitle: post.seoTitle,
        seoDescription: post.seoDescription,
        isFeatured: post.isFeatured,
        publishedAt: post.publishedAt,
        updatedAt: post.updatedAt,
        status: post.status,
        readMinutes: readMinutes(post.body),
      },
      related,
    });
  }),
);

export type PublicSite = Awaited<ReturnType<typeof loadPublicSite>>;

/** Everything the public website shows (also what the AI chatbot knows). */
export async function loadPublicSite(preview = false) {
  const visible = preview ? { status: { in: ['PUBLISHED', 'DRAFT'] as ('PUBLISHED' | 'DRAFT')[] } } : { status: 'PUBLISHED' as const };
  const now = new Date();

  const [blocks, team, testimonials, faqs, announcements, gallery, courses, blogCount] = await Promise.all([
    prisma.contentBlock.findMany(),
    prisma.teamMember.findMany({ where: visible, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.testimonial.findMany({ where: visible, orderBy: [{ isFeatured: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.faq.findMany({ where: visible, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.announcement.findMany({
      where: {
        ...visible,
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.galleryItem.findMany({ where: visible, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.course.findMany({
      where: { isActive: true, isPublished: true, slug: { not: null } },
      include: { plans: { where: { isActive: true, isOnlinePurchasable: true }, orderBy: { pricePaise: 'asc' } } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.blogPost.count({ where: blogVisible(preview) }),
  ]);

  const blockData: Record<string, unknown> = {};
  for (const def of CONTENT_BLOCKS) {
    const row = blocks.find((b) => b.key === def.key);
    blockData[def.key] = (preview ? row?.draft : row?.published) ?? null;
  }

  return {
    generatedAt: now.toISOString(),
    preview,
    /** Tax added at checkout on top of plan fees (0 = none). */
    taxPercent: env.TAX_PERCENT,
    /** The AI chatbot can run (an Anthropic key is configured); the admin switches it on/off in "AI chatbot". */
    chatbotAvailable: !!env.ANTHROPIC_API_KEY,
    blocks: blockData,
    team: team.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      title: m.title,
      shortBio: m.shortBio,
      bio: m.bio,
      photoUrl: m.photoUrl,
      specialization: m.specialization,
      experience: m.experience,
      qualifications: m.qualifications,
      socialLinks: m.socialLinks,
      status: m.status,
    })),
    // Only what the student consented to show is ever sent to the website.
    testimonials: testimonials
      .filter((t) => preview || t.consentName)
      .map((t) => ({
        id: t.id,
        studentName: t.consentName ? t.studentName : 'A Moksha student',
        photoUrl: t.consentPhoto ? t.photoUrl : null,
        videoSource: t.consentVideo ? t.videoSource : 'NONE',
        videoUrl: t.consentVideo ? t.videoUrl : null,
        posterUrl: t.consentVideo ? t.posterUrl : null,
        quote: t.quote,
        courseName: t.courseName,
        isFeatured: t.isFeatured,
        status: t.status,
      })),
    faqs: faqs.map((f) => ({ id: f.id, question: f.question, answer: f.answer, page: f.page })),
    announcements: announcements.map((a) => ({ id: a.id, message: a.message, linkLabel: a.linkLabel, linkUrl: a.linkUrl })),
    /** Number of visible blog articles (the website shows "Blog" in its menu when there are any). */
    blogCount,
    gallery: gallery.map((g) => ({ id: g.id, kind: g.kind, url: g.url, posterUrl: g.posterUrl, caption: g.caption, alt: g.alt, album: g.album })),
    programmes: courses.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      category: c.category,
      discipline: c.discipline ? DISCIPLINE[c.discipline] : null,
      mode: c.deliveryMode ? DELIVERY[c.deliveryMode] : null,
      summary: c.publicSummary,
      forWhom: c.publicForWhom,
      imageUrl: c.imageUrl,
      onlinePlans: c.plans.map((p) => ({ id: p.id, title: p.title, pricePaise: p.pricePaise, durationType: p.durationType, durationValue: p.durationValue })),
    })),
  };
}
