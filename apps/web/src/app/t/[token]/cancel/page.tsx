import { CodeGate } from '../code-gate';

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <CodeGate
      token={token}
      title="Cancel your transfer"
      intro="We will show what you get back under your plan before you confirm."
    />
  );
}
