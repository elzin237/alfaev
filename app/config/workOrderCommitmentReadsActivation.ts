import {frontendEnv} from "../../lib/config/env";
// DEV deployment through 177 verified; this switch never enables reservation writers.
export const WORK_ORDER_COMMITMENT_READS_RELEASE=Object.freeze({enabled:true,
  backendOrigin:"https://yzysgbrpbhiapalgetau.supabase.co",requiredMigration:"20261030160000"});
export const isWorkOrderCommitmentReadsEnabled=()=>WORK_ORDER_COMMITMENT_READS_RELEASE.enabled&&
  new URL(frontendEnv.supabaseUrl).origin===WORK_ORDER_COMMITMENT_READS_RELEASE.backendOrigin;
