import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma.service';
import { AdminAuthService } from '../modules/auth/admin-auth.service';

/**
 * One-time command that creates the first super admin (PRD 5.4). It never runs from seed data.
 *
 *   pnpm admin:create-super --email you@company.com --name "Your Name"
 *
 * It refuses if a super admin already exists. It creates an invite and prints the link; open it
 * to set a password and add the TOTP secret to your authenticator app. Further staff are invited
 * from the admin dashboard.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email');
  const name = arg('name');
  if (!email || !name) {
    console.error('Usage: pnpm admin:create-super --email you@company.com --name "Your Name"');
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const existing = await prisma.adminProfile.count({ where: { role: 'SUPER_ADMIN' } });
    if (existing > 0) {
      console.error('A super admin already exists. Invite more staff from the admin dashboard (Staff and roles).');
      process.exitCode = 1;
      return;
    }
    const invite = await app.get(AdminAuthService).createInvite({ email, name, role: 'SUPER_ADMIN' });
    const link = (invite as { devLink?: string }).devLink;
    console.log(`Super admin invite created for ${invite.email}. It expires ${invite.expiresAt.toISOString()}.`);
    console.log(link ? `Open this link to finish setup:\n${link}` : 'The setup link was emailed to that address.');
  } finally {
    await app.close();
  }
}

void main();
