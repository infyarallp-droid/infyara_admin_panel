import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { encrypt, decrypt, maskTail } from '../../lib/encryption.js';
import { getObject, putObject } from '../../lib/storage.js';

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

const manage = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Serialize an employee, masking PII (or revealing it for admins with ?reveal=true).
function present(emp: any, reveal: boolean) {
  const aadhaar = decrypt(emp.aadhaarNo);
  const pan = decrypt(emp.panNo);
  return {
    ...emp,
    aadhaarNo: reveal ? aadhaar : maskTail(aadhaar, 4),
    panNo: reveal ? pan : maskTail(pan, 4),
    salaryPaise: emp.salaryPaise ? String(emp.salaryPaise) : null,
  };
}

employeesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const employees = await prisma.employee.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ ok: true, employees: employees.map((e) => present(e, false)) });
  }),
);

employeesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const reveal =
      req.query.reveal === 'true' && ['SUPER_ADMIN', 'ADMIN'].includes(req.user!.role);
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { documents: true, timings: true },
    });
    if (!employee) throw new HttpError(404, 'Employee not found');
    res.json({ ok: true, employee: present(employee, reveal), canReveal: ['SUPER_ADMIN', 'ADMIN'].includes(req.user!.role) });
  }),
);

const employeeSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(6),
  roleTitle: z.string().optional(),
  aadhaarNo: z.string().optional(),
  panNo: z.string().optional(),
  dateOfJoining: z.string().optional(),
  address: z.string().optional(),
  salaryRupees: z.number().nonnegative().optional(),
});

function toData(input: z.infer<typeof employeeSchema>) {
  return {
    fullName: input.fullName,
    email: input.email || null,
    phone: input.phone,
    roleTitle: input.roleTitle || null,
    aadhaarNo: input.aadhaarNo ? encrypt(input.aadhaarNo) : null,
    panNo: input.panNo ? encrypt(input.panNo) : null,
    dateOfJoining: input.dateOfJoining ? new Date(input.dateOfJoining) : null,
    address: input.address || null,
    salaryPaise: input.salaryRupees != null ? BigInt(Math.round(input.salaryRupees * 100)) : null,
  };
}

employeesRouter.post(
  '/',
  manage,
  asyncHandler(async (req, res) => {
    const input = employeeSchema.parse(req.body);
    const existing = await prisma.employee.findUnique({ where: { phone: input.phone } });
    if (existing) throw new HttpError(409, 'An employee with this phone already exists');
    const employee = await prisma.employee.create({ data: toData(input) });
    res.status(201).json({ ok: true, employee: present(employee, false) });
  }),
);

employeesRouter.put(
  '/:id',
  manage,
  asyncHandler(async (req, res) => {
    const input = employeeSchema.parse(req.body);
    const employee = await prisma.employee.update({ where: { id: req.params.id }, data: toData(input) });
    res.json({ ok: true, employee: present(employee, false) });
  }),
);

// Upload an employee document (Aadhaar/PAN scan, photo, certificate…)
employeesRouter.post(
  '/:id/documents',
  manage,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded');
    const docType = z
      .enum(['AADHAAR', 'PAN', 'PHOTO', 'CERTIFICATE', 'OTHER'])
      .parse(req.body.docType ?? 'OTHER');
    const stored = await putObject('employee-docs', req.file.originalname, req.file.buffer, req.file.mimetype);
    const document = await prisma.employeeDocument.create({
      // fileUrl points at the authenticated download route; the storage URL is never handed out.
      data: { employeeId: req.params.id, docType, fileUrl: 'pending', fileKey: stored.key, mimeType: req.file.mimetype },
    });
    const updated = await prisma.employeeDocument.update({
      where: { id: document.id },
      data: { fileUrl: `/api/employees/${req.params.id}/documents/${document.id}/file` },
    });
    res.status(201).json({ ok: true, document: updated });
  }),
);

// GET /api/employees/:id/documents/:docId/file — staff-only download (Aadhaar/PAN scans are sensitive).
employeesRouter.get(
  '/:id/documents/:docId/file',
  manage,
  asyncHandler(async (req, res) => {
    const docId = z.string().uuid().safeParse(req.params.docId);
    if (!docId.success) throw new HttpError(404, 'Document not found');
    const doc = await prisma.employeeDocument.findUnique({ where: { id: docId.data } });
    if (!doc || doc.employeeId !== req.params.id) throw new HttpError(404, 'Document not found');
    if (!doc.fileKey) {
      // Uploaded before this change: only a stored link exists.
      if (/^https?:\/\//.test(doc.fileUrl)) return res.redirect(doc.fileUrl);
      throw new HttpError(404, 'File not found');
    }
    const buffer = await getObject(doc.fileKey);
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }),
);
