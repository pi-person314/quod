import { userDataset, scopeDataset, userCorpora } from "@/lib/data";
import { BackendOfflineError } from "@/lib/remote-data";
import { BackendUnavailable } from "@/components/backend-status";
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
  try {
  const data = await userDataset(user);
  const doc = data.docs.find((d) => d.id === doc_id);
  if (!doc) notFound();
  const setName = (await userCorpora(user)).find(record => record.id === doc.corpus_id)?.name ?? "Documents";
  return (
    <Reader data={scopeDataset(data, doc.corpus_id)} initialDoc={doc_id} initialSetName={setName === "New course corpus" ? "New documents" : setName} />
  );
  } catch (error) {
    if (error instanceof BackendOfflineError) return <BackendUnavailable />;
    throw error;
  }
}
