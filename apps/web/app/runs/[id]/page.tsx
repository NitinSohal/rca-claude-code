import { RunStream } from '../../../components/RunStream';
export default function RunPage({ params }: { params: { id: string } }) {
  return <RunStream runId={params.id} />;
}
