"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function RenameButton({kind,id,name,onRename}:{kind:"document"|"set";id:string;name:string;onRename:(name:string)=>void}) {
  const [open,setOpen]=useState(false);
  return <><button type="button" className="rename-button" aria-label={`Rename ${kind === "set" ? "document set" : "document"}: ${name}`} title="Rename" onClick={()=>setOpen(true)}>✎</button>
    {open&&createPortal(<RenameDialog kind={kind} id={id} name={name} onRename={onRename} onClose={()=>setOpen(false)}/>,document.body)}</>;
}
function RenameDialog({kind,id,name,onRename,onClose}:{kind:"document"|"set";id:string;name:string;onRename:(name:string)=>void;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const [value,setValue]=useState(name),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{const el=dialog.current!;el.showModal();input.current?.select();return()=>el.close();},[]);
  return <dialog ref={dialog} className="rename-dialog" aria-labelledby="rename-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onKeyDown={event=>event.stopPropagation()}>
    <form onSubmit={async event=>{event.preventDefault();if(busy||!value.trim())return;setBusy(true);setError("");try{
      const response=await fetch(`/api/${kind === "set" ? "corpus" : "doc"}/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(kind === "set" ? {name:value.trim()} : {title:value.trim()})});
      const body=await response.json();if(!response.ok)throw new Error(body.error||"The name could not be saved. Try again.");
      onRename(value.trim());onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:"The name could not be saved.");setBusy(false);}}}>
      <h2 id="rename-title">Rename {kind === "set" ? "document set" : "document"}</h2>
      <label htmlFor="rename-name">Name</label><input ref={input} id="rename-name" value={value} onChange={e=>setValue(e.target.value)} maxLength={200} required disabled={busy}/>
      {error&&<p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" disabled={busy||!value.trim()}>{busy?"Saving…":"Save name"}</button></footer>
    </form></dialog>;
}
