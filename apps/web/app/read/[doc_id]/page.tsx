import { dataset, scopeDataset } from "@/lib/data";
import { Reader } from "@/components/reader";
import { notFound } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function ReadPage({
  params,
}: {
  params: Promise<{ doc_id: string }>;
}) {
  const { doc_id } = await params;
  const data = await dataset();
  const doc = data.docs.find((d) => d.id === doc_id);
  if (!doc) notFound();
  return (
    <Reader data={scopeDataset(data, doc.corpus_id)} initialDoc={doc_id} />
  );
}
