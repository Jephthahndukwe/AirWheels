import { Footer } from '@/components/footer';
import { BookingStatus } from './booking-status';

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  return (
    <>
      <p className="mb-4 text-sm font-bold tracking-wide text-coral">AIRWHEELS</p>
      <BookingStatus id={id} token={t ?? ''} />
      <Footer />
    </>
  );
}
