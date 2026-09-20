import { assertCorpusOwner } from "@/lib/firestore";
import { userDataset, scopeDataset, corpora } from "@/lib/data";
import { Reader } from "@/components/reader";
import { notFound, redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function ReadPage({
  params,
}: {
  params: Promise<{ doc_id: string }>;
}) {
  const { doc_id } = await params;
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthError && error.status === 401) redirect("/upload");
    throw error;
  }
  const data = await userDataset(user);
  const doc = data.docs.find((d) => d.id === doc_id);
  if (!doc) notFound();
  const set = await assertCorpusOwner(user, doc.corpus_id);
  const setName = (await corpora()).find(record => record.id === set.id)?.name ?? set.name;
  return (
    <Reader data={scopeDataset(data, doc.corpus_id)} initialDoc={doc_id} initialSetName={setName === "New course corpus" ? "New documents" : setName} />
  );
}
