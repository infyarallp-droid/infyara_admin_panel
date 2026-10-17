import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { asyncHandler } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { addDaysISO, dateOnly, today } from '../../lib/dates.js';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);

const rupees = (paise: bigint | number | null | undefined) => (paise == null ? 0 : Number(paise) / 100);

analyticsRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Enrolment dates are calendar dates in the business timezone.
    const todayDate = dateOnly(today());
    const in30 = dateOnly(addDaysISO(today(), 30));

    const [
      revToday,
      revMonth,
      openInvoices,
      activeStudents,
      newStudents,
      renewalsDue,
      leadsBySourceRaw,
      leadsByStatusRaw,
      totalLeads,
      convertedLeads,
      enrollmentsForPopularity,
      variants,
      activeEmployees,
    ] = await Promise.all([
      prisma.payment.aggregate({ _sum: { amountPaise: true, refundedPaise: true }, where: { paidAt: { gte: startOfToday } } }),
      prisma.payment.aggregate({ _sum: { amountPaise: true, refundedPaise: true }, where: { paidAt: { gte: startOfMonth } } }),
      prisma.invoice.findMany({ where: { status: { in: ['UNPAID', 'PARTIAL'] } }, select: { totalPaise: true, amountPaidPaise: true } }),
      // Active = not manually deactivated AND holding an enrolment that is valid today.
      prisma.student.count({
        where: {
          status: 'ACTIVE',
          enrollments: { some: { status: 'ACTIVE', startDate: { lte: todayDate }, endDate: { gte: todayDate } } },
        },
      }),
      prisma.student.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.enrollment.count({ where: { status: 'ACTIVE', endDate: { lte: in30 } } }),
      prisma.lead.groupBy({ by: ['source'], _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.lead.count(),
      prisma.lead.count({ where: { status: 'CONVERTED' } }),
      prisma.enrollment.findMany({ include: { coursePlan: { include: { course: true } } } }),
      prisma.productVariant.findMany({ select: { stockQty: true, reorderLevel: true } }),
      prisma.employee.count({ where: { status: 'ACTIVE' } }),
    ]);

    const pending = openInvoices.reduce((s, i) => s + (Number(i.totalPaise) - Number(i.amountPaidPaise)), 0);

    const coursePopMap = new Map<string, number>();
    for (const e of enrollmentsForPopularity) {
      const name = e.coursePlan.course.name;
      coursePopMap.set(name, (coursePopMap.get(name) ?? 0) + 1);
    }
    const coursePopularity = [...coursePopMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    res.json({
      ok: true,
      summary: {
        revenueTodayRupees: rupees((revToday._sum.amountPaise ?? 0n) - (revToday._sum.refundedPaise ?? 0n)),
        revenueMonthRupees: rupees((revMonth._sum.amountPaise ?? 0n) - (revMonth._sum.refundedPaise ?? 0n)),
        pendingRupees: pending / 100,
        activeStudents,
        newStudentsThisMonth: newStudents,
        renewalsDue30: renewalsDue,
        activeEmployees,
        lowStockCount: variants.filter((v) => v.stockQty <= v.reorderLevel).length,
        totalLeads,
        convertedLeads,
        conversionRate: totalLeads ? Math.round((convertedLeads / totalLeads) * 100) : 0,
        leadsBySource: leadsBySourceRaw.map((r) => ({ source: r.source, count: r._count._all })),
        leadFunnel: leadsByStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
        coursePopularity,
      },
    });
  }),
);
