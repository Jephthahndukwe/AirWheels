import { PrismaClient } from '@prisma/client';
import { decrypt, encrypt, isCurrent } from '../src/common/crypto';

/**
 * Re-encrypts every airline signing secret with the current APP_ENCRYPTION_KEY.
 * Run during rotation, with APP_ENCRYPTION_KEY_PREVIOUS set to the old key:
 *   pnpm --filter @airwheels/api secrets:rotate
 * Safe to run more than once.
 */
const prisma = new PrismaClient();

async function main() {
  const creds = await prisma.airlineCredential.findMany({ select: { id: true, keyId: true, secretEncrypted: true } });
  let rotated = 0;
  for (const c of creds) {
    if (isCurrent(c.secretEncrypted)) continue;
    await prisma.airlineCredential.update({
      where: { id: c.id },
      data: { secretEncrypted: encrypt(decrypt(c.secretEncrypted)), rotatedAt: new Date() },
    });
    rotated++;
  }
  console.log(`Re-encrypted ${rotated} of ${creds.length} airline secrets with the current key.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
