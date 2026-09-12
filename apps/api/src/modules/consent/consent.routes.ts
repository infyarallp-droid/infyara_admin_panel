import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { putObject, putDataUrl } from '../../lib/storage.js';
import { generateConsentPdf } from '../../lib/pdf/consentPdf.js';

export const consentRouter = Router();
consentRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const paiseToRupees = (v: bigint | null | undefined) => (v == null ? null : Number(v) / 100);

// ───────────── Templates (editable default content) ─────────────

consentRouter.get(
  '/templates',
  asyncHandler(async (_req, res) => {
    const templates = await prisma.consentTemplate.findMany({ orderBy: { version: 'desc' } });
    res.json({ ok: true, templates });
  }),
);

consentRouter.get(
  '/templates/active',
  asyncHandler(async (_req, res) => {
    const template = await prisma.consentTemplate.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!template) throw new HttpError(404, 'No active consent template');
    res.json({ ok: true, template });
  }),
);

const templateSchema = z.object({
  title: z.string().min(2),
  sections: z.object({
    healthOptions: z.array(z.object({ key: z.string(), label: z.string() })),
    clauses: z.object({
      safety: z.array(z.string()),
      policies: z.array(z.string()),
      conduct: z.array(z.string()),
      final: z.array(z.string()),
    }),
  }),
  activate: z.boolean().default(true),
});

// Create a NEW version (never edits a past finalized snapshot).
consentRouter.post(
  '/templates',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const input = templateSchema.parse(req.body);
    const latest = await prisma.consentTemplate.findFirst({ orderBy: { version: 'desc' } });
    const version = (latest?.version ?? 0) + 1;
    if (input.activate) {
      await prisma.consentTemplate.updateMany({ data: { isActive: false }, where: { isActive: true } });
    }
    const template = await prisma.consentTemplate.create({
      data: {
        version,
        title: input.title,
        sections: input.sections,
        isActive: input.activate,
        updatedBy: req.user!.sub,
      },
    });
    res.status(201).json({ ok: true, template });
  }),
);

consentRouter.post(
  '/templates/:id/activate',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    await prisma.consentTemplate.updateMany({ data: { isActive: false }, where: { isActive: true } });
    const template = await prisma.consentTemplate.update({
      where: { id: req.params.id },
      data: { isActive: true },
    });
    res.json({ ok: true, template });
  }),
);

// ───────────── Consent forms ─────────────

const formSchema = z.object({
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid().optional(),
  batchTimingLabel: z.string().optional(),
  formDate: z.string(),
  healthFlags: z.record(z.boolean()).optional(),
  healthOther: z.string().optional(),
  consentSafetyAck: z.boolean().optional(),
  studioPoliciesAck: z.boolean().optional(),
  codeOfConductAck: z.boolean().optional(),
  finalAck: z.boolean().optional(),
  studentSignatureDataUrl: z.string().optional(),
  guardianSignatureDataUrl: z.string().optional(),
  studentSignedDate: z.string().optional(),
  guardianSignedDate: z.string().optional(),
});

// Create a draft consent form, snapshotting fee details from the enrollment.
consentRouter.post(
  '/forms',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK'),
  asyncHandler(async (req, res) => {
    const input = formSchema.parse(req.body);
    const activeTpl = await prisma.consentTemplate.findFirst({ where: { isActive: true } });

    let fee = { courseName: null as string | null, planTitle: null as string | null, feePaise: null as bigint | null, amountPaidPaise: null as bigint | null, balancePaise: null as bigint | null };
    if (input.enrollmentId) {
      const enr = await prisma.enrollment.findUnique({
        where: { id: input.enrollmentId },
        include: { coursePlan: { include: { course: true } } },
      });
      if (enr) {
        const net = enr.pricePaise - enr.discountPaise;
        fee = {
          courseName: enr.coursePlan.course.name,
          planTitle: enr.coursePlan.title,
          feePaise: net,
          amountPaidPaise: 0n,
          balancePaise: net,
        };
      }
    }

    const form = await prisma.consentForm.create({
      data: {
        studentId: input.studentId,
        enrollmentId: input.enrollmentId,
        templateVersion: activeTpl?.version,
        batchTimingLabel: input.batchTimingLabel,
        formDate: new Date(input.formDate),
        ...fee,
        healthFlags: input.healthFlags ?? {},
        healthOther: input.healthOther,
        consentSafetyAck: input.consentSafetyAck ?? false,
        studioPoliciesAck: input.studioPoliciesAck ?? false,
        codeOfConductAck: input.codeOfConductAck ?? false,
        finalAck: input.finalAck ?? false,
      },
    });
    res.status(201).json({ ok: true, form });
  }),
);

consentRouter.get(
  '/forms/:id',
  asyncHandler(async (req, res) => {
    const form = await prisma.consentForm.findUnique({
      where: { id: req.params.id },
      include: { student: true, uploads: true },
    });
    if (!form) throw new HttpError(404, 'Consent form not found');
    res.json({ ok: true, form });
  }),
);

// Update draft fields + signatures (signatures arrive as data URLs, stored as files).
consentRouter.put(
  '/forms/:id',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER'),
  asyncHandler(async (req, res) => {
    const input = formSchema.partial({ studentId: true, formDate: true }).parse(req.body);
    const existing = await prisma.consentForm.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Consent form not found');
    if (existing.status === 'FINALIZED') throw new HttpError(409, 'Form is finalized and cannot be edited');

    const data: Record<string, unknown> = {
      batchTimingLabel: input.batchTimingLabel,
      healthFlags: input.healthFlags,
      healthOther: input.healthOther,
      consentSafetyAck: input.consentSafetyAck,
      studioPoliciesAck: input.studioPoliciesAck,
      codeOfConductAck: input.codeOfConductAck,
      finalAck: input.finalAck,
      studentSignedDate: input.studentSignedDate ? new Date(input.studentSignedDate) : undefined,
      guardianSignedDate: input.guardianSignedDate ? new Date(input.guardianSignedDate) : undefined,
    };
    if (input.studentSignatureDataUrl) {
      data.studentSignatureUrl = (await putDataUrl('signatures', input.studentSignatureDataUrl)).url;
    }
    if (input.guardianSignatureDataUrl) {
      data.guardianSignatureUrl = (await putDataUrl('signatures', input.guardianSignatureDataUrl)).url;
    }
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

    const form = await prisma.consentForm.update({ where: { id: req.params.id }, data });
    res.json({ ok: true, form });
  }),
);

// Finalize: validate acknowledgements, snapshot clauses, generate + store the PDF.
consentRouter.post(
  '/forms/:id/finalize',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER'),
  asyncHandler(async (req, res) => {
    const form = await prisma.consentForm.findUnique({
      where: { id: req.params.id },
      include: { student: true },
    });
    if (!form) throw new HttpError(404, 'Consent form not found');
    if (!(form.consentSafetyAck && form.studioPoliciesAck && form.codeOfConductAck && form.finalAck)) {
      throw new HttpError(400, 'All acknowledgements (Sections 2–5) must be accepted before finalizing');
    }
    if (!form.studentSignatureUrl) throw new HttpError(400, 'Student signature is required');

    const template = await prisma.consentTemplate.findFirst({
      where: { version: form.templateVersion ?? undefined },
    });
    const snapshot = (template?.sections ?? { healthOptions: [], clauses: { safety: [], policies: [], conduct: [], final: [] } }) as never;

    const pdf = await generateConsentPdf({
      title: template?.title ?? 'Student Consent, Risk Acknowledgement & Code of Conduct',
      studentName: form.student.fullName,
      mobile: form.student.mobile,
      formDate: form.formDate.toISOString().slice(0, 10),
      batchTiming: form.batchTimingLabel,
      emergencyContactName: form.student.emergencyContactName,
      emergencyContactRelation: form.student.emergencyContactRelation,
      courseName: form.courseName,
      planTitle: form.planTitle,
      feeRupees: paiseToRupees(form.feePaise),
      paidRupees: paiseToRupees(form.amountPaidPaise),
      balanceRupees: paiseToRupees(form.balancePaise),
      healthFlags: (form.healthFlags as Record<string, boolean>) ?? {},
      healthOther: form.healthOther,
      snapshot,
      studentSignatureUrl: form.studentSignatureUrl,
      guardianSignatureUrl: form.guardianSignatureUrl,
    });

    const stored = await putObject('consent', `consent-${form.id}.pdf`, pdf, 'application/pdf');
    const updated = await prisma.consentForm.update({
      where: { id: form.id },
      data: { status: 'FINALIZED', pdfUrl: stored.url, clauseSnapshot: snapshot },
    });
    res.json({ ok: true, form: updated, pdfUrl: stored.url });
  }),
);

// Upload the photo/scan of the physically-signed form.
consentRouter.post(
  '/forms/:id/uploads',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    const form = await prisma.consentForm.findUnique({ where: { id: req.params.id } });
    if (!form) throw new HttpError(404, 'Consent form not found');
    const stored = await putObject('consent-signed', req.file.originalname, req.file.buffer, req.file.mimetype);
    const record = await prisma.consentUpload.create({
      data: {
        consentFormId: form.id,
        fileUrl: stored.url,
        uploadedBy: req.user!.sub,
        note: typeof req.body.note === 'string' ? req.body.note : null,
      },
    });
    res.status(201).json({ ok: true, upload: record });
  }),
);
