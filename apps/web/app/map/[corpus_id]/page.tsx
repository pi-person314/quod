import { notFound, redirect } from "next/navigation";
import { userDataset, scopeDataset } from "@/lib/data";
import { requireUser, AuthError } from "@/lib/auth";
import { MapPage } from "@/components/map-page";
export const dynamic = "force-dynamic";
export default async function Page({params}:{params:Promise<{corpus_id:string}>}) {
  const {corpus_id}=await params;
  let user;
  try{user=await requireUser();}catch(e){if(e instanceof AuthError&&e.status===401)redirect("/library");throw e;}
  const data=await userDataset(user);
  if(!data.docs.some(d=>d.corpus_id===corpus_id))notFound();
  return <MapPage data={scopeDataset(data,corpus_id)}/>;
}
