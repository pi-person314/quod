// /read/:doc_id — the reader. B1 puts the PDF.js canvas + overlay layer here.
export default async function ReadPage({ params }: { params: Promise<{ doc_id: string }> }) {
  const { doc_id } = await params;
  return (
    <main className="p-6">
      <p className="text-sm text-neutral-500">reader for {doc_id} — B1 renders the PDF here</p>
    </main>
  );
}
