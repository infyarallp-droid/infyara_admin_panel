import type { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Atomically take the next value of a named sequence.
 *
 * The first use of a key seeds it from `currentMax()` (the highest number
 * already issued), so existing numbering simply continues. The upsert takes a
 * row lock, so two concurrent transactions can never be handed the same number;
 * if the surrounding transaction rolls back, the number is released with it.
 */
export async function nextCounter(tx: Tx, key: string, currentMax: () => Promise<number>): Promise<number> {
  const existing = await tx.counter.findUnique({ where: { key } });
  const seed = existing ? 0 : await currentMax();
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "counters" ("key", "value") VALUES (${key}, ${seed + 1})
    ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

/** Next Student ID, e.g. STU-0042. Skips any code already taken by a legacy import. */
export async function nextStudentCode(tx: Tx): Promise<string> {
  for (;;) {
    const n = await nextCounter(tx, 'student', async () => tx.student.count());
    const code = `STU-${String(n).padStart(4, '0')}`;
    const taken = await tx.student.findUnique({ where: { studentCode: code }, select: { id: true } });
    if (!taken) return code;
  }
}
