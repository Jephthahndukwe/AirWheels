import { Suspense } from 'react';
import { Footer } from '@/components/footer';
import { BookingForm } from './booking-form';

export default function Home() {
  return (
    <>
      <header className="mb-6">
        <p className="text-sm font-bold tracking-wide text-coral">AIRWHEELS</p>
        <h1 className="text-3xl font-bold">Your ride to and from the airport</h1>
        <p className="mt-2 text-muted-foreground">A vetted driver at your door, and another waiting when you land. We follow your flight.</p>
      </header>
      <Suspense>
        <BookingForm />
      </Suspense>
      <Footer />
    </>
  );
}
