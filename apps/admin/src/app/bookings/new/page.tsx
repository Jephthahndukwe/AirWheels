import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { can, requireMe } from '@/lib/api';
import { OpsBookingForm } from './ops-booking-form';

export default async function NewBooking() {
  const me = await requireMe();
  if (!can.write(me)) redirect('/bookings');
  return (
    <div className="max-w-5xl">
      <Link href="/bookings" className="text-sm text-slate underline">
        ← Bookings
      </Link>
      <h1 className="mb-2 mt-2 text-2xl font-bold">New phone or WhatsApp booking</h1>
      <p className="mb-6 text-sm text-slate">The price comes from the live pricing rules. The booking waits for payment; send the traveller the Paystack link shown on the next page.</p>
      <Card title="Booking">
        <OpsBookingForm />
      </Card>
    </div>
  );
}
