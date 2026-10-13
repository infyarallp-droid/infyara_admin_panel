import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import {
  analyzeImport,
  commitImport,
  ImportFileError,
  importTemplateCsv,
  importTemplateGuide,
} from './students.import.service.js';

// Legacy ("old student") bulk upload. Mounted at /api/students/import behind requireAuth.
//   GET  /template  → downloadable CSV template (opens in Excel)
//   POST /preview   → validate the file, write nothing, return row-level results
//   POST /commit    → re-validate the same file and import the valid rows
export const studentImportRouter = Router();

const canImport = requireRole('SUPER_ADMIN', 'ADMIN', 'MANAGER');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

/** File type + structure gate: only a text CSV is accepted. */
function readCsvUpload(req: Request): { text: string; fileName: string } {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Choose the filled-in template file to upload');
  const name = file.originalname.toLowerCase();
  if (/\.(xlsx|xls|xlsm|ods)$/.test(name) || file.buffer.subarray(0, 2).toString('latin1') === 'PK') {
    throw new HttpError(400, 'Excel workbooks are not accepted. In Excel choose File → Save As → "CSV UTF-8 (Comma delimited)" and upload that file.');
  }
  if (!name.endsWith('.csv')) throw new HttpError(400, 'Only .csv files are accepted — use the downloaded template');
  if (file.buffer.includes(0)) throw new HttpError(400, 'The file is not a text CSV file');
  return { text: file.buffer.toString('utf8'), fileName: file.originalname.slice(0, 120) };
}

studentImportRouter.get(
  '/template',
  asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="moksha-legacy-students-template.csv"');
    res.send(importTemplateCsv());
  }),
);

studentImportRouter.get(
  '/guide',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, guide: importTemplateGuide });
  }),
);

studentImportRouter.post(
  '/preview',
  canImport,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { text } = readCsvUpload(req);
    try {
      const analysis = await analyzeImport(text);
      res.json({ ok: true, ...analysis });
    } catch (err) {
      if (err instanceof ImportFileError) throw new HttpError(400, err.message);
      throw err;
    }
  }),
);

studentImportRouter.post(
  '/commit',
  canImport,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { text, fileName } = readCsvUpload(req);
    const { updatePolicy } = z
      .object({ updatePolicy: z.enum(['skip', 'fill_blanks']).default('skip') })
      .parse(req.body ?? {});
    try {
      const { analysis, results, summary } = await commitImport(text, updatePolicy, req.user!.sub, fileName);
      if (analysis.fileErrors.length) {
        throw new HttpError(400, `The file cannot be imported: ${analysis.fileErrors[0]}`, { fileErrors: analysis.fileErrors });
      }
      res.json({ ok: true, summary, results });
    } catch (err) {
      if (err instanceof ImportFileError) throw new HttpError(400, err.message);
      throw err;
    }
  }),
);
