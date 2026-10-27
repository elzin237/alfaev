import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { validateTestCalculationDraft, type TestCalculationDraft } from "../testCalculationDraft";
import type { TestCalculationPreview } from "../services/testCalculationPreviewService";
import { saveTestCalculation,reconcileTestCalculation,testUuid,type TestSaveReceipt } from "../services/testCalculationSaveService";
import { readTestRecovery,prepareTestRecovery,updateTestRecovery,clearTestRecovery,withTestRecoveryLock,sameTestRecovery,testRecoveryKey,
  testCalculationHistoryPrefix,inventoryTestCommitmentsPrefix,TestRecoveryError,type TestRecoveryRecord } from "../services/testCalculationRecoveryStore";

export function useTestCalculationSave(draft:TestCalculationDraft,preview:TestCalculationPreview|null,previewFingerprint:string|null,enabled=false){
  const {session,profile,isActive,isLoading,error:authError}=useAuth(),client=useQueryClient();
  const allowed=enabled&&!isLoading&&!authError&&isActive&&Boolean(session?.access_token&&profile?.isActive&&profile.authUserId===session.user.id&&testUuid(session.user.id)&&testUuid(profile.id));
  const identity=useMemo(()=>allowed?{authUserId:session!.user.id,profileId:profile!.id}:null,[allowed,session?.user.id,profile?.id]);
  const scope=identity?testRecoveryKey(identity):"disabled";
  const fingerprint=JSON.stringify(draft);
  const current=useRef({scope,allowed,token:session?.access_token,fingerprint,previewFingerprint});current.current={scope,allowed,token:session?.access_token,fingerprint,previewFingerprint};
  const mounted=useRef(true),busyRef=useRef(false),completed=useRef(false),known=useRef<TestRecoveryRecord|null>(null),trusted=useRef<TestSaveReceipt|null>(null);
  const [state,setState]=useState<{scope:string;ready:boolean;pending:TestRecoveryRecord|null;error:string|null;busy:boolean;saved:TestSaveReceipt|null;done:boolean}>({scope:"",ready:false,pending:null,error:null,busy:false,saved:null,done:false});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const inScope=()=>mounted.current&&current.current.scope===scope&&current.current.allowed;
  const check=()=>{
    if(!identity||!inScope())return;
    try{const record=readTestRecovery(identity);if(known.current&&(!record||!sameTestRecovery(known.current,record)))throw new TestRecoveryError();known.current=record;
      setState(s=>({...s,scope,ready:true,pending:record,error:null}));
    }catch{setState(s=>({...s,scope,ready:false,error:new TestRecoveryError().message}));}
  };
  useEffect(()=>{
    known.current=null;trusted.current=null;busyRef.current=false;completed.current=false;
    setState({scope,ready:false,pending:null,error:null,busy:false,saved:null,done:false});
    if(!identity)return;check();
    const changed=(event:StorageEvent)=>{if(event.key===null||event.key===testRecoveryKey(identity))check();};
    window.addEventListener("storage",changed);window.addEventListener("focus",check);
    return()=>{window.removeEventListener("storage",changed);window.removeEventListener("focus",check);};
  },[scope]);
  const visible=allowed&&state.scope===scope;
  const validPreview=preview&&preview.saveWillRecalculate&&previewFingerprint===JSON.stringify(draft)&&preview.rows.length===draft.items.length&&draft.items.every(i=>preview.rows.some(r=>r.productId===i.product.productId&&r.required===i.quantity));
  const canSave=Boolean(visible&&state.ready&&!state.pending&&!state.done&&!busyRef.current&&validPreview&&validateTestCalculationDraft(draft).length===0);
  async function execute(recover=false){
    if(!identity||!inScope()||busyRef.current||completed.current||!visible||!state.ready||state.done||(!recover&&!canSave))return;
    busyRef.current=true;setState(s=>({...s,busy:true,error:null}));
    const token=current.current.token!;
    try{await withTestRecoveryLock(identity,async()=>{
      if(!inScope())return;
      let record=readTestRecovery(identity);
      if(known.current&&(!record||!sameTestRecovery(known.current,record)))throw new TestRecoveryError();
      if(record&&!recover){known.current=record;setState(s=>({...s,pending:record}));return;}
      if(!record){
        if(recover)throw new TestRecoveryError();
        if(current.current.fingerprint!==fingerprint||current.current.previewFingerprint!==fingerprint||validateTestCalculationDraft(draft).length)throw new Error("Draft changed");
        record=prepareTestRecovery(identity,{requestId:crypto.randomUUID(),name:draft.name.trim(),deadlineDate:draft.deadlineDate,
          items:draft.items.map(i=>({product_id:i.product.productId,quantity:i.quantity})).sort((a,b)=>a.product_id.localeCompare(b.product_id))});
      }
      known.current=record;if(inScope())setState(s=>({...s,pending:record}));
      if(!inScope())return;
      let receipt=trusted.current;
      if(!receipt){
        const result=await saveTestCalculation(record.request,token);
        record=updateTestRecovery(record,result.ok?"confirmed_success":result.error.uncertain?"uncertain":"definite_failure");
        if(!inScope())return;
        known.current=record;
        setState(s=>({...s,pending:record}));
        if(!result.ok){setState(s=>({...s,error:result.error.message}));return;}
        receipt=result.value;trusted.current=receipt;
      }
      if(!inScope())return;
      if(!await reconcileTestCalculation(receipt,token))throw new Error("Save receipt received, but authoritative reconciliation failed. Recover the original request; do not submit a replacement.");
      if(!inScope())return;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([Promise.all([testCalculationHistoryPrefix(identity),inventoryTestCommitmentsPrefix(identity),["test-calculator-products",identity.authUserId,identity.profileId],
        ["test-calculation-preview",identity.authUserId,identity.profileId]]
        .map(queryKey=>client.invalidateQueries({queryKey}, {throwOnError:true}))),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Refresh timeout")),30_000);})]);}
      finally{if(timer!==undefined)clearTimeout(timer);}
      if(!inScope())return;
      clearTestRecovery(record);known.current=null;completed.current=true;
      setState(s=>({...s,pending:null,saved:receipt,done:true,error:null}));
    });}catch(cause){if(inScope())setState(s=>({...s,ready:!(cause instanceof TestRecoveryError)&&s.ready,error:cause instanceof TestRecoveryError?cause.message:
      "Save or reconciliation could not finish. Keep the original request and use explicit recovery; no replacement Save is allowed."}));}
    finally{if(inScope()){busyRef.current=false;setState(s=>({...s,busy:false}));}}
  }
  return {canSave,submit:()=>execute(false),recover:()=>execute(true),busy:visible&&state.busy,
    pending:visible?state.pending:null,saved:visible?state.saved:null,error:visible?state.error:null,
    frozen:Boolean(visible&&(state.pending||state.busy||state.saved||state.done)),blocked:enabled&&(!visible||!state.ready)};
}
