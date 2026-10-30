import {frontendEnv} from "../../lib/config/env";
// DEV migrations through 181 verified. Other backend origins remain disabled.
export const UNIFIED_COMMITTED_RELEASE=Object.freeze({enabled:true,
  backendOrigin:"https://yzysgbrpbhiapalgetau.supabase.co",requiredMigration:"20261030210000"});
export const isUnifiedCommittedEnabled=()=>UNIFIED_COMMITTED_RELEASE.enabled&&
  new URL(frontendEnv.supabaseUrl).origin===UNIFIED_COMMITTED_RELEASE.backendOrigin;
