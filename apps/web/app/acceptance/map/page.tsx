import { notFound } from "next/navigation";
import { MapBenchmark } from "@/components/map-benchmark";
import { dataset, scopeDataset } from "@/lib/data";
export const dynamic = "force-dynamic";
export default async function Benchmark() {
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.QUOD_ACCEPTANCE ?? process.env.CAIRN_ACCEPTANCE) !== "1"
  )
    notFound();
  const data = await dataset();
  return <MapBenchmark data={scopeDataset(data, data.docs[0].corpus_id)} />;
}
