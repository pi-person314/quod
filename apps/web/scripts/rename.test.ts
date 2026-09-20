import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";

test("renames persist with ownership, validation and original files preserved", async () => {
  const cwd=process.cwd(), previousFetch=globalThis.fetch;
  const keys=["USE_FIXTURES","FIXTURES_DIR","NEXT_PUBLIC_FIREBASE_API_KEY","NEXT_PUBLIC_FIREBASE_PROJECT_ID"];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const scratch=await mkdtemp(join(tmpdir(),"quod-rename-test-"));
  const corpus="00000000-0000-4000-8000-000000000001";
  let owner="alice";
  try {
    process.env.USE_FIXTURES="1";process.env.FIXTURES_DIR=resolve(cwd,"demo");
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY="test";process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID="test";
    process.chdir(scratch);
    globalThis.fetch=async(input)=>String(input).includes("accounts:lookup")
      ? Response.json({users:[{localId:"alice"}]})
      : Response.json({fields:Object.fromEntries(Object.entries({id:corpus,name:"Math",created_at:"2026-09-20T00:00:00Z",owner_uid:owner}).map(([k,v])=>[k,{stringValue:v}]))});
    const {PATCH:renameSet}=await import("../app/api/corpus/[id]/route");
    const {PATCH:renameDoc}=await import("../app/api/doc/[id]/route");
    const {GET:list}=await import("../app/api/corpus/route");
    const {dataset,saveLocal}=await import("../lib/data");
    const jwt=`header.${Buffer.from(JSON.stringify({aud:"test",iss:"https://securetoken.google.com/test",sub:"alice",exp:Date.now()/1000+3600})).toString("base64url")}.signature`;
    const request=(body:unknown,authenticated=true,origin="https://quod.test")=>new Request("https://quod.test/api/rename",{method:"PATCH",headers:{origin,"content-type":"application/json",...(authenticated?{authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify(body)});
    const params={params:Promise.resolve({id:corpus})};
    assert.equal((await renameSet(request({name:"Renamed"},false),params)).status,401);
    assert.equal((await renameSet(request({name:"Renamed"},true,"https://attacker.test"),params)).status,403);
    for(const name of ["   ","x".repeat(201)])assert.equal((await renameSet(request({name}),params)).status,400);
    owner="bob";assert.equal((await renameSet(request({name:"Renamed"}),params)).status,404);owner="alice";
    const before=await dataset();const doc=before.docs[0];const docParams={params:Promise.resolve({id:doc.id})};
    owner="bob";assert.equal((await renameDoc(request({title:"Renamed"}),docParams)).status,404);owner="alice";
    assert.equal((await renameDoc(request({title:" "}),docParams)).status,400);
    assert.equal((await renameSet(request({name:"  Algebra notes  "}),params)).status,200);
    assert.equal((await renameDoc(request({title:"  Better textbook  "}),docParams)).status,200);
    let after=await dataset();assert.equal(after.docs.find(d=>d.id===doc.id)?.title,"Better textbook");
    assert.equal(after.docs.find(d=>d.id===doc.id)?.filename,doc.filename);
    assert.equal(after.docs.length,before.docs.length);assert.equal(after.nodes.length,before.nodes.length);
    const uploaded={...doc,id:"99999999-9999-4999-8999-999999999999",title:"Uploaded"};
    await saveLocal("docs",uploaded.id,{doc:uploaded,nodes:[]});
    assert.equal((await renameDoc(request({title:"Renamed upload"}),{params:Promise.resolve({id:uploaded.id})})).status,200);
    after=await dataset();assert.equal(after.docs.find(d=>d.id===uploaded.id)?.title,"Renamed upload");
    const mockFetch=globalThis.fetch;
    globalThis.fetch=async(input,init)=>String(input).includes(":runQuery")
      ? Response.json([{document:{fields:Object.fromEntries(Object.entries({id:corpus,name:"Math",created_at:"2026-09-20T00:00:00Z",owner_uid:"alice"}).map(([k,v])=>[k,{stringValue:v}]))}}])
      : mockFetch(input,init);
    const library=await list(new Request("https://quod.test/api/corpus",{headers:{authorization:`Bearer ${jwt}`}}));
    assert.equal((await library.json()).corpora[0].name,"Algebra notes");
  } finally {
    globalThis.fetch=previousFetch;process.chdir(cwd);
    for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    if(dirname(resolve(scratch))===resolve(tmpdir()))await rm(scratch,{recursive:true,force:true});
  }
});
