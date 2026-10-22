import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { createHandler } from "./handler.mjs";
Deno.serve(createHandler({ createClient, env: (name: string) => Deno.env.get(name) }));
