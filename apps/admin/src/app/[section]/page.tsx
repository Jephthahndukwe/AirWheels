import { notFound } from 'next/navigation';
import { NAV } from '../nav';

/** Placeholder for admin modules not built yet. Each names the milestone that delivers it. */
export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const item = NAV.find((n) => n.href === `/${section}`);
  if (!item) notFound();
  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">{item.label}</h1>
      <p className="text-slate">
        This module is planned for milestone {item.milestone} (PRD section 24).
      </p>
    </div>
  );
}
