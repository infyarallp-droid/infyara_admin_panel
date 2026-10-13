import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { businessDate, dateOnly, requireISODate, today, toISODate } from '../../lib/dates.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { getObject, putObject, uploadDir } from '../../lib/storage.js';
import { generateConsentPdf, type ConsentSnapshot, type SignatureImage } from '../../lib/pdf/consentPdf.js';
import { summarizePayment } from '../billing/billing.service.js';
import { invoiceSummarySelect } from '../enrollments/enrollments.service.js';

export const consentRouter = Router();
consentRouter.use(requireAuth);

const SCAN_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const paiseToRupees = (v: bigint | null | undefined) => (v == null ? null : Number(v) / 100);
const idParam = (value: string, what = 'consent form') => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new HttpError(400, `Invalid ${what} id`);
  return parsed.data;
};

const EMPTY_SNAPSHOT: ConsentSnapshot = { healthOptions: [], clauses: { safety: [], policies: [], conduct: [], final: [] } };
const DEFAULT_TITLE = 'Student Consent, Risk Acknowledgement & Code of Conduct';

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
    const template = await prisma.$transaction(async (tx) => {
      const latest = await tx.consentTemplate.findFirst({ orderBy: { version: 'desc' } });
      const version = (latest?.version ?? 0) + 1;
      if (input.activate) {
        await tx.consentTemplate.updateMany({ data: { isActive: false }, where: { isActive: true } });
      }
      return tx.consentTemplate.create({
        data: { version, title: input.title, sections: input.sections, isActive: input.activate, updatedBy: req.user!.sub },
      });
    });
    res.status(201).json({ ok: true, template });
  }),
);

consentRouter.post(
  '/templates/:id/activate',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id, 'template');
    const template = await prisma.$transaction(async (tx) => {
      if (!(await tx.consentTemplate.findUnique({ where: { id } }))) throw new HttpError(404, 'Template not found');
      await tx.consentTemplate.updateMany({ data: { isActive: false }, where: { isActive: true } });
      return tx.consentTemplate.update({ where: { id }, data: { isActive: true } });
    });
    res.json({ ok: true, template });
  }),
);

// ───────────── Consent forms ─────────────

/** A signature-pad image: PNG/JPEG data URL, capped so a draft row stays small. */
const signatureDataUrl = z
  .string()
  .max(700_000, 'Signature image is too large')
  .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Signature must be a PNG or JPEG image');

const formSchema = z.object({
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid().optional(),
  batchTimingLabel: z.string().max(120).optional(),
  formDate: z.string(),
  healthFlags: z.record(z.boolean()).optional(),
  healthOther: z.string().max(1000).optional(),
  consentSafetyAck: z.boolean().optional(),
  studioPoliciesAck: z.boolean().optional(),
  codeOfConductAck: z.boolean().optional(),
  finalAck: z.boolean().optional(),
  studentSignatureDataUrl: signatureDataUrl.optional(),
  guardianSignatureDataUrl: signatureDataUrl.optional(),
  studentSignedDate: z.string().optional(),
  guardianSignedDate: z.string().optional(),
});

const formInclude = {
  student: true,
  uploads: { orderBy: { uploadedAt: 'desc' as const } },
  enrollment: {
    include: {
      coursePlan: { include: { course: true } },
      classTiming: true,
      invoices: { select: invoiceSummarySelect, orderBy: { createdAt: 'asc' as const } },
    },
  },
};

/** Fee position shown on the form: live from the enrolment's invoice while it is a draft. */
function liveFee(form: {
  enrollment: { pricePaise: bigint; discountPaise: bigint; invoices: Parameters<typeof summarizePayment>[0] } | null;
  feePaise: bigint | null;
  amountPaidPaise: bigint | null;
  balancePaise: bigint | null;
}) {
  if (!form.enrollment) return { feePaise: form.feePaise, amountPaidPaise: form.amountPaidPaise, balancePaise: form.balancePaise };
  const net = form.enrollment.pricePaise - form.enrollment.discountPaise;
  const pay = summarizePayment(form.enrollment.invoices);
  if (pay.status === 'NONE') return { feePaise: net, amountPaidPaise: 0n, balancePaise: net };
  return { feePaise: pay.totalPaise, amountPaidPaise: pay.paidPaise, balancePaise: pay.balancePaise };
}

// Create a draft consent form for a student (optionally for one of their enrolments).
// Re-uses an open draft for the same student + enrolment, so a double click on
// "New Consent Form" never leaves duplicate drafts behind.
consentRouter.post(
  '/forms',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK'),
  asyncHandler(async (req, res) => {
    const input = formSchema.parse(req.body);
    const formDate = requireISODate(input.formDate, 'Form date');

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "students" WHERE "id" = ${input.studentId}::uuid FOR UPDATE`;
      if (!locked.length) throw new HttpError(404, 'Student not found');

      const enr = input.enrollmentId
        ? await tx.enrollment.findUnique({
            where: { id: input.enrollmentId },
            include: {
              coursePlan: { include: { course: true } },
              classTiming: true,
              invoices: { select: invoiceSummarySelect },
            },
          })
        : null;
      if (input.enrollmentId && !enr) throw new HttpError(404, 'Enrollment not found');
      if (enr && enr.studentId !== input.studentId) {
        throw new HttpError(400, 'That enrolment belongs to a different student');
      }

      const openDraft = await tx.consentForm.findFirst({
        where: { studentId: input.studentId, enrollmentId: input.enrollmentId ?? null, status: 'DRAFT' },
        orderBy: { createdAt: 'desc' },
      });
      if (openDraft) return { form: openDraft, reused: true };

      const activeTpl = await tx.consentTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } });
      const fee = enr
        ? {
            courseName: enr.coursePlan.course.name,
            planTitle: enr.coursePlan.title,
            ...liveFee({ enrollment: enr, feePaise: null, amountPaidPaise: null, balancePaise: null }),
          }
        : {};

      const form = await tx.consentForm.create({
        data: {
          studentId: input.studentId,
          enrollmentId: input.enrollmentId,
          templateVersion: activeTpl?.version,
          batchTimingLabel: input.batchTimingLabel ?? enr?.classTiming?.label ?? null,
          formDate: dateOnly(formDate),
          ...fee,
          healthFlags: input.healthFlags ?? {},
          healthOther: input.healthOther,
          consentSafetyAck: input.consentSafetyAck ?? false,
          studioPoliciesAck: input.studioPoliciesAck ?? false,
          codeOfConductAck: input.codeOfConductAck ?? false,
          finalAck: input.finalAck ?? false,
        },
      });
      return { form, reused: false };
    });
    res.status(result.reused ? 200 : 201).json({ ok: true, ...result });
  }),
);

consentRouter.get(
  '/forms/:id',
  asyncHandler(async (req, res) => {
    const form = await prisma.consentForm.findUnique({ where: { id: idParam(req.params.id) }, include: formInclude });
    if (!form) throw new HttpError(404, 'Consent form not found');
    // A draft shows the live fee position; a finalised form keeps what was recorded at signing.
    const fee = form.status === 'DRAFT' ? liveFee(form) : {};
    // Show the wording this form was (or will be) signed against.
    const template =
      (form.templateVersion != null
        ? await prisma.consentTemplate.findFirst({ where: { version: form.templateVersion } })
        : null) ?? (await prisma.consentTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } }));
    res.json({
      ok: true,
      form: { ...form, ...fee },
      sections: form.clauseSnapshot ?? template?.sections ?? EMPTY_SNAPSHOT,
      templateTitle: template?.title ?? DEFAULT_TITLE,
    });
  }),
);

// Update draft fields + signatures. Signatures are stored with the draft itself
// (not in external file storage), so saving a draft cannot fail on a storage outage.
consentRouter.put(
  '/forms/:id',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const input = formSchema.partial({ studentId: true, formDate: true }).parse(req.body);
    const existing = await prisma.consentForm.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Consent form not found');
    if (existing.status === 'FINALIZED') throw new HttpError(409, 'Form is finalized and cannot be edited');

    const optDate = (v: string | undefined, field: string) => (v ? dateOnly(requireISODate(v, field)) : undefined);
    const data: Record<string, unknown> = {
      batchTimingLabel: input.batchTimingLabel,
      healthFlags: input.healthFlags,
      healthOther: input.healthOther,
      consentSafetyAck: input.consentSafetyAck,
      studioPoliciesAck: input.studioPoliciesAck,
      codeOfConductAck: input.codeOfConductAck,
      finalAck: input.finalAck,
      studentSignatureUrl: input.studentSignatureDataUrl,
      guardianSignatureUrl: input.guardianSignatureDataUrl,
      studentSignedDate: optDate(input.studentSignedDate, 'Student signed date'),
      guardianSignedDate: optDate(input.guardianSignedDate, 'Guardian signed date'),
    };
    if (input.guardianSignatureDataUrl && !input.guardianSignedDate && !existing.guardianSignedDate) {
      data.guardianSignedDate = dateOnly(today());
    }
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);

    // Guard against a finalise that landed between the read and this write.
    const updated = await prisma.consentForm.updateMany({ where: { id, status: 'DRAFT' }, data });
    if (updated.count === 0) throw new HttpError(409, 'Form is finalized and cannot be edited');
    const form = await prisma.consentForm.findUniqueOrThrow({ where: { id } });
    res.json({ ok: true, form });
  }),
);

/** Read a stored signature. New ones are data URLs; older ones are file URLs. */
async function loadSignature(value: string | null): Promise<SignatureImage | null> {
  if (!value) return null;
  try {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(value);
    if (m) return { mime: m[1], bytes: Buffer.from(m[2], 'base64') };
    const local = `${env.API_PUBLIC_URL}/uploads/`;
    if (value.startsWith(local)) {
      const full = path.resolve(uploadDir, decodeURIComponent(value.slice(local.length)));
      if (!full.startsWith(uploadDir + path.sep)) return null;
      return { mime: full.endsWith('.png') ? 'image/png' : 'image/jpeg', bytes: await fs.readFile(full) };
    }
    if (/^https:\/\//.test(value)) {
      const resp = await fetch(value, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;
      return { mime: resp.headers.get('content-type') ?? 'image/png', bytes: Buffer.from(await resp.arrayBuffer()) };
    }
  } catch {
    // A signature that cannot be read leaves a blank line on the PDF rather than failing it.
  }
  return null;
}

type FullForm = NonNullable<Awaited<ReturnType<typeof loadForm>>>;
const loadForm = (id: string) => prisma.consentForm.findUnique({ where: { id }, include: formInclude });

interface StoredSnapshot extends ConsentSnapshot {
  title?: string;
  student?: {
    fullName: string;
    studentCode: string | null;
    mobile: string;
    email: string | null;
    isMinor: boolean;
    emergencyContactName: string | null;
    emergencyContactRelation: string | null;
    emergencyContactPhone: string | null;
  };
  period?: { start: string; end: string } | null;
}

/** Build the PDF for a form: from the frozen snapshot once finalised, from live data while a draft. */
async function buildConsentPdf(form: FullForm): Promise<Buffer> {
  const frozen = form.status === 'FINALIZED' ? (form.clauseSnapshot as unknown as StoredSnapshot | null) : null;
  const template = frozen
    ? null
    : (form.templateVersion != null
        ? await prisma.consentTemplate.findFirst({ where: { version: form.templateVersion } })
        : null) ?? (await prisma.consentTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } }));
  const snapshot: ConsentSnapshot = frozen ?? (template?.sections as unknown as ConsentSnapshot | undefined) ?? EMPTY_SNAPSHOT;
  if (!snapshot.clauses || !Array.isArray(snapshot.healthOptions)) {
    throw new HttpError(409, 'The consent template is incomplete — review it under Consent Templates before generating the PDF');
  }
  const student = frozen?.student ?? form.student;
  const fee = form.status === 'DRAFT' ? liveFee(form) : form;
  const period =
    frozen?.period ??
    (form.enrollment ? { start: toISODate(form.enrollment.startDate), end: toISODate(form.enrollment.endDate) } : null);

  return generateConsentPdf({
    title: frozen?.title ?? template?.title ?? DEFAULT_TITLE,
    consentId: form.id,
    templateVersion: form.templateVersion,
    status: form.status,
    studentName: student.fullName,
    studentCode: student.studentCode,
    mobile: student.mobile,
    email: student.email,
    isMinor: student.isMinor,
    formDate: toISODate(form.formDate),
    finalizedDate: form.finalizedAt ? businessDate(form.finalizedAt) : null,
    batchTiming: form.batchTimingLabel,
    emergencyContactName: student.emergencyContactName,
    emergencyContactRelation: student.emergencyContactRelation,
    emergencyContactPhone: student.emergencyContactPhone,
    courseName: form.courseName,
    planTitle: form.planTitle,
    periodStart: period?.start,
    periodEnd: period?.end,
    feeRupees: paiseToRupees(fee.feePaise),
    paidRupees: paiseToRupees(fee.amountPaidPaise),
    balanceRupees: paiseToRupees(fee.balancePaise),
    healthFlags: (form.healthFlags as Record<string, boolean>) ?? {},
    healthOther: form.healthOther,
    snapshot,
    studentSignature: await loadSignature(form.studentSignatureUrl),
    studentSignedDate: form.studentSignedDate ? toISODate(form.studentSignedDate) : null,
    guardianSignature: await loadSignature(form.guardianSignatureUrl),
    guardianSignedDate: form.guardianSignedDate ? toISODate(form.guardianSignedDate) : null,
  });
}

// GET /forms/:id/pdf — download / open / print.
// Works for drafts too (blank signature lines) so the form can be printed and
// signed on paper, then uploaded as a signed scan.
consentRouter.get(
  '/forms/:id/pdf',
  asyncHandler(async (req, res) => {
    const form = await loadForm(idParam(req.params.id));
    if (!form) throw new HttpError(404, 'Consent form not found');
    const pdf = await buildConsentPdf(form);
    const name = `consent-${form.student.fullName.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40) || 'form'}-${toISODate(form.formDate)}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  }),
);

// Finalize: validate, freeze the wording + student details, and confirm the PDF renders.
// The form only becomes FINALIZED after the PDF has been generated successfully,
// so a failure leaves the draft exactly as it was. Repeating the call is harmless.
consentRouter.post(
  '/forms/:id/finalize',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const form = await loadForm(id);
    if (!form) throw new HttpError(404, 'Consent form not found');
    const pdfPath = `/api/consent/forms/${id}/pdf`;
    if (form.status === 'FINALIZED') {
      return res.json({ ok: true, form, pdfPath, pdfUrl: form.pdfUrl, alreadyFinalized: true });
    }

    const missing = [
      !form.consentSafetyAck && 'Section 2 (Consent & Safety)',
      !form.studioPoliciesAck && 'Section 3 (Studio Policies)',
      !form.codeOfConductAck && 'Section 4 (Code of Conduct)',
      !form.finalAck && 'Section 5 (Final Acknowledgement)',
    ].filter(Boolean);
    if (missing.length) {
      throw new HttpError(400, `Tick the acknowledgement for: ${missing.join(', ')} before finalizing`);
    }
    // Signed either on the signature pad, or on paper with the signed copy uploaded.
    if (!form.studentSignatureUrl && !form.uploads.length) {
      throw new HttpError(400, 'Student signature is required — sign on the pad, or upload the signed paper copy first');
    }

    const template =
      (form.templateVersion != null
        ? await prisma.consentTemplate.findFirst({ where: { version: form.templateVersion } })
        : null) ?? (await prisma.consentTemplate.findFirst({ where: { isActive: true }, orderBy: { version: 'desc' } }));
    if (!template) throw new HttpError(409, 'No consent template is available — create one under Consent Templates');

    const fee = liveFee(form);
    const snapshot: StoredSnapshot = {
      ...(template.sections as unknown as ConsentSnapshot),
      title: template.title,
      student: {
        fullName: form.student.fullName,
        studentCode: form.student.studentCode,
        mobile: form.student.mobile,
        email: form.student.email,
        isMinor: form.student.isMinor,
        emergencyContactName: form.student.emergencyContactName,
        emergencyContactRelation: form.student.emergencyContactRelation,
        emergencyContactPhone: form.student.emergencyContactPhone,
      },
      period: form.enrollment
        ? { start: toISODate(form.enrollment.startDate), end: toISODate(form.enrollment.endDate) }
        : null,
    };
    const finalizedAt = new Date();
    const frozen = {
      status: 'FINALIZED' as const,
      clauseSnapshot: snapshot as unknown as object,
      templateVersion: template.version,
      finalizedAt,
      finalizedById: req.user!.sub,
      feePaise: fee.feePaise,
      amountPaidPaise: fee.amountPaidPaise,
      balancePaise: fee.balancePaise,
    };

    // 1) Prove the PDF can be generated from exactly what will be saved.
    let pdf: Buffer;
    try {
      pdf = await buildConsentPdf({ ...form, ...frozen, clauseSnapshot: snapshot as never });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error(`[consent] PDF generation failed for form ${id}`, err);
      throw new HttpError(500, 'The PDF could not be generated. Your draft is saved and unchanged — please try again.');
    }

    // 2) Flip DRAFT → FINALIZED exactly once, even if two requests race.
    const flipped = await prisma.consentForm.updateMany({ where: { id, status: 'DRAFT' }, data: frozen });

    // 3) Archive a copy in file storage when available (best effort — the PDF can
    //    always be regenerated from the frozen record).
    let pdfUrl: string | null = null;
    if (flipped.count === 1) {
      try {
        const stored = await putObject('consent', `consent-${id}.pdf`, pdf, 'application/pdf');
        pdfUrl = stored.url;
        await prisma.consentForm.update({ where: { id }, data: { pdfUrl } });
      } catch (err) {
        console.error(`[consent] could not archive PDF for form ${id} (form is finalized; PDF is served on demand)`, err);
      }
    }
    const updated = await loadForm(id);
    res.json({ ok: true, form: updated, pdfPath, pdfUrl: pdfUrl ?? updated?.pdfUrl ?? null, alreadyFinalized: flipped.count === 0 });
  }),
);

// Upload the photo/scan of the physically-signed form, linked to this consent record.
consentRouter.post(
  '/forms/:id/uploads',
  requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    const ext = SCAN_TYPES[req.file.mimetype];
    if (!ext) throw new HttpError(400, 'Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the signed form');
    if (req.file.size === 0) throw new HttpError(400, 'The uploaded file is empty');
    const form = await prisma.consentForm.findUnique({ where: { id } });
    if (!form) throw new HttpError(404, 'Consent form not found');

    let stored;
    try {
      stored = await putObject('consent-signed', `signed${ext}`, req.file.buffer, req.file.mimetype);
    } catch (err) {
      console.error(`[consent] signed-copy upload failed for form ${id}`, err);
      throw new HttpError(503, 'File storage is unavailable, so the signed copy was not saved. Please try again shortly.');
    }
    const record = await prisma.consentUpload.create({
      data: {
        consentFormId: form.id,
        fileUrl: stored.url,
        fileKey: stored.key,
        fileName: path.basename(req.file.originalname).slice(0, 150),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        uploadedBy: req.user!.sub,
        note: typeof req.body.note === 'string' ? req.body.note.slice(0, 300) : null,
      },
    });
    res.status(201).json({ ok: true, upload: record });
  }),
);

// GET /uploads/:uploadId/file — the signed copy, served only to signed-in staff.
consentRouter.get(
  '/uploads/:uploadId/file',
  asyncHandler(async (req, res) => {
    const record = await prisma.consentUpload.findUnique({ where: { id: idParam(req.params.uploadId, 'upload') } });
    if (!record) throw new HttpError(404, 'File not found');
    if (!record.fileKey) throw new HttpError(409, 'This older upload can only be opened from its original link');
    let data: Buffer;
    try {
      data = await getObject(record.fileKey);
    } catch {
      throw new HttpError(404, 'The stored file could not be found');
    }
    res.setHeader('Content-Type', record.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(record.fileName ?? 'signed-consent').replace(/[^\w.\- ]+/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }),
);
