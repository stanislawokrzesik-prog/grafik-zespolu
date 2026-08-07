import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Calendar as CalIcon, Bell, LogOut, Plus, Check, X, Clock,
  MapPin, Settings, AlertTriangle, Send, ChevronLeft, ChevronRight,
  ShieldCheck, User as UserIcon, Trash2, Pencil, Ban, Loader2, Sun, Moon, Mail, KeyRound, Repeat, CalendarDays
} from "lucide-react";
import { supabase } from "./supabaseClient.js";

// ---------- design tokens (mutable — mutated in place on theme switch) ----------
const DARK_THEME = {
  bg: "#12141C", panel: "#1A1D29", panel2: "#20243350", line: "#2B2F42",
  text: "#EDEEF4", textMuted: "#8B90AC",
  amber: "#E8A33D", teal: "#3FA796", rose: "#E8637A", violet: "#8C8CE0",
};
const LIGHT_THEME = {
  bg: "#F3F4F9", panel: "#FFFFFF", panel2: "#E7EAF3A0", line: "#DEE1EC",
  text: "#1C1F2B", textMuted: "#6B7086",
  amber: "#B97318", teal: "#2C8577", rose: "#D14F68", violet: "#6D6DC9",
};
const COLORS = { ...DARK_THEME };
function applyTheme(theme) { Object.assign(COLORS, theme === "light" ? LIGHT_THEME : DARK_THEME); }
const USER_PALETTE = ["#E8A33D", "#3FA796", "#8C8CE0", "#E8637A", "#5DBEE8"];
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');`;
const RESPONSIVE_CSS = `
.week-grid { display:grid; grid-template-columns: repeat(7, minmax(140px, 1fr)); gap:10px; overflow-x:auto; }
@media (max-width: 700px) {
  .week-grid { grid-template-columns: 1fr; overflow-x: visible; gap:8px; }
}
`;
const GLOBAL_STYLE = FONT_IMPORT + RESPONSIVE_CSS;

// Mutowalna flaga "telefon" — czytana w komponentach współdzielonych (Input, przyciski,
// itp.), żeby powiększyć czcionki/przyciski na wąskim ekranie. Zamiast ryzykownego CSS
// "zoom" (który potrafi łamać przewijanie i pozycjonowanie modali), po prostu zwiększamy
// realne wartości fontSize/padding w miejscach, gdzie to najbardziej widoczne.
let IS_MOBILE = typeof window !== "undefined" && window.innerWidth <= 700;
function mfs(px) { return IS_MOBILE ? Math.round(px * 1.3) : px; } // "mobile font size"

// ---------- date helpers ----------
function pad(n) { return String(n).padStart(2, "0"); }
function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}
// Wykorzystanie kalendarza w najbliższych `days` dniach: suma godzin "wspólnej pracy"
// (na osobę) podzielona przez teoretyczną pojemność zespołu (liczba zatwierdzonych
// osób × godziny dziennie × liczba dni). Prosta, przejrzysta metryka — nie uwzględnia
// nieobecności (te już naturalnie zmniejszają dostępność, ale nie odejmujemy ich z
// mianownika, żeby procent był łatwy do wytłumaczenia).
function computeCapacityPct(events, profiles, days, hoursPerDay) {
  const approvedCount = profiles.filter(p => p.approved).length;
  if (approvedCount === 0) return null;
  const capacityHours = approvedCount * days * hoursPerDay;
  const todayIso = toISODate(new Date());
  const windowEndIso = toISODate(addDays(new Date(), days));
  let bookedHours = 0;
  events.forEach(ev => {
    if (ev.type !== "work" || !ev.detailed) return;
    if (ev.date < todayIso || ev.date > windowEndIso) return;
    const durH = ev.allDay ? hoursPerDay : (timeToMin(ev.end) - timeToMin(ev.start)) / 60;
    const activeParticipants = (ev.participants || []).filter(p => p.status !== "declined").length;
    bookedHours += Math.max(0, durH) * activeParticipants;
  });
  return (bookedHours / capacityHours) * 100;
}
function startOfWeek(d) { const date = new Date(d); const day = (date.getDay() + 6) % 7; date.setDate(date.getDate() - day); date.setHours(0, 0, 0, 0); return date; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d, n) { const r = new Date(d); r.setDate(1); r.setMonth(r.getMonth() + n); return r; }
function addYears(d, n) { const r = new Date(d); r.setFullYear(r.getFullYear() + n); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthMatrix(d) {
  const first = startOfMonth(d);
  const gridStart = startOfWeek(first);
  const weeks = [];
  let cursor = gridStart;
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) { week.push(cursor); cursor = addDays(cursor, 1); }
    weeks.push(week);
    if (cursor > addDays(first, 40) && week.some(d2 => d2.getMonth() !== first.getMonth() && d2 > first)) break;
  }
  return weeks;
}
const DAY_NAMES = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nie"];
const MONTH_NAMES = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"];
function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function overlaps(aStart, aEnd, bStart, bEnd) { return timeToMin(aStart) < timeToMin(bEnd) && timeToMin(bStart) < timeToMin(aEnd); }
// Jak overlaps(), ale dodatkowo traktuje jako "zajęte" zbyt krótkie przerwy między
// terminami (np. brak czasu na dojazd) — bufferMin to minimalny odstęp w minutach.
function overlapsWithBuffer(aStart, aEnd, bStart, bEnd, bufferMin) {
  const aS = timeToMin(aStart) - bufferMin, aE = timeToMin(aEnd) + bufferMin;
  return aS < timeToMin(bEnd) && timeToMin(bStart) < aE;
}
function userColor(userId, profiles) { const u = profiles.find(p => p.id === userId); return u ? u.color : COLORS.textMuted; }
function userName(userId, profiles) { const u = profiles.find(p => p.id === userId); return u ? u.name : "(usunięty)"; }
function buildJoinRequestText(fromName, conflictEvent, draftEvent, message) {
  return `${fromName} pyta, czy możesz zmienić swój termin${conflictEvent ? ` (${conflictEvent.date} ${conflictEvent.start}–${conflictEvent.end})` : ""} i dołączyć do „${draftEvent.title}” (${draftEvent.date} ${draftEvent.start}–${draftEvent.end}${draftEvent.location ? " @ " + draftEvent.location : ""}). Wiadomość: ${message || "—"}`;
}

// ---------- data access (Supabase) ----------
async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at");
  if (error) throw error;
  return data || [];
}
async function fetchEvents(isAdmin) {
  const { data, error } = await supabase
    .from("events")
    .select("*, event_participants(user_id,status)")
    .order("date", { ascending: true }).order("start_time", { ascending: true });
  if (error) throw error;
  const detailed = (data || []).map(e => ({
    id: e.id, title: e.title, date: e.date, start: e.start_time, end: e.end_time, allDay: e.all_day,
    location: e.location, notes: e.notes, type: e.type, ownerId: e.owner_id, seriesId: e.series_id,
    participants: (e.event_participants || []).map(p => ({ userId: p.user_id, status: p.status })),
    detailed: true, recurring: false,
  }));
  if (isAdmin) return detailed; // admin already sees every row in full via RLS

  // non-admin: merge own/participant events (full detail) with everyone else's
  // busy slots (time only, no title/location/notes) so conflicts stay detectable
  // without exposing what other people are actually doing.
  const { data: busyRows, error: busyErr } = await supabase.from("event_busy_view").select("*");
  if (busyErr) throw busyErr;
  const detailedIds = new Set(detailed.map(e => e.id));
  const grouped = {};
  (busyRows || []).forEach(r => {
    if (detailedIds.has(r.event_id)) return;
    if (!grouped[r.event_id]) grouped[r.event_id] = { id: r.event_id, date: r.date, start: r.start_time, end: r.end_time, allDay: r.all_day, ownerId: r.owner_id, title: null, location: null, notes: null, type: null, participants: [], detailed: false, recurring: false };
    grouped[r.event_id].participants.push({ userId: r.user_id, status: r.status });
  });
  return [...detailed, ...Object.values(grouped)];
}
async function fetchRecurringBlocks(isAdmin) {
  const { data, error } = await supabase.from("recurring_blocks").select("*");
  if (error) throw error;
  const detailed = (data || []).map(r => ({
    id: r.id, userId: r.user_id, label: r.label, weekdays: r.weekdays, allDay: r.all_day,
    start: r.start_time, end: r.end_time, dateFrom: r.date_from, dateUntil: r.date_until,
    exceptionDates: r.exception_dates || [], detailed: true,
  }));
  if (isAdmin) return detailed;

  const { data: busyRows, error: busyErr } = await supabase.from("recurring_busy_view").select("*");
  if (busyErr) throw busyErr;
  const detailedIds = new Set(detailed.map(r => r.id));
  const minimal = (busyRows || []).filter(r => !detailedIds.has(r.id)).map(r => ({
    id: r.id, userId: r.user_id, label: null, weekdays: r.weekdays, allDay: r.all_day,
    start: r.start_time, end: r.end_time, dateFrom: r.date_from, dateUntil: r.date_until,
    exceptionDates: r.exception_dates || [], detailed: false,
  }));
  return [...detailed, ...minimal];
}
// Turns recurring rules into virtual "events" for a bounded window, so the rest of
// the app (conflict checks, calendar rendering) can treat them just like real events.
function expandRecurringBlocks(rules, windowStartISO, windowEndISO) {
  const out = [];
  const winStart = new Date(windowStartISO), winEnd = new Date(windowEndISO);
  rules.forEach(rule => {
    const from = new Date(Math.max(new Date(rule.dateFrom), winStart));
    const until = rule.dateUntil ? new Date(Math.min(new Date(rule.dateUntil), winEnd)) : winEnd;
    if (from > until) return;
    const exceptions = new Set(rule.exceptionDates || []);
    for (let d = new Date(from); d <= until; d.setDate(d.getDate() + 1)) {
      const weekday = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
      if (!rule.weekdays.includes(weekday)) continue;
      const iso = toISODate(d);
      if (exceptions.has(iso)) continue;
      out.push({
        id: `rec-${rule.id}-${iso}`, date: iso, start: rule.allDay ? "00:00" : rule.start, end: rule.allDay ? "23:59" : rule.end,
        allDay: rule.allDay, ownerId: rule.userId, type: "block", title: rule.detailed ? (rule.label || "Niedostępność cykliczna") : null,
        location: null, notes: null, participants: [{ userId: rule.userId, status: "accepted" }],
        detailed: rule.detailed, recurring: true, recurringRuleId: rule.id,
      });
    }
  });
  return out;
}
async function fetchNotifications() {
  const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(n => ({ id: n.id, userId: n.user_id, type: n.type, message: n.message, eventId: n.event_id, requestId: n.request_id, read: n.read, timestamp: new Date(n.created_at).getTime() }));
}
async function fetchJoinRequests() {
  const { data, error } = await supabase.from("join_requests").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(r => ({ id: r.id, fromUserId: r.from_user_id, toUserId: r.to_user_id, conflictEventId: r.conflict_event_id, draftEventId: r.draft_event_id, message: r.message, status: r.status }));
}
async function fetchAuditLog() {
  const { data, error } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) return []; // non-admins get an RLS error here — that's expected, just show nothing
  return (data || []).map(a => ({ id: a.id, actorId: a.actor_id, action: a.action, details: a.details, timestamp: new Date(a.created_at).getTime() }));
}
async function fetchAppSettings() {
  const { data, error } = await supabase.from("app_settings").select("*").eq("id", "default").maybeSingle();
  if (error || !data) return null;
  return data;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const [profiles, setProfiles] = useState([]);
  const [events, setEvents] = useState([]);
  const [recurringBlocks, setRecurringBlocks] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [bufferMinutes, setBufferMinutesState] = useState(120);
  const loggedLoginRef = useRef(false);

  const [view, setView] = useState("calendar");
  const [calView, setCalView] = useState("week"); // day | week | month | year
  const [anchorDate, setAnchorDate] = useState(startOfWeek(new Date()));
  const [filterUserIds, setFilterUserIds] = useState(null);
  const [showNewEvent, setShowNewEvent] = useState(null);
  const [showEditEvent, setShowEditEvent] = useState(null);
  const [showJoinReq, setShowJoinReq] = useState(null);
  const [showRecurring, setShowRecurring] = useState(false);

  const [notifPermission, setNotifPermission] = useState(
    typeof window !== "undefined" && typeof window.Notification !== "undefined" ? window.Notification.permission : "unsupported"
  );
  const seenNotifIds = useRef(null);
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    function onBeforeInstall(e) { e.preventDefault(); setInstallPrompt(e); }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);
  async function triggerInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const [, forceRerenderOnResize] = useState(0);
  useEffect(() => {
    function onResize() {
      const next = window.innerWidth <= 700;
      if (next !== IS_MOBILE) { IS_MOBILE = next; forceRerenderOnResize(n => n + 1); }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  applyTheme(profile?.theme || "dark");

  // ---------- auth bootstrap ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setBooting(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
      setSession(sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- load own profile whenever session changes ----------
  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!session) { setProfile(null); return; }
      for (let i = 0; i < 6; i++) {
        const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
        if (!cancelled && data) { setProfile(data); return; }
        await new Promise(r => setTimeout(r, 500));
      }
    }
    loadProfile();
    return () => { cancelled = true; };
  }, [session]);

  const refreshAll = useCallback(async () => {
    try {
      const isAdmin = profile?.role === "admin";
      const [p, e, n, j, a, rb, settings] = await Promise.all([
        fetchProfiles(), fetchEvents(isAdmin), fetchNotifications(), fetchJoinRequests(),
        isAdmin ? fetchAuditLog() : Promise.resolve([]), fetchRecurringBlocks(isAdmin), fetchAppSettings(),
      ]);
      const windowStart = toISODate(addDays(new Date(), -30));
      const windowEnd = toISODate(addDays(new Date(), 400));
      const virtualEvents = expandRecurringBlocks(rb, windowStart, windowEnd);
      setProfiles(p); setEvents([...e, ...virtualEvents]); setRecurringBlocks(rb);
      setNotifications(n); setJoinRequests(j); setAuditLog(a);
      if (settings) setBufferMinutesState(settings.buffer_minutes);
    } catch (err) { console.error("Błąd wczytywania danych", err); }
  }, [profile?.role]);

  // ---------- load data + realtime once approved profile is ready ----------
  useEffect(() => {
    if (!profile || !profile.approved) return;
    refreshAll();
    const channel = supabase
      .channel("grafik-zespolu-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_participants" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "join_requests" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_log" }, refreshAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "recurring_blocks" }, refreshAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile, refreshAll]);

  // ---------- native browser notifications for new items addressed to me ----------
  useEffect(() => {
    if (!profile) { seenNotifIds.current = null; return; }
    const mine = notifications.filter(n => n.userId === profile.id);
    if (seenNotifIds.current === null) { seenNotifIds.current = new Set(mine.map(n => n.id)); return; }
    mine.forEach(n => {
      if (!seenNotifIds.current.has(n.id)) {
        seenNotifIds.current.add(n.id);
        if (notifPermission === "granted" && typeof window !== "undefined" && typeof window.Notification !== "undefined") {
          try { new window.Notification("Grafik zespołu", { body: n.message, tag: n.id, icon: "/icons/icon-192.png" }); } catch (e) {}
        }
      }
    });
  }, [notifications, profile, notifPermission]);

  async function requestNotifPermission() {
    if (typeof window === "undefined" || typeof window.Notification === "undefined") { setNotifPermission("unsupported"); return; }
    try {
      const perm = await window.Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === "granted") await subscribeToPush();
    } catch (e) { setNotifPermission("denied"); }
  }

  async function subscribeToPush() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!vapidKey) { console.warn("Brak VITE_VAPID_PUBLIC_KEY — prawdziwe powiadomienia push są wyłączone (działają tylko powiadomienia w otwartej karcie)."); return; }
    if (!profile) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      const json = sub.toJSON();
      await supabase.from("push_subscriptions").upsert(
        { user_id: profile.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: "endpoint" }
      );
    } catch (e) { console.warn("Rejestracja subskrypcji push nie powiodła się", e); }
  }
  const pushSubscribedRef = useRef(false);
  useEffect(() => {
    if (profile && profile.approved && notifPermission === "granted" && !pushSubscribedRef.current) {
      pushSubscribedRef.current = true;
      subscribeToPush();
    }
    if (!profile) pushSubscribedRef.current = false;
  }, [profile, notifPermission]); // eslint-disable-line

  function isUserBusy(userId, date, start, end, excludeEventId) {
    return events.some(ev => {
      if (ev.id === excludeEventId || ev.date !== date) return false;
      const p = ev.participants.find(p => p.userId === userId && p.status !== "declined");
      if (!p) return false;
      return overlapsWithBuffer(start, end, ev.start, ev.end, bufferMinutes);
    });
  }
  function conflictEventFor(userId, date, start, end, excludeEventId) {
    return events.find(ev => {
      if (ev.id === excludeEventId || ev.date !== date) return false;
      const p = ev.participants.find(p => p.userId === userId && p.status !== "declined");
      if (!p) return false;
      return overlapsWithBuffer(start, end, ev.start, ev.end, bufferMinutes);
    });
  }

  async function pushNotification(userId, type, message, extra) {
    await supabase.from("notifications").insert({ user_id: userId, type, message, event_id: extra?.eventId || null, request_id: extra?.requestId || null });
  }
  // Gdy ktoś tworzy sobie termin/niedostępność, która koliduje z terminem, w którym
  // już (jako uczestnik, nie właściciel) bierze udział — informujemy właściciela TEGO
  // drugiego terminu, że pojawiła się kolizja i dana osoba może być niedostępna.
  async function notifyConflictOwners(userId, date, start, end, excludeEventId, newTitle) {
    const conflicts = events.filter(ev => {
      if (ev.id === excludeEventId || ev.date !== date || ev.ownerId === userId || ev.ownerId === profile.id) return false;
      const p = ev.participants && ev.participants.find(pp => pp.userId === userId && pp.status !== "declined");
      if (!p) return false;
      return overlaps(start, end, ev.start, ev.end);
    });
    const seenOwners = new Set();
    for (const c of conflicts) {
      if (seenOwners.has(c.ownerId)) continue;
      seenOwners.add(c.ownerId);
      await pushNotification(c.ownerId, "info", `Uwaga: ${userName(userId, profiles)} dodał(a) sobie „${newTitle}” (${date} ${start}–${end}), co koliduje z Twoim terminem „${c.title || "(bez tytułu)"}” — może być niedostępny/a.`);
    }
  }
  async function logAction(action, details) {
    try { await supabase.from("audit_log").insert({ actor_id: profile.id, action, details: details || null }); } catch (e) { /* ignore */ }
  }

  // log a "login" entry once per session, after the profile is approved and ready
  useEffect(() => {
    if (profile && profile.approved && !loggedLoginRef.current) {
      loggedLoginRef.current = true;
      supabase.from("audit_log").insert({ actor_id: profile.id, action: "login", details: `${profile.name} zalogował(a) się.` }).then(() => {});
    }
    if (!profile) loggedLoginRef.current = false;
  }, [profile]);

  // ---------- mutations ----------
  async function createEvent(form) {
    const isAllDay = form.allDay;
    const startTime = isAllDay ? "00:00" : form.start;
    const endTime = isAllDay ? "23:59" : form.end;
    const { data: ev, error } = await supabase.from("events").insert({
      title: form.title, date: form.date, start_time: startTime, end_time: endTime, all_day: isAllDay,
      location: form.location, notes: form.notes, type: form.type, owner_id: profile.id,
    }).select().single();
    if (error) { console.error(error); return; }

    const participantRows = [{ event_id: ev.id, user_id: profile.id, status: "accepted" }];
    if (form.type === "work") {
      (form.participantIds || []).forEach(pid => { if (pid !== profile.id) participantRows.push({ event_id: ev.id, user_id: pid, status: "pending" }); });
    }
    await supabase.from("event_participants").insert(participantRows);

    if (form.type === "work") {
      for (const pid of (form.participantIds || [])) {
        if (pid === profile.id) continue;
        await pushNotification(pid, "invite", `${profile.name} zaprasza Cię do wspólnej pracy „${form.title}” — ${form.date} ${form.start}–${form.end}${form.location ? " @ " + form.location : ""}.`, { eventId: ev.id });
      }
      for (const uid of (form.pendingJoinUserIds || [])) {
        const conflict = conflictEventFor(uid, form.date, form.start, form.end, null);
        const { data: jr } = await supabase.from("join_requests").insert({
          from_user_id: profile.id, to_user_id: uid, conflict_event_id: conflict ? conflict.id : null,
          draft_event_id: ev.id, message: form.joinMessage || "",
        }).select().single();
        await pushNotification(uid, "join_request", buildJoinRequestText(profile.name, conflict, { ...ev, start: form.start, end: form.end }, form.joinMessage), { requestId: jr.id });
      }
    }
    await logAction("event_created", `${profile.name} utworzył(a) termin „${form.title}” (${form.date} ${isAllDay ? "cały dzień" : `${startTime}–${endTime}`}).`);
    await notifyConflictOwners(profile.id, form.date, startTime, endTime, ev.id, form.title);
    setShowNewEvent(null);
    refreshAll();
  }

  // "Urlop / kilka dni": tworzy niedostępność (blok) na każdy dzień w podanym zakresie dat
  // "Seria dat": dowolny, niekoniecznie ciągły zestaw dni (np. urlop, zlecenie na kilka
  // rozstrzelonych dni, albo wspólna praca powtarzająca się przez kilka tygodni).
  // Działa dla obu rodzajów terminu — "Moja niedostępność" i "Wspólna praca".
  // Każdy wpis w serii (form.entries) ma WŁASNĄ datę, godziny i (dla wspólnej pracy)
  // własną załogę — to samo zadanie może wystąpić kilka razy z inną ekipą i w innych
  // godzinach za każdym razem.
  async function createEventSeries(form) {
    const entries = form.entries || [];
    if (entries.length === 0) return { ok: false, error: "Dodaj co najmniej jeden dzień." };

    const seriesId = crypto.randomUUID ? crypto.randomUUID() : genId("series");
    const rows = entries.map(e => ({
      title: form.title || (form.type === "block" ? "Niedostępny/a" : ""), date: e.date,
      start_time: e.allDay ? "00:00" : e.start, end_time: e.allDay ? "23:59" : e.end, all_day: e.allDay,
      location: form.type === "work" ? (form.location || null) : null, notes: form.notes || null, type: form.type, owner_id: profile.id,
      series_id: seriesId,
    }));
    const { data: inserted, error } = await supabase.from("events").insert(rows).select();
    if (error) { console.error(error); return { ok: false, error: error.message }; }

    const participantRows = inserted.map(ev => ({ event_id: ev.id, user_id: profile.id, status: "accepted" }));
    let pendingApproval = 0;
    const pendingDetails = [];
    if (form.type === "work") {
      for (let idx = 0; idx < inserted.length; idx++) {
        const ev = inserted[idx];
        const entry = entries[idx];
        for (const pid of (entry.participantIds || [])) {
          if (pid === profile.id) continue;
          const busy = isUserBusy(pid, ev.date, ev.start_time, ev.end_time, null);
          if (busy) {
            // zajęty tego dnia — wysyłamy zapytanie o akceptację zamiast ciche pomijać
            const conflict = conflictEventFor(pid, ev.date, ev.start_time, ev.end_time, null);
            const { data: jr } = await supabase.from("join_requests").insert({
              from_user_id: profile.id, to_user_id: pid, conflict_event_id: conflict ? conflict.id : null,
              draft_event_id: ev.id, message: form.joinMessage || "",
            }).select().single();
            await pushNotification(pid, "join_request", buildJoinRequestText(profile.name, conflict, { ...ev, start: ev.start_time, end: ev.end_time, location: form.location }, form.joinMessage), { requestId: jr.id });
            pendingApproval++;
            pendingDetails.push({ date: ev.date, name: profiles.find(p => p.id === pid)?.name || "?" });
          } else {
            participantRows.push({ event_id: ev.id, user_id: pid, status: "pending" });
            await pushNotification(pid, "invite", `${profile.name} zaprasza Cię do wspólnej pracy „${ev.title}” — ${ev.date} ${ev.all_day ? "cały dzień" : `${ev.start_time}–${ev.end_time}`}${form.location ? " @ " + form.location : ""}.`, { eventId: ev.id });
          }
        }
      }
    }
    if (participantRows.length) await supabase.from("event_participants").insert(participantRows);

    for (const ev of inserted) {
      await notifyConflictOwners(profile.id, ev.date, ev.start_time, ev.end_time, ev.id, ev.title);
    }

    await logAction("event_created", `${profile.name} dodał(a) serię terminów „${form.title || (form.type === "block" ? "Niedostępny/a" : "")}” na ${entries.length} dni.`);
    refreshAll();
    return { ok: true, count: entries.length, skipped: pendingApproval, pendingDetails };
  }

  async function createRecurringBlock(form) {
    const isAllDay = form.allDay;
    const { error } = await supabase.from("recurring_blocks").insert({
      user_id: profile.id, label: form.label || "Niedostępny/a", weekdays: form.weekdays,
      all_day: isAllDay, start_time: isAllDay ? null : form.start, end_time: isAllDay ? null : form.end,
      date_from: form.dateFrom, date_until: form.dateUntil || null,
    });
    if (error) { console.error(error); return; }
    await logAction("recurring_created", `${profile.name} dodał(a) cykliczną niedostępność „${form.label || "Niedostępny/a"}”.`);
    setShowRecurring(false);
    refreshAll();
  }
  async function deleteRecurringBlock(rule) {
    await supabase.from("recurring_blocks").delete().eq("id", rule.id);
    await logAction("recurring_deleted", `${profile.name} usunął(-ęła) cykliczną niedostępność${rule.label ? ` „${rule.label}”` : ""}.`);
    refreshAll();
  }
  // Usuwanie wystąpienia/wystąpień z reguły cyklicznej z wyborem zakresu:
  // "this" = tylko ten dzień (wyjątek), "future" = ten i przyszłe (skraca regułę),
  // "past" = ten i poprzednie (przesuwa początek reguły), "all" = cała reguła.
  async function deleteRecurringOccurrence(ruleId, occurrenceDate, scope) {
    const rule = recurringBlocks.find(r => r.id === ruleId);
    if (!rule) return;
    if (scope === "all") {
      await supabase.from("recurring_blocks").delete().eq("id", ruleId);
    } else if (scope === "this") {
      const next = [...new Set([...(rule.exceptionDates || []), occurrenceDate])];
      await supabase.from("recurring_blocks").update({ exception_dates: next }).eq("id", ruleId);
    } else if (scope === "future") {
      const dayBefore = toISODate(addDays(new Date(occurrenceDate), -1));
      await supabase.from("recurring_blocks").update({ date_until: dayBefore }).eq("id", ruleId);
    } else if (scope === "past") {
      await supabase.from("recurring_blocks").update({ date_from: occurrenceDate }).eq("id", ruleId);
    }
    await logAction("recurring_deleted", `${profile.name} usunął(-ęła) wystąpienia (${scope}) reguły${rule.label ? ` „${rule.label}”` : ""} od ${occurrenceDate}.`);
    refreshAll();
  }
  // Edycja reguły cyklicznej: "this" nadpisuje tylko jeden dzień (wyjątek + zwykły
  // pojedynczy termin na to miejsce), "future" dzieli regułę na dwie (stara kończy się
  // dzień wcześniej, nowa z edytowanymi danymi startuje od tego dnia), "all" nadpisuje
  // całą regułę.
  async function editRecurringOccurrence(ruleId, occurrenceDate, scope, fields) {
    const rule = recurringBlocks.find(r => r.id === ruleId);
    if (!rule) return;
    if (scope === "this") {
      const next = [...new Set([...(rule.exceptionDates || []), occurrenceDate])];
      await supabase.from("recurring_blocks").update({ exception_dates: next }).eq("id", ruleId);
      const isAllDay = fields.allDay;
      const { data: ev } = await supabase.from("events").insert({
        title: fields.label || rule.label || "Niedostępny/a", date: occurrenceDate,
        start_time: isAllDay ? "00:00" : fields.start, end_time: isAllDay ? "23:59" : fields.end, all_day: isAllDay,
        type: "block", owner_id: rule.userId,
      }).select().single();
      if (ev) await supabase.from("event_participants").insert({ event_id: ev.id, user_id: rule.userId, status: "accepted" });
    } else if (scope === "future") {
      const dayBefore = toISODate(addDays(new Date(occurrenceDate), -1));
      await supabase.from("recurring_blocks").update({ date_until: dayBefore }).eq("id", ruleId);
      await supabase.from("recurring_blocks").insert({
        user_id: rule.userId, label: fields.label || rule.label, weekdays: rule.weekdays,
        all_day: fields.allDay, start_time: fields.allDay ? null : fields.start, end_time: fields.allDay ? null : fields.end,
        date_from: occurrenceDate, date_until: rule.dateUntil || null,
      });
    } else {
      await supabase.from("recurring_blocks").update({
        label: fields.label || rule.label, all_day: fields.allDay,
        start_time: fields.allDay ? null : fields.start, end_time: fields.allDay ? null : fields.end,
      }).eq("id", ruleId);
    }
    await logAction("recurring_created", `${profile.name} zmodyfikował(a) (${scope}) regułę cykliczną${rule.label ? ` „${rule.label}”` : ""} od ${occurrenceDate}.`);
    refreshAll();
  }

  async function updateEvent(updated) {
    const isAllDay = updated.allDay;
    const startTime = isAllDay ? "00:00" : updated.start;
    const endTime = isAllDay ? "23:59" : updated.end;
    await supabase.from("events").update({
      title: updated.title, date: updated.date, start_time: startTime, end_time: endTime, all_day: isAllDay,
      location: updated.location, notes: updated.notes, type: updated.type,
    }).eq("id", updated.id);
    await logAction("event_updated", `${profile.name} zmodyfikował(a) termin „${updated.title}” (${updated.date} ${isAllDay ? "cały dzień" : `${startTime}–${endTime}`}).`);
    setShowEditEvent(null);
    refreshAll();
  }

  async function deleteEvent(ev) {
    if (ev.type === "work" && ev.participants) {
      const others = ev.participants.filter(p => p.userId !== profile.id && p.status !== "declined");
      for (const p of others) {
        await pushNotification(p.userId, "event_cancelled", `${profile.name} odwołał(a) termin „${ev.title || "(bez tytułu)"}” (${ev.date} ${ev.allDay ? "cały dzień" : `${ev.start}–${ev.end}`}).`, { eventId: ev.id });
      }
    }
    await supabase.from("events").delete().eq("id", ev.id);
    await logAction("event_deleted", `${profile.name} usunął(usunęła) termin „${ev.title || "(bez tytułu)"}” (${ev.date} ${ev.start}–${ev.end}).`);
    setShowEditEvent(null);
    refreshAll();
  }

  // Grupowe usuwanie terminów z tej samej "serii dat": ten dzień / ten i przyszłe /
  // poprzednie / wszystkie — liczone względem daty terminu, z którego wywołano akcję.
  async function deleteEventSeries(ev, scope) {
    const members = events.filter(e => e.seriesId && e.seriesId === ev.seriesId && e.detailed);
    let targets;
    if (scope === "this") targets = [ev];
    else if (scope === "future") targets = members.filter(e => e.date >= ev.date);
    else if (scope === "past") targets = members.filter(e => e.date <= ev.date);
    else targets = members; // all
    for (const t of targets) {
      if (t.type === "work" && t.participants) {
        const others = t.participants.filter(p => p.userId !== profile.id && p.status !== "declined");
        for (const p of others) {
          await pushNotification(p.userId, "event_cancelled", `${profile.name} odwołał(a) termin „${t.title || "(bez tytułu)"}” (${t.date} ${t.allDay ? "cały dzień" : `${t.start}–${t.end}`}).`, { eventId: t.id });
        }
      }
    }
    await supabase.from("events").delete().in("id", targets.map(t => t.id));
    await logAction("event_deleted", `${profile.name} usunął(-ęła) ${targets.length} termin(ów) z serii „${ev.title || "(bez tytułu)"}” (zakres: ${scope}).`);
    setShowEditEvent(null);
    refreshAll();
  }

  async function inviteToExistingEvent(ev, userId) {
    await supabase.from("event_participants").upsert({ event_id: ev.id, user_id: userId, status: "pending" });
    await pushNotification(userId, "invite", `${profile.name} zaprasza Cię do wspólnej pracy „${ev.title}” — ${ev.date} ${ev.start}–${ev.end}${ev.location ? " @ " + ev.location : ""}.`, { eventId: ev.id });
    await logAction("invite_sent", `${profile.name} zaprosił(a) ${userName(userId, profiles)} do „${ev.title}”.`);
    refreshAll();
  }

  // Admin/właściciel może usunąć KOGOKOLWIEK z terminu, niezależnie od statusu
  // (np. ktoś dodany omyłkowo, albo omyłkowo zaakceptował) — i od razu dodać kogoś innego.
  async function removeParticipant(ev, userId) {
    await supabase.from("event_participants").delete().eq("event_id", ev.id).eq("user_id", userId);
    await pushNotification(userId, "event_cancelled", `${profile.name} usunął(-ęła) Cię z terminu „${ev.title}” (${ev.date} ${ev.allDay ? "cały dzień" : `${ev.start}–${ev.end}`}).`, { eventId: ev.id });
    await logAction("participant_removed", `${profile.name} usunął(-ęła) ${userName(userId, profiles)} z „${ev.title}”.`);
    refreshAll();
  }

  async function respondToInvite(notif, accept) {
    await supabase.from("event_participants").update({ status: accept ? "accepted" : "declined" }).eq("event_id", notif.eventId).eq("user_id", profile.id);
    const ev = events.find(e => e.id === notif.eventId);
    if (ev) await pushNotification(ev.ownerId, "invite_response", `${profile.name} ${accept ? "zaakceptował(a)" : "odrzucił(a)"} zaproszenie do „${ev.title}” (${ev.date} ${ev.start}–${ev.end}).`);
    await logAction(accept ? "invite_accepted" : "invite_declined", `${profile.name} ${accept ? "zaakceptował(a)" : "odrzucił(a)"} zaproszenie${ev ? ` do „${ev.title}”` : ""}.`);
    await supabase.from("notifications").delete().eq("id", notif.id);
    refreshAll();
  }

  async function sendJoinRequest({ busyUserId, conflictEvent, draftEvent, message }) {
    const { data: jr } = await supabase.from("join_requests").insert({
      from_user_id: profile.id, to_user_id: busyUserId, conflict_event_id: conflictEvent ? conflictEvent.id : null,
      draft_event_id: draftEvent.id, message,
    }).select().single();
    await pushNotification(busyUserId, "join_request", buildJoinRequestText(profile.name, conflictEvent, draftEvent, message), { requestId: jr.id });
    await logAction("join_request_sent", `${profile.name} poprosił(a) ${userName(busyUserId, profiles)} o zmianę terminu.`);
    setShowJoinReq(null);
    refreshAll();
  }

  async function respondToJoinRequest(notif, accept) {
    const jr = joinRequests.find(r => r.id === notif.requestId);
    if (!jr) { await supabase.from("notifications").delete().eq("id", notif.id); refreshAll(); return; }
    if (accept) {
      if (jr.conflictEventId) {
        await supabase.from("event_participants").update({ status: "declined" }).eq("event_id", jr.conflictEventId).eq("user_id", profile.id);
      }
      await supabase.from("event_participants").upsert({ event_id: jr.draftEventId, user_id: profile.id, status: "accepted" });
    }
    await supabase.from("join_requests").update({ status: accept ? "accepted" : "declined" }).eq("id", jr.id);
    await pushNotification(jr.fromUserId, "join_response", `${profile.name} ${accept ? "zaakceptował(a) i dołączył(a) do" : "odrzucił(a)"} prośbę o zmianę terminu.`);
    await logAction(accept ? "join_request_accepted" : "join_request_declined", `${profile.name} ${accept ? "zaakceptował(a) prośbę o zmianę terminu i dołączył(a)" : "odrzucił(a) prośbę o zmianę terminu"} (od ${userName(jr.fromUserId, profiles)}).`);
    await supabase.from("notifications").delete().eq("id", notif.id);
    refreshAll();
  }

  async function markRead(id) { await supabase.from("notifications").update({ read: true }).eq("id", id); refreshAll(); }
  async function dismissNotification(id) { await supabase.from("notifications").delete().eq("id", id); refreshAll(); }

  async function updateOwnProfile(fields) {
    const { name, color, theme } = fields;
    await supabase.from("profiles").update({ name, color, theme }).eq("id", profile.id);
    if (fields.name || fields.color) await logAction("profile_updated", `${profile.name} zaktualizował(a) swój profil.`);
    setProfile(p => ({ ...p, ...fields }));
  }
  async function changePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) await logAction("password_changed", `${profile.name} zmienił(a) hasło.`);
    return error ? error.message : null;
  }

  async function adminSetApproved(userId, approved) {
    await supabase.from("profiles").update({ approved }).eq("id", userId);
    await logAction(approved ? "user_approved" : "user_blocked", `${profile.name} ${approved ? "zatwierdził(a)" : "zablokował(a)"} konto ${userName(userId, profiles)}.`);
    refreshAll();
  }
  async function adminSetRole(userId, role) {
    await supabase.from("profiles").update({ role }).eq("id", userId);
    await logAction("role_changed", `${profile.name} zmienił(a) rolę ${userName(userId, profiles)} na "${role}".`);
    refreshAll();
  }
  async function adminSendPasswordReset(email) {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  }
  async function adminSetBufferMinutes(minutes) {
    await supabase.from("app_settings").update({ buffer_minutes: minutes, updated_at: new Date().toISOString() }).eq("id", "default");
    setBufferMinutesState(minutes);
    await logAction("buffer_updated", `${profile.name} ustawił(a) bufor czasowy między zadaniami na ${minutes} min.`);
  }

  // ---------- kopia zapasowa ----------
  async function exportBackup() {
    const [ev, ep, rb] = await Promise.all([
      supabase.from("events").select("*"),
      supabase.from("event_participants").select("*"),
      supabase.from("recurring_blocks").select("*"),
    ]);
    const payload = {
      version: 1, exportedAt: new Date().toISOString(), exportedBy: profile.name,
      events: ev.data || [], event_participants: ep.data || [], recurring_blocks: rb.data || [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `grafik-kopia-zapasowa-${toISODate(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    await logAction("backup_exported", `${profile.name} wyeksportował(a) kopię zapasową (${payload.events.length} terminów).`);
  }
  async function importBackup(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "To nie jest poprawny plik JSON." }; }
    try {
      if (data.events?.length) { const { error } = await supabase.from("events").upsert(data.events, { onConflict: "id" }); if (error) throw error; }
      if (data.event_participants?.length) { const { error } = await supabase.from("event_participants").upsert(data.event_participants, { onConflict: "event_id,user_id" }); if (error) throw error; }
      if (data.recurring_blocks?.length) { const { error } = await supabase.from("recurring_blocks").upsert(data.recurring_blocks, { onConflict: "id" }); if (error) throw error; }
    } catch (e) { return { ok: false, error: e.message }; }
    await logAction("backup_imported", `${profile.name} zaimportował(a) kopię zapasową (${data.events?.length || 0} terminów).`);
    refreshAll();
    return { ok: true, count: data.events?.length || 0 };
  }

  // ---------- alert wykorzystania kalendarza (>35%) ----------
  const capacityAlertRef = useRef(false);
  useEffect(() => {
    if (!profile || profile.role !== "admin" || events.length === 0 || profiles.length === 0) return;
    const pct = computeCapacityPct(events, profiles, 30, 8);
    if (pct === null) return;
    if (pct > 35 && !capacityAlertRef.current) {
      const recentAlert = notifications.find(n => n.userId === profile.id && n.type === "capacity_alert" && (Date.now() - n.timestamp) < 20 * 60 * 60 * 1000);
      if (!recentAlert) {
        pushNotification(profile.id, "capacity_alert", `Kalendarz zespołu jest wypełniony w ${pct.toFixed(0)}% w najbliższych 30 dniach (próg ostrzegawczy: 35%). Sprawdź obciążenie w Panelu admina.`);
      }
      capacityAlertRef.current = true;
    } else if (pct <= 35) {
      capacityAlertRef.current = false;
    }
  }, [events, profiles, profile]); // eslint-disable-line
  const myNotifs = profile ? notifications.filter(n => n.userId === profile.id).sort((a, b) => b.timestamp - a.timestamp) : [];
  const unreadCount = myNotifs.filter(n => !n.read).length;
  const pendingCount = profiles.filter(p => !p.approved).length;

  // ---------- render branches ----------
  if (booting) return <CenteredMessage text="Wczytywanie…" />;

  if (recoveryMode) return <SetNewPasswordScreen onDone={() => setRecoveryMode(false)} />;

  if (!session) return <AuthScreen />;

  if (!profile) return <CenteredMessage text="Przygotowywanie konta…" />;

  if (!profile.approved) return <PendingApprovalScreen profile={profile} onLogout={() => supabase.auth.signOut()} />;

  return (
    <div style={{ background: COLORS.bg, minHeight: 600, color: COLORS.text, fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{GLOBAL_STYLE}</style>
      <TopNav
        profile={profile} view={view} setView={setView} unreadCount={unreadCount} pendingCount={pendingCount}
        onLogout={() => supabase.auth.signOut()}
        onToggleTheme={() => updateOwnProfile({ theme: profile.theme === "light" ? "dark" : "light" })}
        notifPermission={notifPermission} onRequestNotifPermission={requestNotifPermission}
        canInstall={!!installPrompt} onInstall={triggerInstall}
      />
      <div style={{ flex: 1, padding: "16px 20px 28px" }}>
        {view === "calendar" && (
          <CalendarView
            profiles={profiles} events={events} profile={profile}
            calView={calView} setCalView={setCalView} anchorDate={anchorDate} setAnchorDate={setAnchorDate}
            filterUserIds={filterUserIds} setFilterUserIds={setFilterUserIds}
            onNewEvent={(date) => setShowNewEvent({ date })}
            onEditEvent={(ev) => setShowEditEvent(ev)}
            onOpenRecurring={() => setShowRecurring(true)}
          />
        )}
        {view === "notifications" && (
          <NotificationsView
            notifs={myNotifs} profiles={profiles}
            onAcceptInvite={(n) => respondToInvite(n, true)} onDeclineInvite={(n) => respondToInvite(n, false)}
            onAcceptJoin={(n) => respondToJoinRequest(n, true)} onDeclineJoin={(n) => respondToJoinRequest(n, false)}
            onMarkRead={markRead} onDismiss={dismissNotification}
          />
        )}
        {view === "profile" && <ProfileView profile={profile} onUpdate={updateOwnProfile} onChangePassword={changePassword} />}
        {view === "admin" && profile.role === "admin" && (
          <AdminPanel
            profiles={profiles} events={events} auditLog={auditLog}
            onSetApproved={adminSetApproved} onSetRole={adminSetRole}
            onSendPasswordReset={adminSendPasswordReset}
            onDeleteEvent={deleteEvent} onEditEvent={(ev) => setShowEditEvent(ev)}
            bufferMinutes={bufferMinutes} onSetBufferMinutes={adminSetBufferMinutes}
            onExportBackup={exportBackup} onImportBackup={importBackup}
          />
        )}
      </div>

      {showNewEvent && (
        <EventModal mode="new" profiles={profiles} profile={profile} defaultDate={showNewEvent.date}
          onClose={() => setShowNewEvent(null)} isUserBusy={isUserBusy} conflictEventFor={conflictEventFor}
          onSubmit={createEvent} onSubmitSeries={createEventSeries} />
      )}
      {showEditEvent && (
        <EventModal mode="edit" profiles={profiles} profile={profile} existing={showEditEvent}
          onClose={() => setShowEditEvent(null)} isUserBusy={isUserBusy} conflictEventFor={conflictEventFor}
          onSubmit={updateEvent} onDelete={deleteEvent} onInviteUser={inviteToExistingEvent} onRemoveParticipant={removeParticipant}
          onDeleteRecurring={deleteRecurringBlock} onDeleteRecurringOccurrence={deleteRecurringOccurrence} onEditRecurringOccurrence={editRecurringOccurrence}
          onDeleteSeries={deleteEventSeries}
          onRequestJoin={(busyUserId, conflictEvent, draftEvent) => setShowJoinReq({ busyUserId, conflictEvent, draftEvent })} />
      )}
      {showJoinReq && <JoinRequestModal profiles={profiles} data={showJoinReq} onClose={() => setShowJoinReq(null)} onSend={sendJoinRequest} />}
      {showRecurring && (
        <RecurringBlockModal profile={profile} recurringBlocks={recurringBlocks}
          onClose={() => setShowRecurring(false)} onCreate={createRecurringBlock} onDelete={deleteRecurringBlock} />
      )}
    </div>
  );
}

function CenteredMessage({ text }) {
  return (
    <div style={{ background: COLORS.bg, minHeight: 520, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontFamily: "Inter, sans-serif" }}>
      <style>{GLOBAL_STYLE}</style>
      <Loader2 className="animate-spin" size={22} style={{ marginRight: 8 }} /> {text}
    </div>
  );
}

// ================= AUTH =================
function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setMsg(""); setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) setMsg(error.message);
      } else if (mode === "signup") {
        if (!name.trim()) { setMsg("Podaj swoje imię i nazwisko."); setBusy(false); return; }
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { name: name.trim() } } });
        if (error) setMsg(error.message);
        else setMsg("Konto utworzone. Sprawdź e-mail, aby potwierdzić adres, a potem zaloguj się.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) setMsg(error.message);
        else setMsg("Jeśli to konto istnieje, wysłaliśmy link do zmiany hasła na podany e-mail.");
      }
    } finally { setBusy(false); }
  }

  return (
    <div style={{ background: COLORS.bg, minHeight: 560, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", padding: 24 }}>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ width: 360, background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 14, padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center" }}><CalIcon size={19} color="#12141C" /></div>
          <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 19 }}>Grafik zespołu</div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <ModeTab active={mode === "login"} onClick={() => { setMode("login"); setMsg(""); }}>Logowanie</ModeTab>
          <ModeTab active={mode === "signup"} onClick={() => { setMode("signup"); setMsg(""); }}>Rejestracja</ModeTab>
        </div>

        {mode === "signup" && (
          <LabeledInput label="Imię i nazwisko" value={name} onChange={setName} placeholder="Jan Kowalski" />
        )}
        <LabeledInput label="Email" value={email} onChange={setEmail} type="email" placeholder="jan@firma.pl" />
        {mode !== "forgot" && (
          <LabeledInput label="Hasło" value={password} onChange={setPassword} type="password" placeholder="min. 6 znaków" />
        )}

        {msg && <div style={{ fontSize: 12, color: COLORS.amber, marginTop: 8, lineHeight: 1.5 }}>{msg}</div>}

        <button onClick={submit} disabled={busy} style={{ width: "100%", marginTop: 14, padding: "10px 12px", borderRadius: 10, border: "none", background: COLORS.amber, color: "#12141C", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>
          {busy ? "Chwila…" : mode === "login" ? "Zaloguj" : mode === "signup" ? "Utwórz konto" : "Wyślij link do resetu hasła"}
        </button>

        {mode === "login" && (
          <button onClick={() => { setMode("forgot"); setMsg(""); }} style={{ marginTop: 10, background: "none", border: "none", color: COLORS.textMuted, fontSize: 12, cursor: "pointer" }}>
            Nie pamiętam hasła
          </button>
        )}
        {mode === "forgot" && (
          <button onClick={() => { setMode("login"); setMsg(""); }} style={{ marginTop: 10, background: "none", border: "none", color: COLORS.textMuted, fontSize: 12, cursor: "pointer" }}>
            ← Wróć do logowania
          </button>
        )}
        {mode === "signup" && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: COLORS.textMuted, lineHeight: 1.5 }}>
            Pierwsza zarejestrowana osoba w zespole automatycznie zostaje administratorem. Kolejne osoby po rejestracji czekają na zatwierdzenie przez admina.
          </div>
        )}
      </div>
    </div>
  );
}
function ModeTab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ flex: 1, padding: "7px 10px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", border: `1px solid ${active ? COLORS.amber : COLORS.line}`, background: active ? COLORS.amber + "22" : "transparent", color: active ? COLORS.text : COLORS.textMuted }}>{children}</button>
  );
}
function LabeledInput({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4 }}>{label}</div>
      <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: `1px solid ${COLORS.line}`, background: COLORS.bg, color: COLORS.text, fontSize: 13.5, outline: "none", boxSizing: "border-box" }} />
    </div>
  );
}

function SetNewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  async function submit() {
    if (password.length < 6) { setMsg("Hasło musi mieć min. 6 znaków."); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setMsg(error.message);
    else { setMsg("Hasło zmienione."); setTimeout(onDone, 800); }
  }
  return (
    <div style={{ background: COLORS.bg, minHeight: 560, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", padding: 24 }}>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ width: 340, background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 14, padding: 28 }}>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Ustaw nowe hasło</div>
        <LabeledInput label="Nowe hasło" value={password} onChange={setPassword} type="password" placeholder="min. 6 znaków" />
        {msg && <div style={{ fontSize: 12, color: COLORS.amber, marginBottom: 8 }}>{msg}</div>}
        <button onClick={submit} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "none", background: COLORS.amber, color: "#12141C", fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Zapisz hasło</button>
      </div>
    </div>
  );
}

function PendingApprovalScreen({ profile, onLogout }) {
  return (
    <div style={{ background: COLORS.bg, minHeight: 560, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif", padding: 24 }}>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ width: 360, background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 14, padding: 28, textAlign: "center" }}>
        <AlertTriangle size={26} color={COLORS.amber} style={{ marginBottom: 10 }} />
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Konto oczekuje na zatwierdzenie</div>
        <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.6, marginBottom: 16 }}>
          Cześć {profile.name}. Administrator zespołu musi jeszcze zatwierdzić Twoje konto ({profile.email}), zanim zobaczysz kalendarz.
        </div>
        <button onClick={onLogout} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${COLORS.line}`, background: "transparent", color: COLORS.text, fontSize: 13, cursor: "pointer" }}>Wyloguj</button>
      </div>
    </div>
  );
}

// ================= TOP NAV =================
function TopNav({ profile, view, setView, unreadCount, pendingCount, onLogout, onToggleTheme, notifPermission, onRequestNotifPermission, canInstall, onInstall }) {
  const Tab = ({ id, icon: Icon, label, badge }) => (
    <button onClick={() => setView(id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: IS_MOBILE ? "10px 14px" : "8px 12px", borderRadius: 9, background: view === id ? COLORS.panel2 : "transparent", border: "none", color: view === id ? COLORS.text : COLORS.textMuted, cursor: "pointer", fontSize: mfs(13.5), fontWeight: 500, position: "relative", whiteSpace: "nowrap", flexShrink: 0 }}>
      <Icon size={IS_MOBILE ? 19 : 16} /> {label}
      {badge > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: COLORS.rose, color: "#fff", fontSize: 10, borderRadius: 8, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{badge}</span>}
    </button>
  );
  const isLight = profile.theme === "light";
  const iconBtnStyle = (color) => ({ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: `1px solid ${color || COLORS.line}`, background: "transparent", color: color || COLORS.textMuted, cursor: "pointer", flexShrink: 0, position: "relative" });
  return (
    <div style={{ borderBottom: `1px solid ${COLORS.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><CalIcon size={15} color="#12141C" /></div>
        <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 15, whiteSpace: "nowrap" }}>Grafik zespołu</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {canInstall && (
            <button onClick={onInstall} title="Zainstaluj jako aplikację" style={iconBtnStyle(COLORS.teal)}><CalIcon size={14} /></button>
          )}
          {notifPermission !== "granted" && notifPermission !== "unsupported" && (
            <button onClick={onRequestNotifPermission} title="Włącz powiadomienia" style={iconBtnStyle(COLORS.amber)}><Bell size={14} /></button>
          )}
          <button onClick={onToggleTheme} title={isLight ? "Ciemny motyw" : "Jasny motyw"} style={iconBtnStyle()}>{isLight ? <Moon size={14} /> : <Sun size={14} />}</button>
          <span title={profile.name} style={{ width: 9, height: 9, borderRadius: "50%", background: profile.color, flexShrink: 0 }} />
          <button onClick={onLogout} title="Wyloguj" style={iconBtnStyle()}><LogOut size={14} /></button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px 8px", overflowX: "auto" }}>
        <Tab id="calendar" icon={CalIcon} label="Kalendarz" />
        <Tab id="notifications" icon={Bell} label="Powiadomienia" badge={unreadCount} />
        <Tab id="profile" icon={UserIcon} label="Mój profil" />
        {profile.role === "admin" && <Tab id="admin" icon={Settings} label="Panel admina" badge={pendingCount} />}
      </div>
    </div>
  );
}

// ================= CALENDAR =================
function CalendarView({ profiles, events, profile, calView, setCalView, anchorDate, setAnchorDate, filterUserIds, setFilterUserIds, onNewEvent, onEditEvent, onOpenRecurring }) {
  const activeFilter = filterUserIds || profiles.map(u => u.id);

  function nav(dir) {
    if (calView === "day") setAnchorDate(addDays(anchorDate, dir));
    else if (calView === "week") setAnchorDate(addDays(anchorDate, dir * 7));
    else if (calView === "month") setAnchorDate(addMonths(anchorDate, dir));
    else setAnchorDate(addYears(anchorDate, dir));
  }
  function goToday() {
    const t = new Date();
    setAnchorDate(calView === "week" ? startOfWeek(t) : t);
  }
  function goToDay(d) { setAnchorDate(d); setCalView("day"); }

  const eventsForDay = (iso) => events.filter(e => e.date === iso).filter(e => e.participants.some(p => activeFilter.includes(p.userId) && p.status !== "declined")).sort((a, b) => timeToMin(a.start) - timeToMin(b.start));

  let label = "";
  if (calView === "day") label = `${DAY_NAMES[(anchorDate.getDay() + 6) % 7]}, ${anchorDate.getDate()} ${MONTH_NAMES[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`;
  else if (calView === "week") { const ws = startOfWeek(anchorDate); const we = addDays(ws, 6); label = `${ws.getDate()} ${MONTH_NAMES[ws.getMonth()]} – ${we.getDate()} ${MONTH_NAMES[we.getMonth()]} ${we.getFullYear()}`; }
  else if (calView === "month") label = `${MONTH_NAMES[anchorDate.getMonth()][0].toUpperCase()}${MONTH_NAMES[anchorDate.getMonth()].slice(1)} ${anchorDate.getFullYear()}`;
  else label = `${anchorDate.getFullYear()}`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={() => nav(-1)} style={navBtnStyle()}><ChevronLeft size={16} /></button>
        <button onClick={() => nav(1)} style={navBtnStyle()}><ChevronRight size={16} /></button>
        <button onClick={goToday} style={{ ...navBtnStyle(), fontSize: 12, padding: "6px 10px" }}>Dziś</button>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: 15, marginLeft: 4 }}>{label}</div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
        {[["day", "Dzień"], ["week", "Tydzień"], ["month", "Miesiąc"], ["year", "Rok"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setCalView(id)} style={{ padding: "6px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: `1px solid ${calView === id ? COLORS.amber : COLORS.line}`, background: calView === id ? COLORS.amber + "22" : "transparent", color: calView === id ? COLORS.text : COLORS.textMuted, whiteSpace: "nowrap", flexShrink: 0 }}>{lbl}</button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {profiles.map(u => {
            const on = activeFilter.includes(u.id);
            return (
              <button key={u.id} onClick={() => { const next = on ? activeFilter.filter(id => id !== u.id) : [...activeFilter, u.id]; setFilterUserIds(next.length === profiles.length ? null : next); }}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 20, border: `1px solid ${on ? u.color : COLORS.line}`, background: on ? u.color + "22" : "transparent", color: on ? COLORS.text : COLORS.textMuted, fontSize: 11.5, cursor: "pointer" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: u.color }} /> {u.name}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => onNewEvent(toISODate(calView === "day" ? anchorDate : new Date()))} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, border: "none", background: COLORS.amber, color: "#12141C", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            <Plus size={15} /> Nowy termin
          </button>
          <button onClick={onOpenRecurring} title="Cykliczna niedostępność (np. co wtorek/czwartek w godzinach pracy dla innej firmy)" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 9, border: `1px solid ${COLORS.line}`, background: "transparent", color: COLORS.textMuted, fontWeight: 500, fontSize: 12.5, cursor: "pointer" }}>
            <Repeat size={14} /> Cykliczna niedostępność
          </button>
        </div>
      </div>

      {calView === "day" && <DayView day={anchorDate} profiles={profiles} eventsForDay={eventsForDay} onNewEvent={onNewEvent} onEditEvent={onEditEvent} />}
      {calView === "week" && <WeekView weekStart={startOfWeek(anchorDate)} profiles={profiles} eventsForDay={eventsForDay} onNewEvent={onNewEvent} onEditEvent={onEditEvent} />}
      {calView === "month" && <MonthView anchorDate={anchorDate} profiles={profiles} eventsForDay={eventsForDay} onNewEvent={onNewEvent} onDayClick={goToDay} />}
      {calView === "year" && <YearView anchorDate={anchorDate} profiles={profiles} eventsForDay={eventsForDay} onMonthClick={(d) => { setAnchorDate(d); setCalView("month"); }} onDayClick={goToDay} />}
    </div>
  );
}
function navBtnStyle() { return { background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "6px 8px", color: COLORS.text, cursor: "pointer", display: "flex" }; }

function DayView({ day, profiles, eventsForDay, onNewEvent, onEditEvent }) {
  const iso = toISODate(day);
  const dayEvents = eventsForDay(iso);
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8, minHeight: 240 }}>
        {dayEvents.length === 0 && (
          <div style={{ fontSize: 13, color: COLORS.textMuted, textAlign: "center", padding: "30px 0" }}>
            Brak terminów tego dnia.
            <div><button onClick={() => onNewEvent(iso)} style={{ marginTop: 10, ...primaryBtnStyle() }}>Dodaj termin</button></div>
          </div>
        )}
        {dayEvents.map(ev => <EventCard key={ev.id} ev={ev} profiles={profiles} onClick={() => onEditEvent(ev)} />)}
      </div>
    </div>
  );
}

function WeekView({ weekStart, profiles, eventsForDay, onNewEvent, onEditEvent }) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));
  return (
    <div className="week-grid">
      {days.map(day => {
        const iso = toISODate(day);
        const isToday = iso === toISODate(new Date());
        const dayEvents = eventsForDay(iso);
        return (
          <div key={iso} style={{ background: COLORS.panel, border: `1px solid ${isToday ? COLORS.amber : COLORS.line}`, borderRadius: 12, padding: 10, minHeight: 220, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, color: isToday ? COLORS.amber : COLORS.textMuted, fontWeight: 600 }}>{DAY_NAMES[(day.getDay() + 6) % 7]} {day.getDate()}</div>
              <button onClick={() => onNewEvent(iso)} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer" }}><Plus size={13} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              {dayEvents.length === 0 && <div style={{ fontSize: 11, color: COLORS.textMuted, opacity: 0.5, marginTop: 6 }}>—</div>}
              {dayEvents.map(ev => <EventCard key={ev.id} ev={ev} profiles={profiles} onClick={() => onEditEvent(ev)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ anchorDate, profiles, eventsForDay, onNewEvent, onDayClick }) {
  const weeks = monthMatrix(anchorDate);
  const currentMonth = anchorDate.getMonth();
  const todayIso = toISODate(new Date());
  // Na telefonie 7 kolumn wciśniętych w pełną szerokość ekranu robi się nieczytelne
  // (tekst łamie się litera po literze) — zamiast tego kolumny mają stałą, wygodną do
  // czytania szerokość (ok. 3x szersze niż wcześniej), a cała siatka przewija się w bok.
  const colTemplate = IS_MOBILE ? "repeat(7, minmax(128px, 1fr))" : "repeat(7, minmax(0, 1fr))";
  return (
    <div style={{ width: "100%", overflowX: IS_MOBILE ? "auto" : "visible" }}>
      <div style={{ minWidth: IS_MOBILE ? "896px" : "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: colTemplate, gap: 6, marginBottom: 6 }}>
          {DAY_NAMES.map(d => <div key={d} style={{ fontSize: mfs(11), color: COLORS.textMuted, textAlign: "center", fontWeight: 600 }}>{d}</div>)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: colTemplate, gap: 6 }}>
              {week.map(day => {
                const iso = toISODate(day);
                const inMonth = day.getMonth() === currentMonth;
                const isToday = inMonth && iso === todayIso;
              const dayEvents = eventsForDay(iso);
              return (
                <div key={iso} onClick={() => onDayClick(day)} style={{
                  cursor: "pointer", minHeight: 84, minWidth: 0, width: "100%", boxSizing: "border-box", borderRadius: 9, padding: 6, background: inMonth ? COLORS.panel : "transparent",
                  border: `1px solid ${isToday ? COLORS.amber : COLORS.line}`, opacity: inMonth ? 1 : 0.4, display: "flex", flexDirection: "column", overflow: "hidden",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: mfs(11), color: isToday ? COLORS.amber : COLORS.textMuted, fontWeight: isToday ? 700 : 500 }}>{day.getDate()}</span>
                    <button onClick={(e) => { e.stopPropagation(); onNewEvent(iso); }} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", padding: 0, display: "flex" }}><Plus size={11} /></button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4, minWidth: 0 }}>
                    {dayEvents.slice(0, 3).map(ev => {
                      const label = ev.detailed ? (ev.title || "") : "Zajęty/a";
                      const shortLabel = label.length > 15 ? label.slice(0, 15) + "…" : label;
                      return (
                        <div key={ev.id} style={{ fontSize: mfs(10), borderRadius: 4, padding: "1px 4px", background: COLORS.bg, color: ev.detailed ? COLORS.text : COLORS.textMuted, borderLeft: `2px solid ${userColor(ev.ownerId, profiles)}`, whiteSpace: "normal", wordBreak: "break-word", overflow: "hidden", minWidth: 0 }}>
                          {ev.allDay ? "Cały dzień" : ev.start} {shortLabel}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && <div style={{ fontSize: 9.5, color: COLORS.textMuted }}>+{dayEvents.length - 3} więcej</div>}
                  </div>
                </div>
              );
            })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function YearView({ anchorDate, profiles, eventsForDay, onMonthClick, onDayClick }) {
  const year = anchorDate.getFullYear();
  const todayIso = toISODate(new Date());
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
      {MONTH_NAMES.map((mName, mi) => {
        const monthDate = new Date(year, mi, 1);
        const weeks = monthMatrix(monthDate);
        return (
          <div key={mi} style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 10 }}>
            <div onClick={() => onMonthClick(monthDate)} style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, marginBottom: 6, textTransform: "capitalize" }}>{mName}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 2 }}>
              {weeks.flat().map((day, i) => {
                const iso = toISODate(day);
                const inMonth = day.getMonth() === mi;
                const isToday = inMonth && iso === todayIso;
                const dayEvs = inMonth ? eventsForDay(iso) : [];
                const ownerColors = [...new Set(dayEvs.map(e => e.ownerId))].map(id => userColor(id, profiles)).slice(0, 4);
                return (
                  <div key={i} onClick={() => inMonth && onDayClick(day)} style={{
                    aspectRatio: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative",
                    fontSize: 9.5, borderRadius: 4, cursor: inMonth ? "pointer" : "default",
                    color: !inMonth ? COLORS.line : isToday ? "#12141C" : COLORS.textMuted,
                    background: isToday ? COLORS.amber : "transparent", fontWeight: isToday ? 700 : 400,
                  }}>
                    {inMonth ? day.getDate() : ""}
                    {ownerColors.length > 0 && (
                      <span style={{ position: "absolute", bottom: 1, display: "flex", gap: 1 }}>
                        {ownerColors.map((c, ci) => (
                          <span key={ci} style={{ width: 3, height: 3, borderRadius: "50%", background: isToday ? "#12141C" : c }} />
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventCard({ ev, profiles, onClick }) {
  const ownerColor = userColor(ev.ownerId, profiles);
  const isBlock = ev.type === "block";
  const timeLabel = ev.allDay ? "Cały dzień" : `${ev.start}–${ev.end}`;
  if (!ev.detailed) {
    return (
      <div title="Zajęty/a — szczegóły widzi tylko właściciel terminu i admin" style={{ borderRadius: 8, padding: "7px 9px", background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderLeftWidth: 3, borderLeftColor: ownerColor, opacity: 0.85 }}>
        <div style={{ fontSize: mfs(11), color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 4 }}><Clock size={10} /> {timeLabel} {ev.recurring && <Repeat size={10} />}</div>
        <div style={{ fontSize: mfs(12.5), fontWeight: 600, margin: "2px 0", color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 5 }}><Ban size={11} /> Zajęty/a</div>
        <div style={{ display: "flex", gap: 3, marginTop: 5, flexWrap: "wrap" }}>
          {ev.participants.filter(p => p.status !== "declined").map(p => (
            <span key={p.userId} title={userName(p.userId, profiles)} style={{ width: 8, height: 8, borderRadius: "50%", background: userColor(p.userId, profiles) }} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div onClick={onClick} style={{ cursor: "pointer", borderRadius: 8, padding: "7px 9px", background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderLeftWidth: 3, borderLeftColor: ownerColor }}>
      <div style={{ fontSize: mfs(11), color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 4 }}><Clock size={10} /> {timeLabel} {ev.recurring && <Repeat size={10} />}</div>
      <div style={{ fontSize: mfs(12.5), fontWeight: 600, margin: "2px 0", color: isBlock ? COLORS.textMuted : COLORS.text, fontStyle: isBlock ? "italic" : "normal" }}>{isBlock ? "🚫 " : ""}{ev.title}</div>
      {ev.location && <div style={{ fontSize: 10.5, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 3 }}><MapPin size={9} /> {ev.location}</div>}
      {!isBlock && (
        <div style={{ display: "flex", gap: 3, marginTop: 5, flexWrap: "wrap" }}>
          {ev.participants.filter(p => p.status !== "declined").map(p => (
            <span key={p.userId} title={`${userName(p.userId, profiles)} — ${p.status === "accepted" ? "potwierdził(a)" : "oczekuje"}`} style={{ width: 8, height: 8, borderRadius: "50%", background: userColor(p.userId, profiles), border: p.status === "pending" ? `1px dashed ${COLORS.text}` : "1px solid transparent", opacity: p.status === "pending" ? 0.7 : 1 }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ================= EVENT MODAL =================
// ================= RECURRING OCCURRENCE (edycja/usuwanie z wyborem zakresu) =================
function RecurringOccurrenceModal({ existing, profile, profiles, onClose, onEdit, onDelete, onDeleteWholeRule }) {
  const canManage = profile.role === "admin" || existing.ownerId === profile.id;
  const [label, setLabel] = useState(existing.title || "Niedostępny/a");
  const [allDay, setAllDay] = useState(!!existing.allDay);
  const [start, setStart] = useState(existing.start);
  const [end, setEnd] = useState(existing.end);
  const [editScope, setEditScope] = useState("this");
  const [deleteScope, setDeleteScope] = useState("this");
  const [busy, setBusy] = useState(false);

  const EDIT_SCOPES = [["this", "Tylko ten dzień"], ["future", "Ten i przyszłe"], ["all", "Wszystkie wystąpienia"]];
  const DELETE_SCOPES = [["this", "Tylko ten dzień"], ["future", "Ten i przyszłe"], ["past", "Ten i poprzednie"], ["all", "Wszystkie wystąpienia"]];

  async function save() {
    setBusy(true);
    await onEdit(existing.recurringRuleId, existing.date, editScope, { label, allDay, start, end });
    setBusy(false);
    onClose();
  }
  async function remove() {
    setBusy(true);
    await onDelete(existing.recurringRuleId, existing.date, deleteScope);
    setBusy(false);
    onClose();
  }

  return (
    <ModalShell onClose={onClose} title="Cykliczna niedostępność">
      <div style={{ fontSize: 13, color: COLORS.textMuted, lineHeight: 1.6, marginBottom: 14 }}>
        Wystąpienie z {existing.date}, {existing.allDay ? "cały dzień" : `${existing.start}–${existing.end}`}.
        <br />Dotyczy: <b style={{ color: COLORS.text }}>{userName(existing.ownerId, profiles)}</b>.
      </div>
      {!canManage ? (
        <button onClick={onClose} style={secondaryBtnStyle()}>Zamknij</button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Edytuj</div>
            <Field label="Nazwa"><Input value={label} onChange={setLabel} /></Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> Cały dzień
            </label>
            {!allDay && (
              <div style={{ display: "flex", gap: 8 }}>
                <Field label="Od" style={{ flex: 1 }}><Input type="time" value={start} onChange={setStart} /></Field>
                <Field label="Do" style={{ flex: 1 }}><Input type="time" value={end} onChange={setEnd} /></Field>
              </div>
            )}
            <Field label="Zastosuj zmianę do">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {EDIT_SCOPES.map(([id, lbl]) => (
                  <button key={id} onClick={() => setEditScope(id)} style={{ padding: "6px 10px", borderRadius: 7, fontSize: 11.5, cursor: "pointer", border: `1px solid ${editScope === id ? COLORS.amber : COLORS.line}`, background: editScope === id ? COLORS.amber + "22" : "transparent", color: editScope === id ? COLORS.text : COLORS.textMuted }}>{lbl}</button>
                ))}
              </div>
            </Field>
            <button onClick={save} disabled={busy} style={{ ...primaryBtnStyle(), alignSelf: "flex-start" }}>Zapisz zmianę</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: COLORS.bg, border: `1px solid ${COLORS.rose}55`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.rose }}>Usuń</div>
            <Field label="Zakres usunięcia">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DELETE_SCOPES.map(([id, lbl]) => (
                  <button key={id} onClick={() => setDeleteScope(id)} style={{ padding: "6px 10px", borderRadius: 7, fontSize: 11.5, cursor: "pointer", border: `1px solid ${deleteScope === id ? COLORS.rose : COLORS.line}`, background: deleteScope === id ? COLORS.rose + "22" : "transparent", color: deleteScope === id ? COLORS.text : COLORS.textMuted }}>{lbl}</button>
                ))}
              </div>
            </Field>
            <button onClick={remove} disabled={busy} style={{ ...secondaryBtnStyle(), color: COLORS.rose, borderColor: COLORS.rose, alignSelf: "flex-start" }}><Trash2 size={14} /> Usuń wybrany zakres</button>
          </div>

          <button onClick={onClose} style={{ ...secondaryBtnStyle(), alignSelf: "flex-end" }}>Zamknij</button>
        </div>
      )}
    </ModalShell>
  );
}

function EventModal({ mode, profiles, profile, defaultDate, existing, onClose, onSubmit, onSubmitSeries, onDelete, isUserBusy, conflictEventFor, onInviteUser, onRemoveParticipant, onRequestJoin, onDeleteRecurring, onDeleteRecurringOccurrence, onEditRecurringOccurrence, onDeleteSeries }) {
  const [form, setForm] = useState(() => existing ? {
    title: existing.title, date: existing.date, start: existing.start, end: existing.end, allDay: !!existing.allDay,
    location: existing.location || "", notes: existing.notes || "", type: existing.type, seriesMode: false, entries: [],
    participantIds: [], pendingJoinUserIds: [], joinMessage: "",
  } : { title: "", date: defaultDate, start: "09:00", end: "10:00", allDay: false, seriesMode: false, entries: [], location: "", notes: "", type: "work", participantIds: [], pendingJoinUserIds: [], joinMessage: "" });
  const [seriesDayInput, setSeriesDayInput] = useState(defaultDate || toISODate(new Date()));
  const [seriesRangeFrom, setSeriesRangeFrom] = useState(defaultDate || toISODate(new Date()));
  const [seriesRangeTo, setSeriesRangeTo] = useState(defaultDate || toISODate(new Date()));
  const [seriesError, setSeriesError] = useState("");
  const [seriesResult, setSeriesResult] = useState(null); // {count, skipped} after successful submit
  const [expandedEntry, setExpandedEntry] = useState(null); // która data ma rozwinięty edytor godzin/załogi
  const [seriesDeleteScope, setSeriesDeleteScope] = useState("this");

  const MAX_SERIES_DAYS_AHEAD = 186; // ~6 miesięcy
  const MAX_SERIES_DATES = 150;
  const maxAllowedDate = toISODate(addDays(new Date(), MAX_SERIES_DAYS_AHEAD));

  // Nowy wpis dziedziczy AKTUALNE domyślne godziny/załogę z formularza — to tylko
  // punkt startowy, każdy dzień można potem dowolnie nadpisać osobno.
  function makeEntry(iso) { return { date: iso, start: form.start, end: form.end, allDay: form.allDay, participantIds: [...form.participantIds] }; }

  function addSeriesDay(iso) {
    setSeriesError("");
    if (!iso) return;
    if (iso > maxAllowedDate) { setSeriesError("Można planować maksymalnie 6 miesięcy do przodu."); return; }
    if (form.entries.some(e => e.date === iso)) return;
    if (form.entries.length >= MAX_SERIES_DATES) { setSeriesError(`Maksymalnie ${MAX_SERIES_DATES} dni w jednej serii.`); return; }
    setForm(f => ({ ...f, entries: [...f.entries, makeEntry(iso)].sort((a, b) => a.date.localeCompare(b.date)) }));
  }
  function addSeriesRange(fromIso, toIso) {
    setSeriesError("");
    if (!fromIso || !toIso || toIso < fromIso) { setSeriesError("Zły zakres dat."); return; }
    if (toIso > maxAllowedDate) { setSeriesError("Można planować maksymalnie 6 miesięcy do przodu."); return; }
    const existingDates = new Set(form.entries.map(e => e.date));
    const newEntries = [];
    for (let d = new Date(fromIso); d <= new Date(toIso); d.setDate(d.getDate() + 1)) {
      const iso = toISODate(d);
      if (!existingDates.has(iso)) newEntries.push(makeEntry(iso));
    }
    if (form.entries.length + newEntries.length > MAX_SERIES_DATES) { setSeriesError(`Maksymalnie ${MAX_SERIES_DATES} dni w jednej serii.`); return; }
    setForm(f => ({ ...f, entries: [...f.entries, ...newEntries].sort((a, b) => a.date.localeCompare(b.date)) }));
  }
  function removeSeriesDay(iso) { setForm(f => ({ ...f, entries: f.entries.filter(e => e.date !== iso) })); }
  function updateEntry(iso, patch) { setForm(f => ({ ...f, entries: f.entries.map(e => e.date === iso ? { ...e, ...patch } : e) })); }
  function toggleEntryParticipant(iso, uid) {
    setForm(f => ({ ...f, entries: f.entries.map(e => e.date === iso ? { ...e, participantIds: e.participantIds.includes(uid) ? e.participantIds.filter(id => id !== uid) : [...e.participantIds, uid] } : e) }));
  }
  function applyDefaultsToAll() {
    setForm(f => ({ ...f, entries: f.entries.map(e => ({ ...e, start: f.start, end: f.end, allDay: f.allDay, participantIds: [...f.participantIds] })) }));
  }

  // Read-only view for a single occurrence of a recurring unavailability rule —
  // editing one occurrence isn't supported; the whole rule is managed from
  // "Cykliczna niedostępność" instead.
  if (existing && existing.recurring) {
    return <RecurringOccurrenceModal existing={existing} profile={profile} profiles={profiles} onClose={onClose} onEdit={onEditRecurringOccurrence} onDelete={onDeleteRecurringOccurrence} onDeleteWholeRule={onDeleteRecurring} />;
  }

  const canEdit = mode === "new" || profile.role === "admin" || (existing && existing.ownerId === profile.id);
  const others = profiles.filter(u => u.id !== profile.id);

  function toggleParticipant(uid) { setForm(f => ({ ...f, participantIds: f.participantIds.includes(uid) ? f.participantIds.filter(id => id !== uid) : [...f.participantIds, uid] })); }
  function togglePendingJoin(uid) { setForm(f => ({ ...f, pendingJoinUserIds: f.pendingJoinUserIds.includes(uid) ? f.pendingJoinUserIds.filter(id => id !== uid) : [...f.pendingJoinUserIds, uid] })); }
  function busyCheck(uid) { return isUserBusy(uid, form.date, form.start, form.end, existing ? existing.id : null); }

  async function submit() {
    if (form.seriesMode) {
      if (form.entries.length === 0) { setSeriesError("Dodaj co najmniej jeden dzień do serii."); return; }
      const badEntry = form.entries.find(e => !e.allDay && (!e.start || !e.end));
      if (badEntry) { setSeriesError(`Podaj godziny dla dnia ${badEntry.date} albo zaznacz dla niego „Cały dzień”.`); return; }
      if (form.type === "work" && !form.title.trim()) { setSeriesError("Podaj tytuł terminu."); return; }
      const res = await onSubmitSeries({ ...form, title: form.title.trim() || (form.type === "block" ? "Niedostępny/a" : "") });
      if (res && res.ok) setSeriesResult({ count: res.count, skipped: res.skipped, pendingDetails: res.pendingDetails });
      else setSeriesError((res && res.error) || "Coś poszło nie tak.");
      return;
    }
    if (!form.title.trim() && !(form.type === "block")) return;
    if (!form.date || (!form.allDay && (!form.start || !form.end))) return;
    const payload = { ...form, title: form.title.trim() || (form.type === "block" ? "Niedostępny/a" : form.title) };
    if (existing) onSubmit({ ...existing, ...payload });
    else onSubmit(payload);
  }

  if (seriesResult) {
    return (
      <ModalShell onClose={onClose} title="Seria dodana">
        <div style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.6, marginBottom: 14 }}>
          Dodano terminy na <b>{seriesResult.count}</b> {seriesResult.count === 1 ? "dzień" : "dni"}.
          {seriesResult.skipped > 0 && (
            <div style={{ color: COLORS.amber, marginTop: 6 }}>
              <div>Dla {seriesResult.skipped} {seriesResult.skipped === 1 ? "przypadku" : "przypadków"} (osoba zajęta danego dnia) wysłano zapytanie o akceptację zamiast zwykłego zaproszenia:</div>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                {(seriesResult.pendingDetails || []).map((d, i) => <li key={i}>{d.date} — {d.name}</li>)}
              </ul>
            </div>
          )}
        </div>
        <button onClick={onClose} style={primaryBtnStyle()}>OK</button>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} title={mode === "new" ? "Nowy termin" : "Szczegóły terminu"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {existing && (
          <div style={{ fontSize: 12, color: COLORS.textMuted, background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "8px 10px" }}>
            <div><span style={{ color: COLORS.textMuted }}>Zainicjował/a: </span><b style={{ color: COLORS.text }}>{userName(existing.ownerId, profiles)}</b></div>
            {existing.type === "work" && existing.participants && existing.participants.length > 0 && (
              <div style={{ marginTop: 3 }}>
                <span style={{ color: COLORS.textMuted }}>Uczestnicy: </span>
                {existing.participants.map((p, i) => (
                  <span key={p.userId}>
                    {i > 0 && ", "}
                    <b style={{ color: COLORS.text }}>{userName(p.userId, profiles)}</b>
                    <span style={{ color: p.status === "accepted" ? COLORS.teal : p.status === "declined" ? COLORS.rose : COLORS.amber }}> ({p.status === "accepted" ? "potwierdził(a)" : p.status === "declined" ? "odrzucił(a)" : "oczekuje"})</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <Field label="Rodzaj">
          <div style={{ display: "flex", gap: 8 }}>
            <ChoiceBtn active={form.type === "work"} onClick={() => setForm(f => ({ ...f, type: "work" }))} disabled={!canEdit}>Wspólna praca</ChoiceBtn>
            <ChoiceBtn active={form.type === "block"} onClick={() => setForm(f => ({ ...f, type: "block", participantIds: [] }))} disabled={!canEdit}>Moja niedostępność</ChoiceBtn>
          </div>
        </Field>

        <Field label={form.type === "block" ? "Tytuł (np. Urlop, Zwolnienie)" : "Tytuł (np. Zlecenie, nazwa pracy)"}>
          <Input value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} disabled={!canEdit} placeholder={form.type === "block" ? "np. Urlop" : "np. Instalacja u klienta X"} />
        </Field>

        {mode === "new" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.text, cursor: "pointer" }}>
            <input type="checkbox" checked={form.seriesMode} onChange={e => setForm(f => ({ ...f, seriesMode: e.target.checked }))} disabled={!canEdit} />
            Seria dat — kilka dni, niekoniecznie po sobie (urlop, zlecenie rozłożone na tygodnie…)
          </label>
        )}

        {!form.seriesMode ? (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Field label="Data" style={{ flex: 1, minWidth: 120 }}>
                <Input type="date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} disabled={!canEdit} />
              </Field>
              {!form.allDay && (
                <>
                  <Field label="Od" style={{ flex: 1, minWidth: 90 }}><Input type="time" value={form.start} onChange={v => setForm(f => ({ ...f, start: v }))} disabled={!canEdit} /></Field>
                  <Field label="Do" style={{ flex: 1, minWidth: 90 }}><Input type="time" value={form.end} onChange={v => setForm(f => ({ ...f, end: v }))} disabled={!canEdit} /></Field>
                </>
              )}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.text, cursor: "pointer" }}>
              <input type="checkbox" checked={form.allDay} onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))} disabled={!canEdit} />
              Cały dzień (bez podawania godzin)
            </label>
          </>
        ) : (
          <Field label="Dni w serii">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10.5, color: COLORS.textMuted }}>Domyślne godziny dla nowo dodawanych dni (każdy dzień można potem zmienić osobno):</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.allDay} onChange={e => setForm(f => ({ ...f, allDay: e.target.checked }))} /> Cały dzień
                </label>
                {!form.allDay && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Field label="Od" style={{ flex: 1 }}><Input type="time" value={form.start} onChange={v => setForm(f => ({ ...f, start: v }))} /></Field>
                    <Field label="Do" style={{ flex: 1 }}><Input type="time" value={form.end} onChange={v => setForm(f => ({ ...f, end: v }))} /></Field>
                  </div>
                )}
                {form.type === "work" && (
                  <div>
                    <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginBottom: 4 }}>Domyślna załoga (możesz zmienić osobno dla każdego dnia niżej):</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {others.map(u => (
                        <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                          <input type="checkbox" checked={form.participantIds.includes(u.id)} onChange={() => toggleParticipant(u.id)} />
                          <span style={{ width: 7, height: 7, borderRadius: "50%", background: u.color }} /> {u.name}
                        </label>
                      ))}
                      {others.length === 0 && <div style={{ fontSize: 11, color: COLORS.textMuted }}>Brak innych zatwierdzonych pracowników.</div>}
                    </div>
                  </div>
                )}
                {form.entries.length > 0 && (
                  <button onClick={applyDefaultsToAll} style={{ ...secondaryBtnStyle(), padding: "6px 10px", fontSize: 11.5, alignSelf: "flex-start" }}>Zastosuj te ustawienia do wszystkich dodanych dni</button>
                )}
              </div>

              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 130 }}><Input type="date" value={seriesDayInput} onChange={setSeriesDayInput} /></div>
                <button onClick={() => addSeriesDay(seriesDayInput)} style={{ ...secondaryBtnStyle(), padding: "8px 10px", fontSize: 12 }}>+ Dodaj dzień</button>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 110 }}><Field label="Od"><Input type="date" value={seriesRangeFrom} onChange={setSeriesRangeFrom} /></Field></div>
                <div style={{ flex: 1, minWidth: 110 }}><Field label="Do"><Input type="date" value={seriesRangeTo} onChange={setSeriesRangeTo} /></Field></div>
                <button onClick={() => addSeriesRange(seriesRangeFrom, seriesRangeTo)} style={{ ...secondaryBtnStyle(), padding: "8px 10px", fontSize: 12 }}>+ Dodaj zakres</button>
              </div>
              {seriesError && <div style={{ fontSize: 11.5, color: COLORS.rose }}>{seriesError}</div>}

              {form.entries.length > 0 && (() => {
                const conflictCount = form.type === "work" ? form.entries.filter(e => e.participantIds.some(pid => isUserBusy(pid, e.date, e.allDay ? "00:00" : e.start, e.allDay ? "23:59" : e.end, null))).length : 0;
                return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
                  <div style={{ fontSize: 10.5, color: COLORS.textMuted }}>{form.entries.length} dni (max {MAX_SERIES_DATES}) — kliknij dzień, żeby zmienić dla niego godziny{form.type === "work" ? " i załogę" : ""}.</div>
                  {conflictCount > 0 && (
                    <div style={{ fontSize: 11.5, color: COLORS.rose, background: COLORS.rose + "15", border: `1px solid ${COLORS.rose}55`, borderRadius: 6, padding: "6px 8px", display: "flex", alignItems: "center", gap: 6 }}>
                      <AlertTriangle size={12} /> {conflictCount} {conflictCount === 1 ? "dzień ma" : "dni ma"} konflikt terminu (zaznaczone na czerwono niżej) — rozwiń dzień, żeby wysłać zapytanie o akceptację albo wybrać inną osobę.
                    </div>
                  )}
                  {form.entries.map(e => {
                    const isOpen = expandedEntry === e.date;
                    const crew = e.participantIds.map(id => {
                      const u = profiles.find(p => p.id === id);
                      const busy = isUserBusy(id, e.date, e.allDay ? "00:00" : e.start, e.allDay ? "23:59" : e.end, null);
                      return u ? { id, name: u.name, busy } : null;
                    }).filter(Boolean);
                    const hasConflict = crew.some(c => c.busy);
                    return (
                      <div key={e.date} style={{ border: `1px solid ${hasConflict ? COLORS.rose : COLORS.line}`, borderRadius: 8, background: COLORS.bg, overflow: "hidden" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", flexWrap: "wrap" }}>
                          {hasConflict && <AlertTriangle size={13} color={COLORS.rose} style={{ flexShrink: 0 }} />}
                          <span onClick={() => setExpandedEntry(isOpen ? null : e.date)} style={{ fontSize: mfs(12.5), fontWeight: 600, cursor: "pointer" }}>{e.date}</span>
                          <span onClick={() => setExpandedEntry(isOpen ? null : e.date)} style={{ fontSize: mfs(11), color: COLORS.textMuted, cursor: "pointer" }}>{e.allDay ? "Cały dzień" : `${e.start}–${e.end}`}</span>
                          {form.type === "work" && crew.length > 0 && (
                            <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginLeft: "auto" }}>
                              {crew.map(c => (
                                <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: mfs(10.5), padding: "2px 5px", borderRadius: 5, background: c.busy ? COLORS.rose + "22" : COLORS.teal + "22", color: c.busy ? COLORS.rose : COLORS.teal }}>
                                  {c.name}{c.busy ? " ⚠" : ""}
                                  <button onClick={(ev) => { ev.stopPropagation(); toggleEntryParticipant(e.date, c.id); }} title="Usuń z tego dnia" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", display: "flex", padding: 0 }}><X size={10} /></button>
                                </span>
                              ))}
                            </span>
                          )}
                          <Pencil size={13} color={COLORS.textMuted} onClick={() => setExpandedEntry(isOpen ? null : e.date)} style={{ cursor: "pointer", flexShrink: 0 }} />
                          <button onClick={() => removeSeriesDay(e.date)} title="Usuń ten dzień z serii" style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.rose, display: "flex", padding: 0, flexShrink: 0 }}><X size={14} /></button>
                        </div>
                        {hasConflict && (
                          <div style={{ padding: "0 10px 8px", fontSize: mfs(10.5), color: COLORS.rose }}>
                            Po utworzeniu serii zostanie automatycznie wysłane zapytanie o akceptację do zajętej osoby. Możesz też kliknąć „×” przy jej imieniu, żeby ją usunąć z tego dnia i dodać kogoś wolnego (przycisk ✏️).
                          </div>
                        )}
                        {isOpen && (
                          <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, cursor: "pointer" }}>
                              <input type="checkbox" checked={e.allDay} onChange={ev => updateEntry(e.date, { allDay: ev.target.checked })} /> Cały dzień
                            </label>
                            {!e.allDay && (
                              <div style={{ display: "flex", gap: 8 }}>
                                <Field label="Od" style={{ flex: 1 }}><Input type="time" value={e.start} onChange={v => updateEntry(e.date, { start: v })} /></Field>
                                <Field label="Do" style={{ flex: 1 }}><Input type="time" value={e.end} onChange={v => updateEntry(e.date, { end: v })} /></Field>
                              </div>
                            )}
                            {form.type === "work" && (
                              <div>
                                <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginBottom: 4 }}>Załoga tego dnia:</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  {others.map(u => {
                                    const busyThisDay = isUserBusy(u.id, e.date, e.allDay ? "00:00" : e.start, e.allDay ? "23:59" : e.end, null);
                                    return (
                                      <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                                        <input type="checkbox" checked={e.participantIds.includes(u.id)} onChange={() => toggleEntryParticipant(e.date, u.id)} />
                                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: u.color }} /> {u.name}
                                        {busyThisDay && <span style={{ fontSize: 10, color: COLORS.rose, display: "flex", alignItems: "center", gap: 2 }}><Ban size={10} /> zajęty(a) tego dnia — zaznaczenie wyśle zapytanie o akceptację</span>}
                                      </label>
                                    );
                                  })}
                                  {others.length === 0 && <div style={{ fontSize: 11, color: COLORS.textMuted }}>Brak innych zatwierdzonych pracowników.</div>}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </div>
          </Field>
        )}

        {form.type === "work" && <Field label="Lokalizacja"><Input value={form.location} onChange={v => setForm(f => ({ ...f, location: v }))} disabled={!canEdit} placeholder="adres / miejsce" /></Field>}
        <Field label="Notatki"><Input value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} disabled={!canEdit} placeholder="opcjonalnie" /></Field>

        {form.type === "work" && mode === "new" && !form.seriesMode && (
          <Field label="Z kim dzielisz ten termin">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {others.map(u => {
                const busy = busyCheck(u.id);
                const checked = form.participantIds.includes(u.id);
                const wantsJoinReq = form.pendingJoinUserIds.includes(u.id);
                return (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: COLORS.bg, border: `1px solid ${busy ? COLORS.rose + "55" : COLORS.line}` }}>
                    {!busy ? <input type="checkbox" checked={checked} disabled={!canEdit} onChange={() => toggleParticipant(u.id)} />
                           : <input type="checkbox" checked={wantsJoinReq} disabled={!canEdit} onChange={() => togglePendingJoin(u.id)} />}
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: u.color }} />
                    <span style={{ fontSize: 13, flex: 1 }}>{u.name}</span>
                    {busy && <span style={{ fontSize: 10.5, color: COLORS.rose, display: "flex", alignItems: "center", gap: 3 }}><Ban size={11} /> zajęty(a) — zaznacz, aby wysłać zapytanie o akceptację (dostaniesz powiadomienie o decyzji)</span>}
                  </div>
                );
              })}
              {others.length === 0 && <div style={{ fontSize: 12, color: COLORS.textMuted }}>Brak innych zatwierdzonych pracowników.</div>}
            </div>
          </Field>
        )}
        {form.type === "work" && mode === "new" && form.pendingJoinUserIds.length > 0 && (
          <Field label="Wiadomość do zajętych osób (opcjonalnie)"><Input value={form.joinMessage} onChange={v => setForm(f => ({ ...f, joinMessage: v }))} placeholder="np. Czy mógłbyś/mogłabyś przełożyć swój termin?" /></Field>
        )}

        {form.type === "work" && existing && (
          <Field label="Dodaj kolejną osobę">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {others.filter(u => !existing.participants.some(p => p.userId === u.id && p.status !== "declined")).map(u => {
                const busy = isUserBusy(u.id, existing.date, existing.start, existing.end, existing.id);
                return (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: COLORS.bg, border: `1px solid ${COLORS.line}` }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: u.color }} />
                    <span style={{ fontSize: 13, flex: 1 }}>{u.name}</span>
                    {busy ? (
                      <>
                        <span style={{ fontSize: 10.5, color: COLORS.rose, display: "flex", alignItems: "center", gap: 3 }}><Ban size={11} /> zajęty(a)</span>
                        <button onClick={() => { const conflict = conflictEventFor(u.id, existing.date, existing.start, existing.end, existing.id); onRequestJoin(u.id, conflict, existing); }}
                          style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 6, border: `1px solid ${COLORS.amber}`, background: "transparent", color: COLORS.amber, cursor: "pointer" }}>Wyślij zapytanie o akceptację</button>
                      </>
                    ) : (
                      <button onClick={() => onInviteUser(existing, u.id)} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 6, border: `1px solid ${COLORS.teal}`, background: "transparent", color: COLORS.teal, cursor: "pointer" }}>Zaproś</button>
                    )}
                  </div>
                );
              })}
            </div>
          </Field>
        )}
        {existing && form.type === "work" && (
          <Field label="Status uczestników">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {existing.participants.map(p => (
                <div key={p.userId} style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, color: COLORS.textMuted }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: userColor(p.userId, profiles) }} />
                  <span style={{ flex: 1 }}>{userName(p.userId, profiles)} — <span style={{ color: p.status === "accepted" ? COLORS.teal : p.status === "declined" ? COLORS.rose : COLORS.amber }}>{p.status === "accepted" ? "potwierdził(a)" : p.status === "declined" ? "odrzucił(a) / zajęty(a)" : "oczekuje"}</span></span>
                  {(profile.role === "admin" || existing.ownerId === profile.id) && p.userId !== profile.id && (
                    <button onClick={() => onRemoveParticipant(existing, p.userId)} title="Usuń tę osobę z terminu (np. dodana lub zaakceptowana omyłkowo)" style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 6, border: `1px solid ${COLORS.rose}`, background: "transparent", color: COLORS.rose, cursor: "pointer", flexShrink: 0 }}>Usuń</button>
                  )}
                </div>
              ))}
            </div>
          </Field>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          {existing && existing.seriesId && (profile.role === "admin" || existing.ownerId === profile.id) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: COLORS.textMuted }}>Ten termin jest częścią serii — usuń:</span>
              {[["this", "tylko ten"], ["future", "ten i przyszłe"], ["past", "ten i poprzednie"], ["all", "wszystkie"]].map(([id, lbl]) => (
                <button key={id} onClick={() => setSeriesDeleteScope(id)} style={{ padding: "4px 8px", borderRadius: 6, fontSize: 10.5, cursor: "pointer", border: `1px solid ${seriesDeleteScope === id ? COLORS.rose : COLORS.line}`, background: seriesDeleteScope === id ? COLORS.rose + "22" : "transparent", color: seriesDeleteScope === id ? COLORS.text : COLORS.textMuted }}>{lbl}</button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {canEdit && <button onClick={submit} style={primaryBtnStyle()}>{mode === "new" ? (form.seriesMode ? `Utwórz serię (${form.entries.length})` : "Utwórz termin") : "Zapisz zmiany"}</button>}
            {existing && (profile.role === "admin" || existing.ownerId === profile.id) && (
              <button onClick={() => existing.seriesId ? onDeleteSeries(existing, seriesDeleteScope) : onDelete(existing)} style={{ ...secondaryBtnStyle(), color: COLORS.rose, borderColor: COLORS.rose }}><Trash2 size={14} /> Usuń</button>
            )}
            <button onClick={onClose} style={{ ...secondaryBtnStyle(), marginLeft: "auto" }}>Zamknij</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children, style }) { return <div style={style}><div style={{ fontSize: mfs(11), color: COLORS.textMuted, marginBottom: 4, fontWeight: 500 }}>{label}</div>{children}</div>; }
function Input({ value, onChange, type = "text", placeholder, disabled }) {
  const isDark = COLORS.bg === DARK_THEME.bg;
  return <input type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={e => onChange(e.target.value)}
    style={{ width: "100%", padding: IS_MOBILE ? "11px 12px" : "8px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: disabled ? COLORS.panel2 : COLORS.bg, color: COLORS.text, fontSize: mfs(13), outline: "none", boxSizing: "border-box", colorScheme: isDark ? "dark" : "light" }} />;
}
function ChoiceBtn({ active, onClick, children, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ flex: 1, padding: IS_MOBILE ? "10px 12px" : "7px 10px", borderRadius: 8, fontSize: mfs(12.5), cursor: disabled ? "default" : "pointer", border: `1px solid ${active ? COLORS.amber : COLORS.line}`, background: active ? COLORS.amber + "22" : "transparent", color: active ? COLORS.text : COLORS.textMuted }}>{children}</button>;
}
function primaryBtnStyle() { return { padding: IS_MOBILE ? "12px 18px" : "9px 16px", borderRadius: 9, border: "none", background: COLORS.amber, color: "#12141C", fontWeight: 600, fontSize: mfs(13), cursor: "pointer" }; }
function secondaryBtnStyle() { return { padding: IS_MOBILE ? "12px 16px" : "9px 14px", borderRadius: 9, border: `1px solid ${COLORS.line}`, background: "transparent", color: COLORS.text, fontSize: mfs(13), cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }; }

function ModalShell({ onClose, title, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#00000099", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: "94vw", maxHeight: "85vh", overflowY: "auto", WebkitOverflowScrolling: "touch", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 14, padding: 20, fontFamily: "Inter, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: mfs(16) }}>{title}</div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer" }}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ================= JOIN REQUEST MODAL =================
const WEEKDAY_SHORT = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nie"];

function RecurringBlockModal({ profile, recurringBlocks, onClose, onCreate, onDelete }) {
  const [label, setLabel] = useState("");
  const [weekdays, setWeekdays] = useState([]);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");
  const [dateFrom, setDateFrom] = useState(toISODate(new Date()));
  const [noEnd, setNoEnd] = useState(true);
  const [dateUntil, setDateUntil] = useState("");

  const mine = recurringBlocks.filter(r => r.userId === profile.id);

  function toggleWeekday(i) { setWeekdays(w => w.includes(i) ? w.filter(x => x !== i) : [...w, i].sort()); }

  function submit() {
    if (weekdays.length === 0 || !dateFrom || (!allDay && (!start || !end))) return;
    onCreate({ label: label.trim() || "Niedostępny/a", weekdays, allDay, start, end, dateFrom, dateUntil: noEnd ? null : dateUntil });
    setLabel(""); setWeekdays([]);
  }

  return (
    <ModalShell onClose={onClose} title="Cykliczna niedostępność">
      <div style={{ fontSize: 12.5, color: COLORS.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Przykład: pracujesz dla innej firmy w każdy wtorek i czwartek 8:00–16:00 — zaznacz te dni, podaj godziny, a system co tydzień sam pokaże Cię jako zajętego/ą w tym oknie, bez ręcznego dodawania.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Nazwa (widoczna tylko dla Ciebie i admina)"><Input value={label} onChange={setLabel} placeholder="np. Praca w innej firmie / Straż" /></Field>
        <Field label="Dni tygodnia">
          <div style={{ display: "flex", gap: 5 }}>
            {WEEKDAY_SHORT.map((d, i) => (
              <button key={i} onClick={() => toggleWeekday(i)} style={{ flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 11.5, cursor: "pointer", border: `1px solid ${weekdays.includes(i) ? COLORS.amber : COLORS.line}`, background: weekdays.includes(i) ? COLORS.amber + "22" : "transparent", color: weekdays.includes(i) ? COLORS.text : COLORS.textMuted }}>{d}</button>
            ))}
          </div>
        </Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> Cały dzień
        </label>
        {!allDay && (
          <div style={{ display: "flex", gap: 8 }}>
            <Field label="Od" style={{ flex: 1 }}><Input type="time" value={start} onChange={setStart} /></Field>
            <Field label="Do" style={{ flex: 1 }}><Input type="time" value={end} onChange={setEnd} /></Field>
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <Field label="Obowiązuje od" style={{ flex: 1 }}><Input type="date" value={dateFrom} onChange={setDateFrom} /></Field>
          <Field label="Do kiedy" style={{ flex: 1 }}>
            {noEnd ? <div style={{ fontSize: 12, color: COLORS.textMuted, padding: "8px 0" }}>Bezterminowo</div> : <Input type="date" value={dateUntil} onChange={setDateUntil} />}
          </Field>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={noEnd} onChange={e => setNoEnd(e.target.checked)} /> Bezterminowo (do odwołania)
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={submit} style={primaryBtnStyle()}>Dodaj regułę</button>
          <button onClick={onClose} style={{ ...secondaryBtnStyle(), marginLeft: "auto" }}>Zamknij</button>
        </div>

        {mine.length > 0 && (
          <div style={{ marginTop: 8, borderTop: `1px solid ${COLORS.line}`, paddingTop: 10 }}>
            <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginBottom: 6 }}>Twoje aktywne reguły</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {mine.map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: COLORS.bg, border: `1px solid ${COLORS.line}`, fontSize: 12 }}>
                  <span style={{ flex: 1 }}>
                    {r.label} — {r.weekdays.map(w => WEEKDAY_SHORT[w]).join(", ")}, {r.allDay ? "cały dzień" : `${r.start}–${r.end}`}
                    <span style={{ color: COLORS.textMuted }}> (od {r.dateFrom}{r.dateUntil ? ` do ${r.dateUntil}` : ", bezterminowo"})</span>
                  </span>
                  <button onClick={() => onDelete(r)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Trash2 size={13} color={COLORS.rose} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function JoinRequestModal({ profiles, data, onClose, onSend }) {
  const [message, setMessage] = useState("");
  const busyUser = profiles.find(u => u.id === data.busyUserId);
  return (
    <ModalShell onClose={onClose} title="Zapytanie o akceptację">
      <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
        <b style={{ color: COLORS.text }}>{busyUser?.name}</b> jest zajęty/a w tym terminie. Wyślę zapytanie o akceptację — dostanie powiadomienie i musi je zaakceptować albo odrzucić. Sam/a też dostaniesz powiadomienie o jego/jej decyzji; jeśli odrzuci, będziesz mógł/mogła dopisać kogoś innego.
      </div>
      <Field label="Wiadomość (opcjonalnie)">
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="np. Czy mógłbyś/mogłabyś przełożyć swój termin i dołączyć do mnie?"
          style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bg, color: COLORS.text, fontSize: 13, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
      </Field>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={() => onSend({ busyUserId: data.busyUserId, conflictEvent: data.conflictEvent, draftEvent: data.draftEvent, message })} style={primaryBtnStyle()}><Send size={13} style={{ marginRight: 6 }} /> Wyślij prośbę</button>
        <button onClick={onClose} style={secondaryBtnStyle()}>Anuluj</button>
      </div>
    </ModalShell>
  );
}

// ================= NOTIFICATIONS =================
function NotificationsView({ notifs, profiles, onAcceptInvite, onDeclineInvite, onAcceptJoin, onDeclineJoin, onMarkRead, onDismiss }) {
  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 14 }}>Powiadomienia</div>
      {notifs.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 13 }}>Brak powiadomień.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {notifs.map(n => (
          <div key={n.id} onClick={() => !n.read && onMarkRead(n.id)} style={{ background: COLORS.panel, border: `1px solid ${n.read ? COLORS.line : COLORS.amber}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <NotifIcon type={n.type} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{n.message}</div>
                <div style={{ fontSize: 10.5, color: COLORS.textMuted, marginTop: 4 }}>{new Date(n.timestamp).toLocaleString("pl-PL")}</div>
                {n.type === "invite" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button onClick={(e) => { e.stopPropagation(); onAcceptInvite(n); }} style={{ ...primaryBtnStyle(), padding: "5px 10px", fontSize: 12 }}><Check size={12} /> Akceptuj</button>
                    <button onClick={(e) => { e.stopPropagation(); onDeclineInvite(n); }} style={{ ...secondaryBtnStyle(), padding: "5px 10px", fontSize: 12 }}><X size={12} /> Odrzuć</button>
                  </div>
                )}
                {n.type === "join_request" && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button onClick={(e) => { e.stopPropagation(); onAcceptJoin(n); }} style={{ ...primaryBtnStyle(), padding: "5px 10px", fontSize: 12 }}><Check size={12} /> Zmień termin i dołącz</button>
                    <button onClick={(e) => { e.stopPropagation(); onDeclineJoin(n); }} style={{ ...secondaryBtnStyle(), padding: "5px 10px", fontSize: 12 }}><X size={12} /> Odrzuć</button>
                  </div>
                )}
                {(n.type === "invite_response" || n.type === "join_response" || n.type === "event_cancelled" || n.type === "capacity_alert" || n.type === "info") && (
                  <button onClick={(e) => { e.stopPropagation(); onDismiss(n.id); }} style={{ fontSize: 11, color: COLORS.textMuted, background: "none", border: "none", cursor: "pointer", marginTop: 6, padding: 0 }}>Ukryj</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function NotifIcon({ type }) {
  const map = { invite: <Bell size={15} color={COLORS.amber} />, join_request: <AlertTriangle size={15} color={COLORS.rose} />, invite_response: <Check size={15} color={COLORS.teal} />, join_response: <Check size={15} color={COLORS.teal} />, event_cancelled: <X size={15} color={COLORS.rose} />, capacity_alert: <AlertTriangle size={15} color={COLORS.amber} />, info: <Bell size={15} color={COLORS.textMuted} /> };
  return map[type] || <Bell size={15} />;
}

// ================= PROFILE (self-service) =================
function ProfileView({ profile, onUpdate, onChangePassword }) {
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);
  const [newPassword, setNewPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function saveProfile() {
    if (!name.trim()) { setMsg("Podaj nazwę wyświetlaną."); return; }
    await onUpdate({ name: name.trim(), color, theme: profile.theme });
    setMsg("Zapisano zmiany profilu.");
  }
  async function savePassword() {
    if (newPassword.length < 6) { setMsg("Nowe hasło musi mieć min. 6 znaków."); return; }
    const err = await onChangePassword(newPassword);
    setMsg(err || "Hasło zmienione.");
    if (!err) setNewPassword("");
  }

  return (
    <div style={{ maxWidth: 380 }}>
      <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 14 }}>Mój profil</div>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <Field label="Nazwa wyświetlana"><Input value={name} onChange={setName} /></Field>
        <Field label="Email"><Input value={profile.email || ""} onChange={() => {}} disabled /></Field>
        <Field label="Kolor w kalendarzu">
          <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 44, height: 32, border: "none", background: "none", cursor: "pointer" }} />
        </Field>
        <button onClick={saveProfile} style={{ ...primaryBtnStyle(), alignSelf: "flex-start" }}>Zapisz profil</button>
      </div>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><KeyRound size={14} /> Zmiana hasła</div>
        <Field label="Nowe hasło"><Input type="password" value={newPassword} onChange={setNewPassword} placeholder="min. 6 znaków" /></Field>
        <button onClick={savePassword} style={{ ...secondaryBtnStyle(), alignSelf: "flex-start" }}>Zmień hasło</button>
      </div>
      {msg && <div style={{ fontSize: 12, color: msg.includes("Zapisano") || msg.includes("zmienione") ? COLORS.teal : COLORS.rose, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

// ================= ADMIN PANEL =================
function AdminPanel({ profiles, events, auditLog, onSetApproved, onSetRole, onSendPasswordReset, onDeleteEvent, onEditEvent, bufferMinutes, onSetBufferMinutes, onExportBackup, onImportBackup }) {
  const [tab, setTab] = useState("team");
  const [bufferInput, setBufferInput] = useState(String(bufferMinutes));
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef(null);
  const pending = profiles.filter(p => !p.approved);
  const approved = profiles.filter(p => p.approved);
  const upcoming = events.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const capacityPct = computeCapacityPct(events, profiles, 30, 8);

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportBusy(true); setImportMsg("");
    const res = await onImportBackup(file);
    setImportBusy(false);
    setImportMsg(res.ok ? `Zaimportowano ${res.count} terminów.` : `Błąd: ${res.error}`);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 14 }}>Panel admina</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[["team", `Zespół${pending.length ? ` (${pending.length} oczekuje)` : ""}`], ["events", "Wszystkie terminy"], ["activity", "Aktywność"], ["settings", "Ustawienia"], ["backup", "Kopia zapasowa"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${tab === id ? COLORS.amber : COLORS.line}`, background: tab === id ? COLORS.amber + "22" : "transparent", color: COLORS.text, fontSize: 12.5, cursor: "pointer" }}>{label}</button>
        ))}
      </div>

      {tab === "team" && (
        <div>
          {pending.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8, color: COLORS.amber }}>Oczekują na zatwierdzenie</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pending.map(u => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: COLORS.panel, border: `1px solid ${COLORS.amber}55`, borderRadius: 9 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: u.color }} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</span>
                    <span style={{ fontSize: 11.5, color: COLORS.textMuted }}>{u.email}</span>
                    <button onClick={() => onSetApproved(u.id, true)} style={{ ...primaryBtnStyle(), marginLeft: "auto", padding: "5px 10px", fontSize: 12 }}>Zatwierdź</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Zespół ({approved.length}/5)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {approved.map(u => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 9, flexWrap: "wrap" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: u.color }} />
                <span style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</span>
                {u.role === "admin" && <ShieldCheck size={13} color={COLORS.amber} />}
                <span style={{ fontSize: 11.5, color: COLORS.textMuted }}>{u.email}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => onSetRole(u.id, u.role === "admin" ? "employee" : "admin")} style={{ ...secondaryBtnStyle(), padding: "4px 8px", fontSize: 11 }}>{u.role === "admin" ? "Odbierz admina" : "Nadaj admina"}</button>
                  <button onClick={() => onSendPasswordReset(u.email)} title="Wyślij e-mail do zresetowania hasła" style={{ ...secondaryBtnStyle(), padding: "4px 8px", fontSize: 11 }}><Mail size={11} /> Reset hasła</button>
                  {u.role !== "admin" && <button onClick={() => onSetApproved(u.id, false)} style={{ ...secondaryBtnStyle(), padding: "4px 8px", fontSize: 11, color: COLORS.rose, borderColor: COLORS.rose }}>Zablokuj dostęp</button>}
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginTop: 12, lineHeight: 1.6 }}>
            "Zablokuj dostęp" odbiera dostęp do kalendarza bez usuwania konta. Aby całkowicie usunąć konto (np. gdy ktoś odchodzi z firmy), wejdź w panel Supabase → Authentication → Users → usuń użytkownika.
          </div>
        </div>
      )}

      {tab === "events" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {upcoming.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 13 }}>Brak terminów.</div>}
          {upcoming.map(ev => (
            <div key={ev.id} onClick={() => onEditEvent(ev)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 9, fontSize: 12.5 }}>
              <span style={{ color: COLORS.textMuted, width: 130 }}>{ev.date} {ev.start}–{ev.end}</span>
              <span style={{ fontWeight: 600 }}>{ev.title}</span>
              <span style={{ marginLeft: "auto", color: COLORS.textMuted }}>{ev.participants.map(p => userName(p.userId, profiles)).join(", ")}</span>
              <Pencil size={13} color={COLORS.textMuted} />
              <button onClick={(e) => { e.stopPropagation(); onDeleteEvent(ev); }} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><Trash2 size={13} color={COLORS.rose} /></button>
            </div>
          ))}
        </div>
      )}

      {tab === "activity" && (
        <div>
          <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginBottom: 10 }}>Ostatnie 300 zdarzeń — logowania, terminy, zaproszenia, prośby o zmianę, zmiany profilu i decyzje admina.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 520, overflowY: "auto" }}>
            {auditLog.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 13 }}>Brak zarejestrowanej aktywności.</div>}
            {auditLog.map(a => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: COLORS.textMuted, width: 140, flexShrink: 0 }}>{new Date(a.timestamp).toLocaleString("pl-PL")}</span>
                <ActivityBadge action={a.action} />
                <span style={{ flex: 1 }}>{a.details}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "settings" && (
        <div style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Bufor czasowy między zadaniami</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
              Minimalny odstęp (w minutach), jaki musi być między dwoma terminami tej samej osoby — np. czas potrzebny na dojazd z jednego zadania na drugie. Jeśli między dwoma terminami zostanie mniej niż ten czas, system uzna osobę za zajętą, nawet jeśli terminy się formalnie nie pokrywają.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" min="0" step="15" value={bufferInput} onChange={e => setBufferInput(e.target.value)}
                style={{ width: 100, padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: COLORS.bg, color: COLORS.text, fontSize: 13, outline: "none" }} />
              <span style={{ fontSize: 12.5, color: COLORS.textMuted }}>minut (obecnie: {bufferMinutes} min = {(bufferMinutes / 60).toFixed(1).replace(/\.0$/, "")} godz.)</span>
            </div>
            <button onClick={() => onSetBufferMinutes(Math.max(0, parseInt(bufferInput, 10) || 0))} style={{ ...primaryBtnStyle(), alignSelf: "flex-start" }}>Zapisz</button>
          </div>

          <div style={{ background: COLORS.panel, border: `1px solid ${capacityPct !== null && capacityPct > 35 ? COLORS.amber : COLORS.line}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Wykorzystanie kalendarza (najbliższe 30 dni)</div>
            {capacityPct === null ? (
              <div style={{ fontSize: 12, color: COLORS.textMuted }}>Brak danych (dodaj zatwierdzonych pracowników).</div>
            ) : (
              <>
                <div style={{ fontSize: 24, fontWeight: 700, color: capacityPct > 35 ? COLORS.amber : COLORS.teal }}>{capacityPct.toFixed(0)}%</div>
                <div style={{ height: 8, borderRadius: 5, background: COLORS.bg, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, capacityPct)}%`, background: capacityPct > 35 ? COLORS.amber : COLORS.teal }} />
                </div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>Próg ostrzegawczy: 35%. Powyżej tego progu dostajesz jednorazowe (raz na dobę) powiadomienie.</div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "backup" && (
        <div style={{ maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Eksport kopii zapasowej</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>Pobiera plik .json ze wszystkimi terminami, uczestnikami i regułami cyklicznymi. Nie zawiera kont użytkowników (te zarządzane są przez logowanie).</div>
            <button onClick={onExportBackup} style={{ ...primaryBtnStyle(), alignSelf: "flex-start" }}>Pobierz kopię zapasową</button>
          </div>
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Import (przywracanie)</div>
            <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
              Przywraca dane z pliku .json do TEJ SAMEJ bazy danych (np. po pomyłce). Wymaga, żeby konta użytkowników z kopii nadal istniały w systemie — to nie jest narzędzie do przenoszenia danych na inny projekt Supabase.
            </div>
            <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} disabled={importBusy}
              style={{ fontSize: 12, color: COLORS.text }} />
            {importMsg && <div style={{ fontSize: 12, color: importMsg.startsWith("Błąd") ? COLORS.rose : COLORS.teal }}>{importMsg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
const ACTIVITY_LABELS = {
  login: "Logowanie", event_created: "Nowy termin", event_updated: "Edycja terminu", event_deleted: "Usunięcie terminu",
  invite_sent: "Zaproszenie", invite_accepted: "Akceptacja", invite_declined: "Odrzucenie",
  join_request_sent: "Prośba o zmianę", join_request_accepted: "Zmiana terminu", join_request_declined: "Odrzucenie prośby",
  profile_updated: "Profil", password_changed: "Zmiana hasła", user_approved: "Zatwierdzenie", user_blocked: "Blokada", role_changed: "Zmiana roli",
  recurring_created: "Reguła cykliczna", recurring_deleted: "Usunięcie reguły",
  buffer_updated: "Bufor czasowy", participant_removed: "Usunięcie uczestnika",
  backup_exported: "Eksport kopii zapasowej", backup_imported: "Import kopii zapasowej",
};
function ActivityBadge({ action }) {
  return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, border: `1px solid ${COLORS.line}`, color: COLORS.textMuted, flexShrink: 0, whiteSpace: "nowrap" }}>{ACTIVITY_LABELS[action] || action}</span>;
}
