import Link from 'next/link';
import { Footer } from '@/components/footer';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

/**
 * Shared shell for change and cancel (TRV-07). Both sit behind a six-digit code sent to the
 * booking's phone (ACC-02) and show the policy cost before confirming (POL-07).
 * The code request and policy preview endpoints arrive in M3.
 */
export function CodeGate({ token, title, intro }: { token: string; title: string; intro: string }) {
  return (
    <>
      <Card className="space-y-4">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{intro}</p>
        <Button variant="outline" className="w-full" disabled>
          Send me a code
        </Button>
        <div>
          <Label htmlFor="code">Six-digit code</Label>
          <Input id="code" inputMode="numeric" maxLength={6} placeholder="••••••" disabled />
        </div>
        <p className="text-xs text-muted-foreground">Code sign-in is coming soon. Contact support to make changes today.</p>
        <Button variant="ghost" asChild className="w-full">
          <Link href={`/t/${token}`}>Back to my booking</Link>
        </Button>
      </Card>
      <Footer />
    </>
  );
}
