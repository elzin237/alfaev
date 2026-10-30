import {useMutation,useQueryClient} from "@tanstack/react-query";
import {useRef} from "react";
import {useAuth} from "../../../app/auth/AuthProvider";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {setMaterialAttribution,unifiedCommittedPrefix,type AttributionRequest} from "../services/unifiedCommittedService";
import {inventoryReservationAccountingPrefix} from "../services/inventoryReservationAccountingService";
import {inventoryCommitmentBreakdownPrefix} from "../services/inventoryCommitmentBreakdownService";
export function useMaterialAttribution(){
  const auth=useAuth(),client=useQueryClient();
  const dispatchScope=useRef<readonly unknown[]|null>(null);
  const allowed=isUnifiedCommittedEnabled()&&!auth.isLoading&&!auth.error&&auth.isActive&&auth.isAdmin&&Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id);
  const mutation=useMutation({retry:false,mutationFn:async(input:AttributionRequest)=>{
    const scope=unifiedCommittedPrefix(auth.session?.user.id,auth.profile?.id);
    dispatchScope.current=scope;
    // The caller owns the original UUID. Neither dispatch nor retries create one.
    const result=allowed?await setMaterialAttribution({...input},auth.session!.access_token):{ok:false as const,error:{code:"access_denied" as const,message:"Active Admin required"}};
    return{scope,result};
  },onSuccess:async({scope,result})=>{
    if(!result.ok)return;
    // Use dispatch-time scope, not a profile that may have switched meanwhile.
    await Promise.all([scope,inventoryReservationAccountingPrefix(scope[2],scope[3]),inventoryCommitmentBreakdownPrefix(scope[2],scope[3])].map(queryKey=>client.invalidateQueries({queryKey})));
  }});
  const currentScope=unifiedCommittedPrefix(auth.session?.user.id,auth.profile?.id);
  const sameScope=allowed&&dispatchScope.current?.every((value,index)=>value===currentScope[index])&&
    (!mutation.data||mutation.data.scope.every((value,index)=>value===currentScope[index]));
  return{allowed,mutation:{...mutation,data:sameScope?mutation.data:undefined,variables:sameScope?mutation.variables:undefined}};
}
