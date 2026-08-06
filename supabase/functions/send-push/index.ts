// Edge Function: send-push
// Wywoływana automatycznie przez Database Webhook przy każdym nowym wierszu
// w tabeli "notifications". Wysyła prawdziwe powiadomienie push do wszystkich
// zarejestrowanych urządzeń danego użytkownika (działa nawet gdy telefon jest
// zablokowany albo aplikacja zamknięta).
//
// Wdrożenie (z terminala, w folderze projektu):
//   supabase functions deploy send-push
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:twoj@email.pl
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...   (z Project Settings → API Keys → service_role)
//
// Pełne instrukcje krok po kroku są w INSTRUKCJA.txt.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ACTION_TITLES = {
  invite: "Nowe zaproszenie",
  invite_response: "Odpowiedź na zaproszenie",
  join_request: "Prośba o zmianę terminu",
  join_response: "Odpowiedź na prośbę",
  event_cancelled: "Termin odwołany",
  info: "Grafik zespołu",
};

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Database Webhook wysyła { type: "INSERT", table: "notifications", record: {...} }
    const record = payload.record || payload;
    const userId = record.user_id;
    const message = record.message;
    const type = record.type;
    if (!userId || !message) return new Response("ok (nothing to send)", { status: 200 });

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", userId);
    if (error) throw error;
    if (!subs || subs.length === 0) return new Response("ok (no subscriptions)", { status: 200 });

    const title = ACTION_TITLES[type] || "Grafik zespołu";
    const body = message;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title, body })
          );
        } catch (err) {
          // 410/404 = subskrypcja wygasła/została odinstalowana — sprzątamy
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          } else {
            console.error("push send failed", sub.id, err.message);
          }
        }
      })
    );

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
