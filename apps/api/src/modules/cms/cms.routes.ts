import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { CONTENT_BLOCKS, contentBlockSchema, mediaUrlSchema, safeHref } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { previewToken, revalidateWebsite } from '../../lib/revalidate.js';
import { deletePublicObject, putPublicObject, sniffMedia } from '../../lib/storage.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { CONTENT_DEFAULTS } from './defaults.js';

// Admin: website content (CMS). Everything published here appears on the public
// website within seconds via on-demand revalidation — no code change or deploy.
export const cmsRouter = Router();
cmsRouter.use(requireAuth);
const editor = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');
cmsRouter.use(editor);

const json = (v: unknown) => v as Prisma.InputJsonValue;
const uuid = (v: string) => {
  const p = z.string().uuid().safeParse(v);
  if (!p.success) throw new HttpError(404, 'Not found');
  return p.data;
};
const log = (req: Request, action: string, entity: string, entityId?: string | null, meta?: Prisma.InputJsonValue) =>
  audit(prisma, { userId: req.user!.sub, action, entity, entityId: entityId ?? null, meta });

// ───────────────────────── Page sections (content blocks) ─────────────────────────

cmsRouter.get(
  '/blocks',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.contentBlock.findMany();
    res.json({
      ok: true,
      blocks: CONTENT_BLOCKS.map((def) => {
        const row = rows.find((r) => r.key === def.key);
        return {
          key: def.key,
          label: def.label,
          page: def.page,
          publishedAt: row?.publishedAt ?? null,
          updatedAt: row?.updatedAt ?? null,
          hasUnpublishedChanges: !!row && JSON.stringify(row.draft) !== JSON.stringify(row.published),
          customised: !!row?.published,
        };
      }),
    });
  }),
);

function blockDef(key: string) {
  const def = CONTENT_BLOCKS.find((b) => b.key === key);
  if (!def) throw new HttpError(404, 'Unknown content section');
  return def;
}

cmsRouter.get(
  '/blocks/:key',
  asyncHandler(async (req, res) => {
    const def = blockDef(req.params.key);
    const row = await prisma.contentBlock.findUnique({ where: { key: def.key } });
    const fallback = contentBlockSchema(def.key)!.parse(CONTENT_DEFAULTS[def.key] ?? {});
    res.json({ ok: true, def, draft: row?.draft ?? fallback, published: row?.published ?? null, publishedAt: row?.publishedAt ?? null, defaults: fallback });
  }),
);

// PUT /api/cms/blocks/:key { data, publish? } — save the draft (and optionally publish it).
cmsRouter.put(
  '/blocks/:key',
  asyncHandler(async (req, res) => {
    const def = blockDef(req.params.key);
    const { data, publish } = z.object({ data: z.record(z.unknown()), publish: z.boolean().default(false) }).parse(req.body);
    const clean = contentBlockSchema(def.key)!.parse(data);
    const now = new Date();
    const row = await prisma.contentBlock.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        draft: json(clean),
        updatedById: req.user!.sub,
        ...(publish ? { published: json(clean), publishedAt: now, publishedById: req.user!.sub } : {}),
      },
      update: {
        draft: json(clean),
        updatedById: req.user!.sub,
        ...(publish ? { published: json(clean), publishedAt: now, publishedById: req.user!.sub } : {}),
      },
    });
    await log(req, publish ? 'CONTENT_PUBLISHED' : 'CONTENT_DRAFT_SAVED', 'content_block', null, { key: def.key });
    if (publish) revalidateWebsite(`content:${def.key}`);
    res.json({ ok: true, draft: row.draft, published: row.published, publishedAt: row.publishedAt });
  }),
);

cmsRouter.post(
  '/blocks/:key/publish',
  asyncHandler(async (req, res) => {
    const def = blockDef(req.params.key);
    const row = await prisma.contentBlock.findUnique({ where: { key: def.key } });
    if (!row) throw new HttpError(409, 'Save the section before publishing it');
    const updated = await prisma.contentBlock.update({
      where: { key: def.key },
      data: { published: row.draft as Prisma.InputJsonValue, publishedAt: new Date(), publishedById: req.user!.sub },
    });
    await log(req, 'CONTENT_PUBLISHED', 'content_block', null, { key: def.key });
    revalidateWebsite(`content:${def.key}`);
    res.json({ ok: true, publishedAt: updated.publishedAt });
  }),
);

// Throw away unpublished edits (back to the live version, or the original copy).
cmsRouter.post(
  '/blocks/:key/discard',
  asyncHandler(async (req, res) => {
    const def = blockDef(req.params.key);
    const row = await prisma.contentBlock.findUnique({ where: { key: def.key } });
    if (!row) return res.json({ ok: true });
    const draft = row.published ?? contentBlockSchema(def.key)!.parse(CONTENT_DEFAULTS[def.key] ?? {});
    await prisma.contentBlock.update({ where: { key: def.key }, data: { draft: draft as Prisma.InputJsonValue } });
    res.json({ ok: true, draft });
  }),
);

// ───────────────────────── Ordered collections ─────────────────────────

const status = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal('')).transform((v) => v || null);
const optUrl = mediaUrlSchema.nullable().optional().transform((v) => v || null);

const VIDEO_PATTERNS = {
  YOUTUBE: /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[A-Za-z0-9_-]{6,}/,
  VIMEO: /^https:\/\/(www\.|player\.)?vimeo\.com\/(video\/)?\d+/,
};

const teamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes')
    .max(80)
    .optional(),
  title: z.string().trim().min(2).max(80),
  shortBio: z.string().trim().min(10, 'Write at least a sentence').max(400),
  bio: optText(4000),
  photoUrl: optUrl,
  specialization: optText(200),
  experience: optText(100),
  qualifications: optText(500),
  socialLinks: z
    .object({ instagram: safeHref, facebook: safeHref, youtube: safeHref, linkedin: safeHref, website: safeHref })
    .partial()
    .optional(),
  employeeId: z.string().uuid().nullable().optional(),
  status: status.default('DRAFT'),
});

const testimonialSchema = z
  .object({
    studentName: z.string().trim().min(2).max(80),
    studentId: z.string().uuid().nullable().optional(),
    photoUrl: optUrl,
    videoSource: z.enum(['NONE', 'YOUTUBE', 'VIMEO', 'UPLOAD']).default('NONE'),
    videoUrl: optUrl,
    posterUrl: optUrl,
    quote: z.string().trim().min(10, 'Add a short written feedback').max(600),
    courseName: optText(120),
    isFeatured: z.boolean().default(false),
    status: status.default('DRAFT'),
    consentName: z.boolean().default(false),
    consentPhoto: z.boolean().default(false),
    consentVideo: z.boolean().default(false),
    consentNote: optText(500),
  })
  .superRefine((t, ctx) => {
    if (t.videoSource === 'NONE') return;
    if (!t.videoUrl) return ctx.addIssue({ code: 'custom', path: ['videoUrl'], message: 'Add the video link or upload the video' });
    if (t.videoSource === 'YOUTUBE' && !VIDEO_PATTERNS.YOUTUBE.test(t.videoUrl)) {
      ctx.addIssue({ code: 'custom', path: ['videoUrl'], message: 'Paste a YouTube link such as https://www.youtube.com/watch?v=…' });
    }
    if (t.videoSource === 'VIMEO' && !VIDEO_PATTERNS.VIMEO.test(t.videoUrl)) {
      ctx.addIssue({ code: 'custom', path: ['videoUrl'], message: 'Paste a Vimeo link such as https://vimeo.com/123456' });
    }
  });

const faqSchema = z.object({
  question: z.string().trim().min(5).max(200),
  answer: z.string().trim().min(5).max(2000),
  page: z.enum(['HOME', 'CLASSES', 'TRAINING', 'CONTACT']).default('HOME'),
  status: status.default('PUBLISHED'),
});

const announcementSchema = z
  .object({
    message: z.string().trim().min(3).max(200),
    linkLabel: optText(40),
    linkUrl: safeHref.optional().transform((v) => v || null),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    status: status.default('DRAFT'),
  })
  .refine((a) => !a.startsAt || !a.endsAt || a.startsAt < a.endsAt, { message: 'The end must be after the start', path: ['endsAt'] });

const gallerySchema = z.object({
  kind: z.enum(['IMAGE', 'VIDEO']).default('IMAGE'),
  url: mediaUrlSchema.refine(Boolean, 'Upload an image or video'),
  posterUrl: optUrl,
  caption: optText(200),
  alt: optText(200),
  album: optText(60),
  status: status.default('PUBLISHED'),
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'member';

/** Testimonials are published only with recorded consent for what is shown. */
function assertTestimonialConsent(t: { status: string; consentName: boolean; consentPhoto: boolean; consentVideo: boolean; photoUrl: string | null; videoSource: string }) {
  if (t.status !== 'PUBLISHED') return;
  const missing: string[] = [];
  if (!t.consentName) missing.push('name');
  if (t.photoUrl && !t.consentPhoto) missing.push('photo');
  if (t.videoSource !== 'NONE' && !t.consentVideo) missing.push('video');
  if (missing.length) {
    throw new HttpError(409, `Record the student's consent to show their ${missing.join(', ')} before publishing this testimonial`);
  }
}

type Delegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  findUnique: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<{ id: string }>;
  update: (args: unknown) => Promise<{ id: string }>;
  delete: (args: unknown) => Promise<unknown>;
  aggregate: (args: unknown) => Promise<{ _max: { displayOrder: number | null } }>;
};

interface Collection {
  name: string;
  entity: string;
  delegate: () => Delegate;
  parse: (body: unknown, existing?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const collections: Collection[] = [
  {
    name: 'team',
    entity: 'team_member',
    delegate: () => prisma.teamMember as unknown as Delegate,
    parse: async (body, existing) => {
      const t = teamSchema.parse(body);
      let slug = t.slug || (existing?.slug as string | undefined) || slugify(t.name);
      // Keep slugs unique by suffixing a number.
      for (let i = 2; ; i++) {
        const clash = await prisma.teamMember.findUnique({ where: { slug } });
        if (!clash || clash.id === existing?.id) break;
        slug = `${slugify(t.name)}-${i}`;
      }
      return { ...t, slug, socialLinks: t.socialLinks ?? Prisma.JsonNull, employeeId: t.employeeId ?? null };
    },
  },
  {
    name: 'testimonials',
    entity: 'testimonial',
    delegate: () => prisma.testimonial as unknown as Delegate,
    parse: async (body, existing) => {
      const t = testimonialSchema.parse(body);
      const data = { ...t, studentId: t.studentId ?? null, videoUrl: t.videoSource === 'NONE' ? null : t.videoUrl };
      assertTestimonialConsent(data);
      const consentChanged =
        !existing ||
        existing.consentName !== t.consentName ||
        existing.consentPhoto !== t.consentPhoto ||
        existing.consentVideo !== t.consentVideo;
      const anyConsent = t.consentName || t.consentPhoto || t.consentVideo;
      return {
        ...data,
        ...(consentChanged ? { consentRecordedAt: anyConsent ? new Date() : null } : {}),
      };
    },
  },
  { name: 'faqs', entity: 'faq', delegate: () => prisma.faq as unknown as Delegate, parse: async (b) => faqSchema.parse(b) },
  {
    name: 'announcements',
    entity: 'announcement',
    delegate: () => prisma.announcement as unknown as Delegate,
    parse: async (b) => {
      const a = announcementSchema.parse(b);
      return { ...a, startsAt: a.startsAt ? new Date(a.startsAt) : null, endsAt: a.endsAt ? new Date(a.endsAt) : null };
    },
  },
  { name: 'gallery', entity: 'gallery_item', delegate: () => prisma.galleryItem as unknown as Delegate, parse: async (b) => gallerySchema.parse(b) },
];

for (const c of collections) {
  cmsRouter.get(
    `/${c.name}`,
    asyncHandler(async (req, res) => {
      const q = z.object({ status: status.optional(), includeArchived: z.enum(['true', 'false']).optional() }).parse(req.query);
      const where = q.status ? { status: q.status } : q.includeArchived === 'true' ? {} : { status: { not: 'ARCHIVED' } };
      const items = await c.delegate().findMany({ where, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] });
      res.json({ ok: true, items });
    }),
  );

  cmsRouter.post(
    `/${c.name}`,
    asyncHandler(async (req, res) => {
      const data = await c.parse(req.body);
      const max = await c.delegate().aggregate({ _max: { displayOrder: true } });
      const extra = c.name === 'testimonials' && (data.consentRecordedAt as Date | null) ? { consentRecordedById: req.user!.sub } : {};
      const item = await c.delegate().create({ data: { ...data, ...extra, displayOrder: (max._max.displayOrder ?? 0) + 1 } });
      await log(req, 'CMS_CREATED', c.entity, item.id);
      revalidateWebsite(`${c.name}:create`);
      res.status(201).json({ ok: true, item });
    }),
  );

  cmsRouter.put(
    `/${c.name}/:id`,
    asyncHandler(async (req, res) => {
      const id = uuid(req.params.id);
      const existing = (await c.delegate().findUnique({ where: { id } })) as Record<string, unknown> | null;
      if (!existing) throw new HttpError(404, 'Not found');
      const data = await c.parse(req.body, existing);
      const extra = c.name === 'testimonials' && 'consentRecordedAt' in data ? { consentRecordedById: data.consentRecordedAt ? req.user!.sub : null } : {};
      const item = await c.delegate().update({ where: { id }, data: { ...data, ...extra } });
      await log(req, existing.status !== data.status ? `CMS_STATUS_${String(data.status)}` : 'CMS_UPDATED', c.entity, id);
      revalidateWebsite(`${c.name}:update`);
      res.json({ ok: true, item });
    }),
  );

  // PATCH status only (publish / unpublish / archive) — keeps the same validation rules.
  cmsRouter.patch(
    `/${c.name}/:id/status`,
    asyncHandler(async (req, res) => {
      const id = uuid(req.params.id);
      const next = z.object({ status }).parse(req.body).status;
      const existing = (await c.delegate().findUnique({ where: { id } })) as Record<string, unknown> | null;
      if (!existing) throw new HttpError(404, 'Not found');
      if (c.name === 'testimonials') {
        assertTestimonialConsent({ ...(existing as unknown as Parameters<typeof assertTestimonialConsent>[0]), status: next });
      }
      const item = await c.delegate().update({ where: { id }, data: { status: next } });
      await log(req, `CMS_STATUS_${next}`, c.entity, id);
      revalidateWebsite(`${c.name}:status`);
      res.json({ ok: true, item });
    }),
  );

  cmsRouter.delete(
    `/${c.name}/:id`,
    asyncHandler(async (req, res) => {
      const id = uuid(req.params.id);
      await c.delegate().delete({ where: { id } });
      await log(req, 'CMS_DELETED', c.entity, id);
      revalidateWebsite(`${c.name}:delete`);
      res.json({ ok: true });
    }),
  );

  // POST /api/cms/:collection/reorder { ids: [...] } — the new display order, first to last.
  cmsRouter.post(
    `/${c.name}/reorder`,
    asyncHandler(async (req, res) => {
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
      await prisma.$transaction(ids.map((id, i) => (c.delegate().update({ where: { id }, data: { displayOrder: i + 1 } }) as unknown as Prisma.PrismaPromise<unknown>)));
      revalidateWebsite(`${c.name}:reorder`);
      res.json({ ok: true });
    }),
  );
}

// ───────────────────────── Media library ─────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(env.MEDIA_MAX_IMAGE_MB, env.MEDIA_MAX_VIDEO_MB) * 1024 * 1024, files: 1 },
});

cmsRouter.get(
  '/media',
  asyncHandler(async (req, res) => {
    const q = z.object({ kind: z.enum(['IMAGE', 'VIDEO']).optional(), take: z.coerce.number().int().min(1).max(200).default(60) }).parse(req.query);
    const media = await prisma.mediaAsset.findMany({ where: { kind: q.kind }, orderBy: { createdAt: 'desc' }, take: q.take });
    res.json({ ok: true, media, limits: { imageMb: env.MEDIA_MAX_IMAGE_MB, videoMb: env.MEDIA_MAX_VIDEO_MB } });
  }),
);

cmsRouter.post(
  '/media',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose a file to upload');
    const type = sniffMedia(req.file.buffer);
    if (!type) throw new HttpError(400, 'Unsupported file. Use JPG, PNG, WebP, GIF or AVIF images, or MP4/WebM/MOV videos.');
    const limitMb = type.kind === 'IMAGE' ? env.MEDIA_MAX_IMAGE_MB : env.MEDIA_MAX_VIDEO_MB;
    if (req.file.size > limitMb * 1024 * 1024) {
      throw new HttpError(400, `${type.kind === 'IMAGE' ? 'Images' : 'Videos'} can be at most ${limitMb} MB. ${type.kind === 'VIDEO' ? 'For longer videos, upload to YouTube (unlisted is fine) and paste the link instead.' : ''}`);
    }
    const alt = z.string().trim().max(200).optional().parse(req.body?.alt);
    let stored: Awaited<ReturnType<typeof putPublicObject>>;
    try {
      stored = await putPublicObject(type.kind === 'IMAGE' ? 'images' : 'videos', `upload${type.ext}`, req.file.buffer, type.mime);
    } catch (err) {
      // Storage misconfiguration is the usual cause; say exactly what to fix instead of a bare 500.
      const reason = (err as Error).message;
      console.error('[media] upload to storage failed:', reason);
      const hint = /bucket not found/i.test(reason)
        ? `Create a PUBLIC bucket named "${env.SUPABASE_PUBLIC_BUCKET}" in Supabase → Storage.`
        : /maximum allowed size|payload too large|exceeded/i.test(reason)
          ? 'The file is bigger than the Supabase bucket allows — raise the bucket\'s file size limit or upload a smaller file.'
          : /mime type|not supported/i.test(reason)
            ? `The Supabase bucket "${env.SUPABASE_PUBLIC_BUCKET}" does not allow this file type — remove its "Allowed MIME types" restriction or add ${type.mime}.`
            : /unavailable|not set/i.test(reason)
              ? 'Set SUPABASE_URL and SUPABASE_SERVICE_KEY on the API server.'
              : 'Check the Supabase settings on the API server.';
      throw new HttpError(503, `The file could not be stored: ${reason}. ${hint}`);
    }
    const asset = await prisma.mediaAsset.create({
      data: {
        kind: type.kind,
        storageKey: stored.key,
        url: stored.url,
        mimeType: type.mime,
        sizeBytes: req.file.size,
        originalName: req.file.originalname.slice(0, 200),
        alt: alt || null,
        uploadedById: req.user!.sub,
      },
    });
    await log(req, 'MEDIA_UPLOADED', 'media_asset', asset.id, { kind: type.kind, sizeBytes: req.file.size });
    res.status(201).json({ ok: true, asset });
  }),
);

cmsRouter.delete(
  '/media/:id',
  asyncHandler(async (req, res) => {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: uuid(req.params.id) } });
    if (!asset) throw new HttpError(404, 'File not found');
    // Refuse to delete a file the website is still showing.
    const inUse = await Promise.all([
      prisma.teamMember.count({ where: { photoUrl: asset.url } }),
      prisma.testimonial.count({ where: { OR: [{ photoUrl: asset.url }, { videoUrl: asset.url }, { posterUrl: asset.url }] } }),
      prisma.galleryItem.count({ where: { OR: [{ url: asset.url }, { posterUrl: asset.url }] } }),
      prisma.course.count({ where: { imageUrl: asset.url } }),
      prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "content_blocks" WHERE "draft"::text LIKE ${'%' + asset.url + '%'} OR "published"::text LIKE ${'%' + asset.url + '%'}`,
    ]);
    const blocks = Number((inUse[4] as { n: bigint }[])[0]?.n ?? 0);
    if ((inUse.slice(0, 4) as number[]).some((n) => n > 0) || blocks > 0) {
      throw new HttpError(409, 'This file is still used on the website. Remove it from the page first.');
    }
    await deletePublicObject(asset.storageKey);
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    await log(req, 'MEDIA_DELETED', 'media_asset', asset.id);
    res.json({ ok: true });
  }),
);

// ───────────────────────── Programmes (courses on the website) ─────────────────────────

cmsRouter.get(
  '/programmes',
  asyncHandler(async (_req, res) => {
    const courses = await prisma.course.findMany({
      include: { plans: { orderBy: { pricePaise: 'asc' } } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({ ok: true, courses });
  }),
);

cmsRouter.put(
  '/programmes/:courseId',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.courseId);
    const input = z
      .object({
        slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(100),
        isPublished: z.boolean(),
        publicSummary: z.string().trim().max(500).optional().or(z.literal('')),
        publicForWhom: z.string().trim().max(300).optional().or(z.literal('')),
        displayOrder: z.number().int().min(0).max(10_000),
        imageUrl: optUrl,
      })
      .parse(req.body);
    if (input.isPublished && !input.publicSummary) throw new HttpError(400, 'Add a summary before showing this course on the website');
    const course = await prisma.course.update({
      where: { id },
      data: { ...input, publicSummary: input.publicSummary || null, publicForWhom: input.publicForWhom || null },
    });
    await log(req, 'PROGRAMME_UPDATED', 'course', id, { isPublished: input.isPublished });
    revalidateWebsite('programmes');
    res.json({ ok: true, course });
  }),
);

cmsRouter.put(
  '/plans/:planId/online',
  requireRole('SUPER_ADMIN', 'ADMIN'),
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.planId);
    const { isOnlinePurchasable } = z.object({ isOnlinePurchasable: z.boolean() }).parse(req.body);
    const plan = await prisma.coursePlan.findUnique({ where: { id } });
    if (!plan) throw new HttpError(404, 'Plan not found');
    if (isOnlinePurchasable && plan.pricePaise <= 0n) throw new HttpError(400, 'Set a fee for this plan before selling it online');
    const updated = await prisma.coursePlan.update({ where: { id }, data: { isOnlinePurchasable } });
    await log(req, isOnlinePurchasable ? 'PLAN_ONLINE_ON' : 'PLAN_ONLINE_OFF', 'course_plan', id);
    revalidateWebsite('plans');
    res.json({ ok: true, plan: updated });
  }),
);

// ───────────────────────── Website refresh & preview ─────────────────────────

cmsRouter.get(
  '/website',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, websiteUrl: env.WEBSITE_URL ?? null, revalidateConfigured: !!(env.WEBSITE_URL && env.WEBSITE_REVALIDATE_SECRET) });
  }),
);

cmsRouter.post(
  '/revalidate',
  asyncHandler(async (_req, res) => {
    revalidateWebsite('manual');
    res.json({ ok: true });
  }),
);

// GET /api/cms/preview?path=/about — a link that opens the website with unpublished drafts visible.
cmsRouter.get(
  '/preview',
  asyncHandler(async (req, res) => {
    const { path } = z.object({ path: z.string().regex(/^\/[A-Za-z0-9/_#?=&-]*$/).default('/') }).parse(req.query);
    if (!env.WEBSITE_URL) throw new HttpError(409, 'WEBSITE_URL is not set on the API, so previews are unavailable');
    const token = await previewToken();
    res.json({ ok: true, url: `${env.WEBSITE_URL.replace(/\/+$/, '')}/api/preview?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}` });
  }),
);
