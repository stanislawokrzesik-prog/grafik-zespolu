import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Brak VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — ustaw je w pliku .env (lokalnie) lub w Netlify → Site settings → Environment variables."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
