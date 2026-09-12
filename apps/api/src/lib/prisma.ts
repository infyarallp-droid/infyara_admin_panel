import { PrismaClient } from '@prisma/client';

// Single shared Prisma client. BigInt columns (paise) serialize to JSON as
// strings via the toJSON shim below so Express res.json() never throws.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
