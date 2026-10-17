import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { REMINDER_TRIGGER_VALUES, fillPlaceholders, normalizeIndianMobile } from '@moksha/shared';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { isWhatsAppConfigured } from '../../lib/whatsappSend.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { consentMap, currentConsent, recordConsent } from '../messaging/consent.service.js';
import { deliverQueued, enqueueMessage, studentPlaceholderValues } from '../messaging/rules.service.js';

// Admin: WhatsApp reminders — templates, consent, campaigns (send now / schedule),
// automatic rules, and the message history with delivery status.
export const whatsappAdminRouter = Router();
whatsappAdminRouter.use(requireAuth);
const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');
whatsappAdminRouter.use(manage);

const uuid = (v: string, what = 'Record') => {
  const p = z.string().uuid().safeParse(v);
  if (!p.success) throw new HttpError(404, `${what} not found`);
  return p.data;
};

whatsappAdminRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [queued, failed, optedIn, templates] = await Promise.all([
      prisma.messageLog.count({ where: { status: 'QUEUED' } }),
      prisma.messageLog.count({ where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*) AS n FROM (
          SELECT DISTINCT ON ("mobile") "state" FROM "whatsapp_consents" ORDER BY "mobile", "created_at" DESC
        ) latest WHERE "state" = 'OPTED_IN'`,
      prisma.whatsAppTemplate.count({ where: { status: 'APPROVED' } }),
    ]);
    res.json({
      ok: true,
      configured: isWhatsAppConfigured(),
      webhookSignatureConfigured: !!env.WHATSAPP_APP_SECRET,
      templateSyncConfigured: !!(env.WHATSAPP_BUSINESS_ACCOUNT_ID && env.WHATSAPP_ACCESS_TOKEN),
      consentRequired: env.WHATSAPP_REQUIRE_CONSENT,
      webhookUrl: `${env.API_PUBLIC_URL.replace(/\/+$/, '')}/webhooks/whatsapp`,
      counts: { queued, failedLast7Days: failed, optedIn: Number(optedIn[0]?.n ?? 0), approvedTemplates: templates },
    });
  }),
);

// ───────────────────────── Templates ─────────────────────────

whatsappAdminRouter.get(
  '/templates',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, templates: await prisma.whatsAppTemplate.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] }) });
  }),
);

const countVars = (body: string | null | undefined) => {
  const nums = [...(body ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
};

// Manual entry: for templates already approved in Meta when sync is not configured.
whatsappAdminRouter.post(
  '/templates',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().regex(/^[a-z0-9_]+$/, 'Template names are lowercase letters, numbers and underscores').max(512),
        language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'e.g. en or en_US').default('en'),
        category: z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']),
        bodyText: z.string().trim().max(1024).optional(),
        status: z.enum(['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED']).default('APPROVED'),
      })
      .parse(req.body);
    const template = await prisma.whatsAppTemplate.upsert({
      where: { name_language: { name: input.name, language: input.language } },
      create: { ...input, variableCount: countVars(input.bodyText) },
      update: { ...input, variableCount: countVars(input.bodyText) },
    });
    await audit(prisma, { userId: req.user!.sub, action: 'WA_TEMPLATE_SAVED', entity: 'whatsapp_template', entityId: template.id });
    res.status(201).json({ ok: true, template });
  }),
);

whatsappAdminRouter.delete(
  '/templates/:id',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'Template');
    const used = await prisma.reminderRule.count({ where: { templateId: id } });
    if (used) throw new HttpError(409, 'This template is used by a reminder rule. Delete or change the rule first.');
    await prisma.messageCampaign.deleteMany({ where: { templateId: id, status: { in: ['CANCELLED'] } } });
    if (await prisma.messageCampaign.count({ where: { templateId: id } })) {
      throw new HttpError(409, 'This template has message history; it can be kept but not deleted.');
    }
    await prisma.whatsAppTemplate.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

// POST /api/whatsapp/templates/sync — pull templates and their approval status from Meta.
whatsappAdminRouter.post(
  '/templates/sync',
  asyncHandler(async (req, res) => {
    if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      throw new HttpError(409, 'Set WHATSAPP_BUSINESS_ACCOUNT_ID and WHATSAPP_ACCESS_TOKEN on the API to sync templates from Meta');
    }
    type MetaTemplate = { id: string; name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] };
    const all: MetaTemplate[] = [];
    let url: string | null =
      `${env.WHATSAPP_API_BASE_URL}/${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?fields=id,name,language,status,category,components&limit=100`;
    for (let page = 0; url && page < 20; page++) {
      const resp: Response = await fetch(url, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(15_000) });
      const body = (await resp.json().catch(() => null)) as { data?: MetaTemplate[]; paging?: { next?: string }; error?: { message?: string } } | null;
      if (!resp.ok || !body) throw new HttpError(502, `Meta answered: ${body?.error?.message ?? `HTTP ${resp.status}`}`);
      all.push(...(body.data ?? []));
      url = body.paging?.next ?? null;
    }
    const now = new Date();
    for (const t of all) {
      const bodyText = t.components?.find((c) => c.type === 'BODY')?.text ?? null;
      await prisma.whatsAppTemplate.upsert({
        where: { name_language: { name: t.name, language: t.language } },
        create: { name: t.name, language: t.language, category: t.category, status: t.status, bodyText, variableCount: countVars(bodyText), metaId: t.id, lastSyncedAt: now },
        update: { category: t.category, status: t.status, bodyText, variableCount: countVars(bodyText), metaId: t.id, lastSyncedAt: now },
      });
    }
    await audit(prisma, { userId: req.user!.sub, action: 'WA_TEMPLATES_SYNCED', entity: 'whatsapp_template', meta: { count: all.length } });
    res.json({ ok: true, synced: all.length });
  }),
);

async function approvedTemplate(id: string, params: string[]) {
  const template = await prisma.whatsAppTemplate.findUnique({ where: { id } });
  if (!template) throw new HttpError(404, 'Template not found');
  if (template.status !== 'APPROVED') throw new HttpError(409, `Template "${template.name}" is ${template.status} — only approved templates can be sent`);
  if (params.length !== template.variableCount) {
    throw new HttpError(400, `Template "${template.name}" needs ${template.variableCount} value(s), ${params.length} given`);
  }
  return template;
}

const paramsSchema = z.array(z.string().trim().max(500)).max(20);

// ───────────────────────── Consent ─────────────────────────

// GET /api/whatsapp/consents?q= — students with their current WhatsApp opt-in state.
whatsappAdminRouter.get(
  '/consents',
  asyncHandler(async (req, res) => {
    const { q, state } = z.object({ q: z.string().trim().max(100).optional(), state: z.enum(['OPTED_IN', 'OPTED_OUT', 'NONE']).optional() }).parse(req.query);
    const students = await prisma.student.findMany({
      where: q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }, { studentCode: { contains: q, mode: 'insensitive' } }] } : {},
      select: { id: true, fullName: true, mobile: true, studentCode: true, status: true },
      orderBy: { fullName: 'asc' },
      take: 300,
    });
    const map = await consentMap(students.map((s) => s.mobile));
    const rows = students.map((s) => ({ ...s, consent: map.get(s.mobile) ?? null }));
    res.json({ ok: true, students: state ? rows.filter((r) => (r.consent ?? 'NONE') === state) : rows });
  }),
);

whatsappAdminRouter.get(
  '/consents/history',
  asyncHandler(async (req, res) => {
    const { mobile } = z.object({ mobile: z.string() }).parse(req.query);
    const m = normalizeIndianMobile(mobile);
    if (!m) throw new HttpError(400, 'Enter a valid mobile number');
    res.json({ ok: true, history: await prisma.whatsAppConsent.findMany({ where: { mobile: m }, orderBy: { createdAt: 'desc' } }) });
  }),
);

// POST /api/whatsapp/consents { studentIds, state, note } — staff record consent given in person / on paper.
whatsappAdminRouter.post(
  '/consents',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        studentIds: z.array(z.string().uuid()).min(1).max(500),
        state: z.enum(['OPTED_IN', 'OPTED_OUT']),
        note: z.string().trim().min(5, 'Say how the consent was given (e.g. "signed admission form 12 Oct")').max(300),
      })
      .parse(req.body);
    const students = await prisma.student.findMany({ where: { id: { in: input.studentIds } } });
    let changed = 0;
    for (const s of students) {
      const row = await recordConsent({
        mobile: s.mobile,
        state: input.state,
        source: 'STAFF_RECORDED',
        consentText: input.note,
        studentId: s.id,
        recordedById: req.user!.sub,
      });
      if (row) changed++;
    }
    await audit(prisma, { userId: req.user!.sub, action: `WA_CONSENT_${input.state}`, entity: 'student', meta: { count: students.length, note: input.note } });
    res.json({ ok: true, changed });
  }),
);

// ───────────────────────── Campaigns: send now or schedule ─────────────────────────

whatsappAdminRouter.get(
  '/campaigns',
  asyncHandler(async (_req, res) => {
    const campaigns = await prisma.messageCampaign.findMany({ include: { template: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    const ids = campaigns.map((c) => c.id);
    const counts = ids.length
      ? await prisma.messageLog.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: ids } }, _count: true })
      : [];
    res.json({
      ok: true,
      campaigns: campaigns.map((c) => ({
        ...c,
        statusCounts: Object.fromEntries(counts.filter((x) => x.campaignId === c.id).map((x) => [x.status, x._count])),
      })),
    });
  }),
);

// POST /api/whatsapp/campaigns { name, templateId, params, studentIds, scheduledAt? }
whatsappAdminRouter.post(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(120),
        templateId: z.string().uuid(),
        params: paramsSchema,
        studentIds: z.array(z.string().uuid()).min(1, 'Choose at least one student').max(1000),
        scheduledAt: z.string().datetime({ offset: true }).optional(),
      })
      .parse(req.body);
    const template = await approvedTemplate(input.templateId, input.params);
    const when = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    if (when.getTime() < Date.now() - 60_000) throw new HttpError(400, 'The scheduled time is in the past');
    if (when.getTime() > Date.now() + 90 * 86_400_000) throw new HttpError(400, 'Schedule within the next 90 days');

    const students = await prisma.student.findMany({ where: { id: { in: [...new Set(input.studentIds)] } } });
    const consents = await consentMap(students.map((s) => s.mobile));
    const campaign = await prisma.messageCampaign.create({
      data: {
        name: input.name,
        templateId: template.id,
        params: input.params,
        recipientIds: students.map((s) => s.id),
        scheduledAt: when,
        status: 'QUEUED',
        createdById: req.user!.sub,
      },
    });
    let queued = 0;
    let skipped = 0;
    for (const s of students) {
      // Students without opt-in are recorded as skipped and never contacted.
      if (env.WHATSAPP_REQUIRE_CONSENT && consents.get(s.mobile) !== 'OPTED_IN') {
        await prisma.messageLog.create({
          data: {
            dedupeKey: `campaign:${campaign.id}:${s.id}`,
            event: 'CAMPAIGN',
            studentId: s.id,
            templateName: template.name,
            templateId: template.id,
            campaignId: campaign.id,
            params: input.params,
            status: 'NO_CONSENT',
            error: 'No WhatsApp opt-in recorded for this number',
            triggeredBy: `MANUAL:${req.user!.sub}`,
          },
        });
        skipped++;
        continue;
      }
      const { values } = await studentPlaceholderValues(s.id);
      const log = await enqueueMessage({
        dedupeKey: `campaign:${campaign.id}:${s.id}`,
        event: 'CAMPAIGN',
        template,
        params: fillPlaceholders(input.params, values),
        studentId: s.id,
        mobile: s.mobile,
        campaignId: campaign.id,
        scheduledFor: when,
        triggeredBy: `MANUAL:${req.user!.sub}`,
      });
      if (log) queued++;
    }
    const updated = await prisma.messageCampaign.update({ where: { id: campaign.id }, data: { recipientCount: queued, skippedCount: skipped } });
    await audit(prisma, {
      userId: req.user!.sub,
      action: 'WA_CAMPAIGN_CREATED',
      entity: 'message_campaign',
      entityId: campaign.id,
      meta: { template: template.name, queued, skipped, scheduledAt: when.toISOString() },
    });
    // "Send now": deliver right away instead of waiting for the next scheduled run.
    const delivery = when.getTime() <= Date.now() + 60_000 ? await deliverQueued(Math.min(queued, 100)) : null;
    res.status(201).json({ ok: true, campaign: updated, queued, skipped, delivery });
  }),
);

whatsappAdminRouter.post(
  '/campaigns/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'Campaign');
    const { count } = await prisma.messageLog.updateMany({ where: { campaignId: id, status: 'QUEUED' }, data: { status: 'CANCELLED' } });
    await prisma.messageCampaign.update({ where: { id }, data: { status: 'CANCELLED' } });
    await audit(prisma, { userId: req.user!.sub, action: 'WA_CAMPAIGN_CANCELLED', entity: 'message_campaign', entityId: id, meta: { cancelled: count } });
    res.json({ ok: true, cancelled: count });
  }),
);

// ───────────────────────── Automatic reminder rules ─────────────────────────

const ruleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  trigger: z.enum(REMINDER_TRIGGER_VALUES),
  offsetDays: z.number().int().min(-60).max(60).default(0),
  templateId: z.string().uuid(),
  params: paramsSchema,
  isEnabled: z.boolean().default(false),
});

whatsappAdminRouter.get(
  '/rules',
  asyncHandler(async (_req, res) => {
    const rules = await prisma.reminderRule.findMany({ include: { template: true }, orderBy: { createdAt: 'asc' } });
    const counts = await prisma.messageLog.groupBy({ by: ['ruleId', 'status'], where: { ruleId: { in: rules.map((r) => r.id) } }, _count: true });
    res.json({
      ok: true,
      rules: rules.map((r) => ({ ...r, statusCounts: Object.fromEntries(counts.filter((c) => c.ruleId === r.id).map((c) => [c.status, c._count])) })),
    });
  }),
);

whatsappAdminRouter.post(
  '/rules',
  asyncHandler(async (req, res) => {
    const input = ruleSchema.parse(req.body);
    await approvedTemplate(input.templateId, input.params);
    const rule = await prisma.reminderRule.create({ data: { ...input, createdById: req.user!.sub } });
    await audit(prisma, { userId: req.user!.sub, action: 'WA_RULE_CREATED', entity: 'reminder_rule', entityId: rule.id, meta: input as Prisma.InputJsonValue });
    res.status(201).json({ ok: true, rule });
  }),
);

whatsappAdminRouter.put(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'Rule');
    const input = ruleSchema.parse(req.body);
    await approvedTemplate(input.templateId, input.params);
    const rule = await prisma.reminderRule.update({ where: { id }, data: input });
    await audit(prisma, { userId: req.user!.sub, action: 'WA_RULE_UPDATED', entity: 'reminder_rule', entityId: id, meta: input as Prisma.InputJsonValue });
    res.json({ ok: true, rule });
  }),
);

whatsappAdminRouter.patch(
  '/rules/:id/enabled',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'Rule');
    const { isEnabled } = z.object({ isEnabled: z.boolean() }).parse(req.body);
    const rule = await prisma.reminderRule.update({ where: { id }, data: { isEnabled } });
    await audit(prisma, { userId: req.user!.sub, action: isEnabled ? 'WA_RULE_ENABLED' : 'WA_RULE_DISABLED', entity: 'reminder_rule', entityId: id });
    res.json({ ok: true, rule });
  }),
);

whatsappAdminRouter.delete(
  '/rules/:id',
  asyncHandler(async (req, res) => {
    const id = uuid(req.params.id, 'Rule');
    await prisma.messageLog.updateMany({ where: { ruleId: id, status: 'QUEUED' }, data: { status: 'CANCELLED' } });
    await prisma.reminderRule.delete({ where: { id } });
    await audit(prisma, { userId: req.user!.sub, action: 'WA_RULE_DELETED', entity: 'reminder_rule', entityId: id });
    res.json({ ok: true });
  }),
);

// ───────────────────────── Message history ─────────────────────────

whatsappAdminRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        status: z.string().max(30).optional(),
        campaignId: z.string().uuid().optional(),
        ruleId: z.string().uuid().optional(),
        studentId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    const where: Prisma.MessageLogWhereInput = { status: q.status, campaignId: q.campaignId, ruleId: q.ruleId, studentId: q.studentId };
    const [total, messages] = await Promise.all([
      prisma.messageLog.count({ where }),
      prisma.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const studentIds = [...new Set(messages.map((m) => m.studentId).filter(Boolean))] as string[];
    const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true } });
    res.json({
      ok: true,
      total,
      page: q.page,
      pageSize: q.pageSize,
      messages: messages.map((m) => ({ ...m, providerResponse: undefined, studentName: students.find((s) => s.id === m.studentId)?.fullName ?? null })),
    });
  }),
);

/** Failures that may succeed if tried again (not consent / recipient problems). */
const RETRYABLE = ['FAILED', 'NOT_CONFIGURED'];

// POST /api/whatsapp/messages/retry { ids } — put eligible failed messages back in the queue.
whatsappAdminRouter.post(
  '/messages/retry',
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
    const rows = await prisma.messageLog.findMany({ where: { id: { in: ids } } });
    let requeued = 0;
    const skipped: { id: string; reason: string }[] = [];
    for (const m of rows) {
      if (!RETRYABLE.includes(m.status)) {
        skipped.push({ id: m.id, reason: `${m.status} messages cannot be retried` });
        continue;
      }
      if (env.WHATSAPP_REQUIRE_CONSENT && m.studentId) {
        const s = await prisma.student.findUnique({ where: { id: m.studentId } });
        if ((await currentConsent(s?.mobile)) !== 'OPTED_IN') {
          skipped.push({ id: m.id, reason: 'No WhatsApp opt-in' });
          continue;
        }
      }
      if (!m.templateId && m.event === 'RENEWAL_REMINDER') {
        // Built-in renewal reminders retry on their own in the daily run.
        skipped.push({ id: m.id, reason: 'Renewal reminders retry automatically in the next daily run' });
        continue;
      }
      await prisma.messageLog.update({ where: { id: m.id }, data: { status: 'QUEUED', scheduledFor: new Date(), attempts: 0, error: null } });
      requeued++;
    }
    await audit(prisma, { userId: req.user!.sub, action: 'WA_MESSAGES_RETRIED', entity: 'message_log', meta: { requeued } });
    const delivery = requeued ? await deliverQueued(Math.min(requeued, 100)) : null;
    res.json({ ok: true, requeued, skipped, delivery });
  }),
);
