import { CodeGate } from '../code-gate';

export default async function ChangePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <CodeGate
      token={token}
      title="Change your transfer"
      intro="Change your address or pickup time. We will show any cost under your plan before you confirm."
    />
  );
}
