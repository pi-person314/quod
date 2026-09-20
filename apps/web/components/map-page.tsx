"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReaderState } from "@quod/contracts";
import type { Dataset } from "@/lib/data";
import { CorpusMap } from "./corpus-map";
export function MapPage({data}:{data:Dataset}) {
  const router=useRouter();
  const [state,setState]=useState<Record<string,ReaderState>>({});
  useEffect(()=>{try{setState(JSON.parse(localStorage.getItem("quod.reader.v1")??localStorage.getItem("cairn.reader.v1")??"{}").state??{});}catch{}},[]);
  const jump=useCallback((doc:string,page:number,node?:string)=>router.push(`/read/${doc}?page=${page}${node?`#${node}`:""}`),[router]);
  return <CorpusMap data={data} state={state} onJump={jump} onClose={()=>router.push("/library")}/>;
}
