// Course & class catalogue requested in "Admin Page Testing" (OBS-01).
//
// Safe to run any number of times:  pnpm --filter @moksha/api catalog:sync
//   • a course is matched by its code, then by name (case-insensitive) — never duplicated
//   • an existing course only has its EMPTY fields filled; nothing is overwritten
//   • no plans, fees, durations or timetables are created — those are not in the
//     source document and must be entered by the business under Courses.
import { pathToFileURL } from 'node:url';
import type { CourseCategory, DeliveryMode, Discipline, PrismaClient } from '@prisma/client';

interface CatalogueEntry {
  code: string;
  name: string;
  category: CourseCategory;
  discipline: Discipline;
  /** null = the source document does not state the delivery mode (to be confirmed). */
  deliveryMode: DeliveryMode | null;
  description?: string;
}

export const CATALOGUE: CatalogueEntry[] = [
  // ── Teacher Training Programs ──
  { code: 'TTC-YOGA-200', name: '200-Hour Yoga Teacher Training', category: 'TEACHER_TRAINING', discipline: 'YOGA', deliveryMode: null },
  { code: 'TTC-YOGA-300', name: '300-Hour Advanced Yoga Teacher Training', category: 'TEACHER_TRAINING', discipline: 'YOGA', deliveryMode: null },
  {
    // "Mat Pilates Level 1 Teacher Training" and "Mat Pilates Teacher Training – Offline & Online"
    // are one programme offered in two delivery modes, not two programmes.
    code: 'TTC-MAT-PILATES-L1',
    name: 'Mat Pilates Level 1 Teacher Training',
    category: 'TEACHER_TRAINING',
    discipline: 'PILATES',
    deliveryMode: 'HYBRID',
    description: 'Offered both offline and online.',
  },
  { code: 'TTC-BALA-YOGA', name: 'Bala Yoga Teacher Training', category: 'TEACHER_TRAINING', discipline: 'YOGA', deliveryMode: null },
  { code: 'TRN-AERIAL-YOGA', name: 'Aerial Yoga Training', category: 'TEACHER_TRAINING', discipline: 'YOGA', deliveryMode: 'OFFLINE' },
  // ── Regular Classes ──
  { code: 'REG-YOGA-STUDIO', name: 'Regular Studio Yoga Classes', category: 'REGULAR', discipline: 'YOGA', deliveryMode: 'OFFLINE' },
  { code: 'REG-YOGA-ONLINE', name: 'Regular Yoga Classes', category: 'REGULAR', discipline: 'YOGA', deliveryMode: 'ONLINE' },
  { code: 'REG-YOGA-ADV-ONLINE', name: 'Advanced Yoga Classes', category: 'REGULAR', discipline: 'YOGA', deliveryMode: 'ONLINE' },
  { code: 'REG-PILATES-ONLINE', name: 'Pilates Classes', category: 'REGULAR', discipline: 'PILATES', deliveryMode: 'ONLINE' },
  { code: 'REG-PILATES', name: 'Regular Pilates Classes', category: 'REGULAR', discipline: 'PILATES', deliveryMode: null },
];

export interface CatalogueReport {
  created: string[];
  updated: string[];
  unchanged: string[];
}

export async function syncCatalogue(prisma: PrismaClient): Promise<CatalogueReport> {
  const report: CatalogueReport = { created: [], updated: [], unchanged: [] };
  for (const entry of CATALOGUE) {
    const existing =
      (await prisma.course.findUnique({ where: { code: entry.code } })) ??
      (await prisma.course.findFirst({ where: { name: { equals: entry.name, mode: 'insensitive' } } }));

    if (!existing) {
      await prisma.course.create({ data: entry });
      report.created.push(entry.name);
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (!existing.code) patch.code = entry.code;
    if (!existing.deliveryMode && entry.deliveryMode) patch.deliveryMode = entry.deliveryMode;
    if (!existing.discipline) patch.discipline = entry.discipline;
    if (!existing.description && entry.description) patch.description = entry.description;
    if (Object.keys(patch).length) {
      await prisma.course.update({ where: { id: existing.id }, data: patch });
      report.updated.push(entry.name);
    } else {
      report.unchanged.push(entry.name);
    }
  }
  return report;
}

// CLI entry
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Only DATABASE_URL is needed here: load .env files from the same places the API does,
  // without requiring the rest of the API's configuration to be present.
  const { config } = await import('dotenv');
  const { dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  config({ path: [resolve(apiDir, '.env'), resolve(apiDir, '../../.env')] });
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const r = await syncCatalogue(prisma);
    console.log(`[catalogue] created ${r.created.length}, updated ${r.updated.length}, unchanged ${r.unchanged.length}`);
    if (r.created.length) console.log(`[catalogue] created: ${r.created.join('; ')}`);
  } catch (e) {
    console.error('[catalogue] failed', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
