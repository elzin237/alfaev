import {useEffect,useMemo,useRef,useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useAuth} from "../../../app/auth/AuthProvider";
import {isUnifiedCommittedEnabled} from "../../../app/config/unifiedCommittedActivation";
import {testUuid} from "../../test-calculator/services/testCalculationSaveService";
import {setMaterialAttribution,unifiedCommittedPrefix} from "../services/unifiedCommittedService";
import {inventoryReservationAccountingPrefix} from "../services/inventoryReservationAccountingService";
import {inventoryCommitmentBreakdownPrefix} from "../services/inventoryCommitmentBreakdownService";
import {attributionRecoveryKey,AttributionRecoveryError,readAttributionRecovery,prepareAttributionRecovery,updateAttributionRecovery,clearAttributionRecovery,sameAttributionRecovery,withAttributionRecoveryLock,validAttributionIntent,type AttributionIntent,type AttributionRecovery} from "../services/materialAttributionRecoveryStore";
interface State {scope:string;ready:boolean;busy:boolean;pending:AttributionRecovery|null;error:string|null;saved:boolean}
export function useAttributionWorkflow(){
  const auth=useAuth(),client=useQueryClient();
  const allowed=isUnifiedCommittedEnabled()&&!auth.isLoading&&!auth.error&&auth.isActive&&auth.isAdmin&&Boolean(auth.session?.access_token&&auth.profile?.isActive&&auth.profile.authUserId===auth.session.user.id&&testUuid(auth.profile.id)&&testUuid(auth.session.user.id));
  const identity=useMemo(()=>allowed?{authUserId:auth.session!.user.id,profileId:auth.profile!.id}:null,[allowed,auth.session?.user.id,auth.profile?.id]);
  const scope=identity?attributionRecoveryKey(identity):"disabled",control=useMemo(()=>({busy:false,known:null as AttributionRecovery|null}),[scope]);
  const current=useRef({allowed,scope});current.current={allowed,scope};const mounted=useRef(true);
  const [state,setState]=useState<State>({scope:"",ready:false,busy:false,pending:null,error:null,saved:false});
  const inScope=()=>mounted.current&&current.current.allowed&&current.current.scope===scope;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    setState({scope,ready:false,busy:false,pending:null,error:null,saved:false});if(!identity)return;
    const check=()=>{if(!inScope()||control.busy)return;try{const pending=readAttributionRecovery(identity);if(control.known&&(!pending||!sameAttributionRecovery(control.known,pending)))throw new AttributionRecoveryError();control.known=pending;setState(s=>({...s,scope,ready:true,pending,error:null}));}catch{setState(s=>({...s,ready:false,error:new AttributionRecoveryError().message}));}};
    check();const changed=(e:StorageEvent)=>{if(e.key===null||e.key===scope)check();};window.addEventListener("storage",changed);window.addEventListener("focus",check);return()=>{window.removeEventListener("storage",changed);window.removeEventListener("focus",check);};
  },[scope,control]);
  const visible=allowed&&state.scope===scope;
  async function execute(intent?:AttributionIntent,confirmed=false){
    const recovering=intent===undefined;if(!identity||!inScope()||!visible||!state.ready||control.busy||!recovering&&(!confirmed||!validAttributionIntent(intent)||state.pending))return;
    control.busy=true;setState(s=>({...s,busy:true,error:null,saved:false}));const token=auth.session!.access_token;
    try{await withAttributionRecoveryLock(identity,async()=>{
      if(!inScope())return;let record=readAttributionRecovery(identity);
      if(control.known&&(!record||!sameAttributionRecovery(control.known,record)))throw new AttributionRecoveryError();
      if(record&&!recovering){control.known=record;setState(s=>({...s,pending:record}));return;}
      if(!record){if(recovering)throw new AttributionRecoveryError();record=prepareAttributionRecovery(identity,intent!);}
      control.known=record;if(!inScope())return;
      if(!record.receipt){record=updateAttributionRecovery(record);control.known=record;setState(s=>({...s,pending:record}));
        const result=await setMaterialAttribution(record.intent.request,token);
        if(!result.ok){if(!recovering&&result.error.code!=="uncertain"&&result.error.code!=="unavailable"){clearAttributionRecovery(record);control.known=null;}
          if(inScope())setState(s=>({...s,pending:control.known,error:recovering?"Original request remains unresolved. Keep recovery data and retry that request only.":result.error.code==="rejected"?"Attribution rejected. Reload current material/requirement revisions and limits before trying again.":result.error.message}));return;}
        record=updateAttributionRecovery(record,result.value);control.known=record;
      }
      if(!inScope())return;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([Promise.all([unifiedCommittedPrefix(identity.authUserId,identity.profileId),inventoryReservationAccountingPrefix(identity.authUserId,identity.profileId),inventoryCommitmentBreakdownPrefix(identity.authUserId,identity.profileId)].map(queryKey=>client.invalidateQueries({queryKey}))),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Refresh timeout")),15000);})]);}finally{if(timer)clearTimeout(timer);}
      if(!inScope())return;clearAttributionRecovery(record);control.known=null;setState(s=>({...s,pending:null,saved:true,error:null}));
    });}catch(cause){if(inScope())setState(s=>({...s,ready:cause instanceof AttributionRecoveryError?false:s.ready,error:cause instanceof AttributionRecoveryError?cause.message:"Attribution or refresh could not finish. Recover the original request; do not submit a replacement."}));}
    finally{control.busy=false;if(inScope())setState(s=>({...s,busy:false}));}
  }
  return{allowed,scope,ready:visible&&state.ready,busy:visible&&state.busy,pending:visible?state.pending:null,error:visible?state.error:null,saved:visible&&state.saved,
    submit:(intent:AttributionIntent,confirmed:boolean)=>execute(intent,confirmed),recover:()=>execute()};
}
