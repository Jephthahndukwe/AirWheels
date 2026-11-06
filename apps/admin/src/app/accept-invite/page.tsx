import QRCode from 'qrcode';
import { apiRaw } from '@/lib/api';
import { AcceptForm } from './accept-form';

export const dynamic = 'force-dynamic';

interface Invite {
  email: string;
  name: string;
  role: string;
  totpSecret: string;
  totpUri: string;
}

/** Staff invite: set a password and add Airwheels to an authenticator app (5.4, ACC-07). */
export default async function AcceptInvite({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const r = token ? await apiRaw(`/v1/admin/auth/invites/${encodeURIComponent(token)}`, { token: null }) : null;
  if (!r || r.status !== 200) {
    return (
      <div className="max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-xl font-bold">Invite not valid</h1>
        <p className="text-sm text-slate">This link has expired or was already used. Ask a super admin for a new invite.</p>
      </div>
    );
  }
  const invite = r.data as Invite;
  const qr = await QRCode.toDataURL(invite.totpUri, { margin: 1, width: 200 });
  return (
    <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-sm">
      <h1 className="mb-1 text-xl font-bold">Welcome, {invite.name}</h1>
      <p className="mb-6 text-sm text-slate">
        {invite.email} · {invite.role.replace('_', ' ').toLowerCase()}
      </p>
      <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password) and scan this code.</li>
      </ol>
      <img src={qr} alt="QR code for your authenticator app" width={200} height={200} className="mx-auto mb-2" />
      <p className="mb-6 text-center text-xs text-slate">
        Can&apos;t scan? Enter this key: <code className="break-all font-mono">{invite.totpSecret}</code>
      </p>
      <AcceptForm token={token!} />
    </div>
  );
}
