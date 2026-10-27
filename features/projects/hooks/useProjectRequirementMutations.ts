import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { inventoryCommitmentsQueryKey } from "../../inventory/inventoryCommitmentQueryKeys";
import { projectFinishedGoodsQueryKeys } from "../projectFinishedGoodsQueryKeys";
import { projectPlanningQueryKey } from "../projectPlanningQueryKeys";
import { getProjectPlanning, type PlanningResult } from "../services/projectPlanningService";
import { getProjectFinishedGoods } from "../services/projectFinishedGoodsService";
import { recoveryKey, withRecoveryLock, RecoveryStorageError } from "../services/finishedGoodsRecoveryStore";
import { clearRequirementRecovery, prepareRequirementRecovery, readRequirementRecovery, requirementRecoveryKey, type RequirementRecovery } from "../services/projectRequirementRecoveryStore";
import { mutateProjectRequirement, type RequirementRequest } from "../services/projectRequirementMutationService";

export function useProjectRequirementMutations(projectId:string) {
  const {session,profile,isAdmin}=useAuth(),client=useQueryClient();
  const permissions=useQueries({queries:(["projects.view","projects.edit","inventory.finished_goods.view","inventory.finished_goods.reserve"] as const).map(key=>({
    queryKey:permissionQueryKey(session?.user.id,profile?.id,key),queryFn:()=>hasPermission(key),enabled:Boolean(session&&profile?.isActive&&!isAdmin),staleTime:60_000,
  }))});
  const authorized=Boolean(session&&profile?.isActive&&(isAdmin||permissions.every(q=>!q.isError&&q.data?.ok&&q.data.value)));
  const identity=useMemo(()=>session&&profile?.isActive?{authUserId:session.user.id,profileId:profile.id,projectId}:null,
    [session?.user.id,profile?.id,profile?.isActive,projectId]);
  const scope=identity?`${identity.authUserId}/${identity.profileId}/${identity.projectId}`:"";
  const current=useRef({scope,token:session?.access_token});current.current={scope,token:session?.access_token};
  const mounted=useRef(true),lock=useRef(false);
  const remembered=useRef<RequirementRecovery|null>(null);
  const [state,setState]=useState<{scope:string;pending:RequirementRecovery|null;error:string|null;busy:boolean}>({scope:"",pending:null,error:null,busy:false});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const live=()=>mounted.current&&Boolean(identity)&&current.current.scope===scope;
  const failure=(message:string):PlanningResult<{id:string}>=>({ok:false,error:{code:"mutation_failed",message}});
  function checkRecovery(){
    if(!identity||!live()||lock.current)return;
    try{const saved=readRequirementRecovery(identity);
      if(!saved&&remembered.current&&recoveryKey(remembered.current.identity)===recoveryKey(identity))throw new RecoveryStorageError();
      remembered.current=saved;setState({scope,pending:saved,error:null,busy:false});}
    catch{setState({scope,pending:null,error:new RecoveryStorageError().message,busy:false});}
  }
  useEffect(()=>{
    checkRecovery();
    const changed=(e:StorageEvent)=>{if(lock.current||!identity)return;try{
      if(e.key===null||e.key===recoveryKey(identity)||e.key===requirementRecoveryKey(identity))checkRecovery();
    }catch{checkRecovery();}};
    window.addEventListener("storage",changed);return()=>window.removeEventListener("storage",changed);
  },[scope]);
  async function perform(input?:Omit<RequirementRequest,"requestId">):Promise<PlanningResult<{id:string}>> {
    if(!identity||!live()||lock.current||!current.current.token||!authorized)return failure("Project view/edit and Finished Goods view/reserve permissions are required, or another request is still running. Saved requests are retained.");
    lock.current=true;setState(s=>({...s,scope,busy:true}));
    try{return await withRecoveryLock(identity,async()=>{
      if(!live())return failure("The authenticated identity changed. Return to the original account to recover its request.");
      let saved=readRequirementRecovery(identity);
      if(!saved&&remembered.current&&recoveryKey(remembered.current.identity)===recoveryKey(identity))throw new RecoveryStorageError();
      if(saved&&input){setState({scope,pending:saved,error:"A saved request must be reconciled before another Finished Goods requirement change.",busy:true});
        return failure("Retry the saved original requirement request first.");}
      if(!saved){
        if(!input)return failure("No saved requirement request was found.");
        saved=prepareRequirementRecovery(identity,{...input,requestId:crypto.randomUUID()});
      }
      remembered.current=saved;
      const token=current.current.token!;
      if(!live())return failure("Identity changed; the original request is retained.");
      setState({scope,pending:saved,error:null,busy:true});
      const result=await mutateProjectRequirement(saved.request,token);
      if(!live())return failure("Identity changed; the original request is retained.");
      if(!result.ok&&result.error.uncertain){setState({scope,pending:saved,error:result.error.message,busy:true});return failure(result.error.message);}
      // A historical receipt is not current stock. Always obtain fresh authorized
      // state before clearing the durable intent; never insert receipt quantities.
      let refreshTimer:ReturnType<typeof setTimeout>|undefined;
      const [planning,fg]=await Promise.race([
        Promise.all([getProjectPlanning(projectId),getProjectFinishedGoods(projectId,AbortSignal.timeout(30_000),token)]),
        new Promise<never>((_,reject)=>{refreshTimer=setTimeout(()=>reject(Error("Authoritative refresh timed out. Retry the saved original request.")),30_000);}),
      ]).finally(()=>{if(refreshTimer)clearTimeout(refreshTimer);});
      if(!live()||!planning.ok||!fg.ok)throw Error("Authoritative refresh failed. The original request remains saved; retry it to reconcile.");
      await Promise.all([
        client.invalidateQueries({queryKey:projectPlanningQueryKey(identity.profileId,projectId),exact:true}),
        client.invalidateQueries({queryKey:projectFinishedGoodsQueryKeys.profile(identity.profileId)}),
        client.invalidateQueries({queryKey:inventoryCommitmentsQueryKey(identity.profileId)}),
      ]);
      if(!live())return failure("Identity changed; the original request is retained.");
      client.setQueryData(projectPlanningQueryKey(identity.profileId,projectId),planning);
      client.setQueryData(projectFinishedGoodsQueryKeys.context(identity.profileId,projectId),fg);
      clearRequirementRecovery(saved);
      remembered.current=null;
      setState({scope,pending:null,error:result.ok?null:result.error.message,busy:false});
      return result.ok?{ok:true,value:{id:result.value.component_id}}:failure(result.error.message);
    });}catch(e){
      const message=e instanceof Error?e.message:new RecoveryStorageError().message;
      if(live())setState(s=>({...s,scope,error:message,busy:false}));return failure(message);
    }finally{lock.current=false;if(live())setState(s=>({...s,busy:false}));}
  }
  return {execute:(input:Omit<RequirementRequest,"requestId">)=>perform(input),retry:()=>perform(),checkRecovery,
    pending:state.scope===scope?state.pending:null,error:state.scope===scope?state.error:null,busy:state.scope===scope&&state.busy};
}
