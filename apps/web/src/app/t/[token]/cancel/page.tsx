import { CancelFlow } from '../code-gate';

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CancelFlow token={token} />;
}
