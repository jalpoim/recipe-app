import { createServerClient } from "@supabase/ssr";
import type { Database } from "../../types/db";
import { getCookies, setCookie } from "@tanstack/react-start/server";

export function getLang(): string {
  const cookies = getCookies();
  const lang = cookies["i18n_lang"] ?? "pt";
  return ["pt", "en"].includes(lang) ? lang : "pt";
}

export function makeClient() {
  return createServerClient<Database>(
    (import.meta.env.VITE_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL) as string,
    (import.meta.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY) as string,
    {
      cookies: {
        getAll() {
          const cookies = getCookies();
          return Object.entries(cookies).map(([name, value]) => ({
            name,
            value,
          }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            setCookie(name, value, options as Parameters<typeof setCookie>[2]),
          );
        },
      },
    },
  );
}
