import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_FAQS, PROGRAMME_DEFAULTS } from '../src/modules/cms/defaults.js';

// One-time, idempotent seed for the website CMS:
//  • copies the website's programme descriptions onto the matching catalogue courses
//    (only fields that are still empty — admin edits are never overwritten);
//  • imports the original home-page FAQs when there are no FAQs yet.
// Safe to run on every deploy: `pnpm --filter @moksha/api cms:seed`.

export async function seedCms(prisma: PrismaClient) {
  const summary = { coursesUpdated: 0, faqsCreated: 0 };
  for (const [code, d] of Object.entries(PROGRAMME_DEFAULTS)) {
    const course = await prisma.course.findUnique({ where: { code } });
    if (!course || course.slug) continue; // missing, or already configured by an admin
    const slugTaken = await prisma.course.findUnique({ where: { slug: d.slug } });
    if (slugTaken) continue;
    await prisma.course.update({
      where: { id: course.id },
      data: {
        slug: d.slug,
        publicSummary: course.publicSummary ?? d.summary,
        publicForWhom: course.publicForWhom ?? d.forWhom,
        displayOrder: d.order,
        isPublished: true,
      },
    });
    summary.coursesUpdated++;
  }
  if ((await prisma.faq.count()) === 0) {
    await prisma.faq.createMany({
      data: DEFAULT_FAQS.map((f, i) => ({ ...f, page: 'HOME', status: 'PUBLISHED' as const, displayOrder: i + 1 })),
    });
    summary.faqsCreated = DEFAULT_FAQS.length;
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  seedCms(prisma)
    .then((s) => console.log('[cms-seed]', JSON.stringify(s)))
    .catch((e) => {
      console.error('[cms-seed] failed', e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
