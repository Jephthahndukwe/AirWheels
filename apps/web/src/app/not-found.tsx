import { Footer } from '@/components/footer';

export default function NotFound() {
  return (
    <>
      <h1 className="text-2xl font-bold">We could not find that booking</h1>
      <p className="mt-2 text-muted-foreground">
        Check the link in your WhatsApp or SMS message, or contact support.
      </p>
      <Footer />
    </>
  );
}
