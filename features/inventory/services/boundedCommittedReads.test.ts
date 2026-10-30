import {expect,it} from "vitest";
import {boundedCommittedRead} from "./boundedCommittedReads";
it("caps concurrency at four and removes aborted queued rows without dispatch",async()=>{
  let active=0,peak=0,calls=0;const releases:Array<()=>void>=[],controllers=Array.from({length:12},()=>new AbortController());
  const requests=controllers.map(c=>boundedCommittedRead(async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>releases.push(resolve));active--;return calls;},c.signal).catch(()=>"aborted"));
  await Promise.resolve();expect(calls).toBe(4);controllers[7]!.abort();
  while(releases.length){releases.shift()!();await new Promise(resolve=>setTimeout(resolve,0));}
  await Promise.all(requests);expect(peak).toBe(4);expect(calls).toBe(11);expect(await requests[7]).toBe("aborted");
});
it("does not dispatch an already aborted row and releases slots after errors",async()=>{const c=new AbortController();c.abort();let calls=0;await expect(boundedCommittedRead(async()=>{calls++;},c.signal)).rejects.toMatchObject({name:"AbortError"});expect(calls).toBe(0);await expect(boundedCommittedRead(async()=>{throw Error("failed");})).rejects.toThrow("failed");expect(await boundedCommittedRead(async()=>"next")).toBe("next");});
