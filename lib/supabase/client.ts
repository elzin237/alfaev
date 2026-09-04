import { createClient } from "@supabase/supabase-js";

import { frontendEnv } from "../config/env";

export const supabase = createClient(
  frontendEnv.supabaseUrl,
  frontendEnv.supabasePublishableKey,
);
