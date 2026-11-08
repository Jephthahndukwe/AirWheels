import { OPERATOR_NAME } from '@airwheels/ui';
import { Footer } from '@/components/footer';

/** Placeholder until legal review (PRD 14.8, 19.2). States who operates the transfer. */
export default function Terms() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Transfer terms</h1>
      <div className="space-y-3 text-sm">
        <p>
          Transfers are operated by {OPERATOR_NAME}, even when booked under an airline&apos;s brand.
        </p>
        <p>
          Your price is fixed when you pay and never goes up. Standard plan: free reschedule when
          your flight change is announced early. Flex plan: free changes at any time.
        </p>
        <p>
          Full terms, cancellation and refund rules are being finalised with our lawyers and will be
          published here before launch.
        </p>
      </div>
      <Footer />
    </>
  );
}
