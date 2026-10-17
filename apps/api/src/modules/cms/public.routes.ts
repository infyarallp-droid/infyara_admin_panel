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

export type PublicSite = Awaited<ReturnType<typeof loadPublicSite>>;

/** Everything the public website shows (also what the AI chatbot knows). */
export async function loadPublicSite(preview = false) {
  const visible = preview ? { status: { in: ['PUBLISHED', 'DRAFT'] as ('PUBLISHED' | 'DRAFT')[] } } : { status: 'PUBLISHED' as const };
  const now = new Date();

  const [blocks, team, testimonials, faqs, announcements, gallery, courses] = await Promise.all([
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
    /** The AI chatbot can run (an OpenAI key is configured); the admin switches it on/off in "AI chatbot". */
    chatbotAvailable: !!env.OPENAI_API_KEY,
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
