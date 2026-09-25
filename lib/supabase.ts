import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

let _admin: SupabaseClient | null = null;

/** Cliente con la clave secreta (solo servidor). Omite RLS: filtrar SIEMPRE por clinic_id. */
export function db(): SupabaseClient {
  if (_admin) return _admin;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "Falta SUPABASE_SECRET_KEY en las variables de entorno (Supabase → Project Settings → API Keys → Secret keys)."
    );
  }
  _admin = createClient(URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

/** Cliente público (clave publicable) para operaciones de autenticación. */
export function authClient(): SupabaseClient {
  return createClient(URL, PUBLISHABLE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Solo para pruebas automatizadas: inyecta un cliente alternativo. */
export function __setDbForTests(client: any) {
  _admin = client;
}

export const supabaseUrl = URL;
export const supabasePublishable = PUBLISHABLE;
