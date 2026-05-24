import { RcaDetail } from '../../../components/RcaDetail';
export default function RcaPage({ params }: { params: { id: string } }) {
  return <RcaDetail id={params.id} />;
}
