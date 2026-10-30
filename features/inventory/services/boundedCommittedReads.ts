// Per-Product backend only: cap active calls, cancel queued reads when rows leave.
let active=0;
const pending:Array<()=>void>=[];
export async function boundedCommittedRead<T>(run:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)throw new DOMException("Aborted","AbortError");
  await new Promise<void>((resolve,reject)=>{
    const start=()=>{signal?.removeEventListener("abort",abort);active++;resolve();};
    const abort=()=>{const index=pending.indexOf(start);if(index>=0){pending.splice(index,1);reject(new DOMException("Aborted","AbortError"));}};
    if(active<4)start();else{pending.push(start);signal?.addEventListener("abort",abort,{once:true});}
  });
  try{if(signal?.aborted)throw new DOMException("Aborted","AbortError");return await run();}
  finally{active--;pending.shift()?.();}
}
