import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Calendar as CalIcon, Bell, LogOut, Plus, Check, X, Clock,
  MapPin, Settings, AlertTriangle, Send, ChevronLeft, ChevronRight,
  ShieldCheck, User as UserIcon, Trash2, Pencil, Ban, Loader2, Sun, Moon, Mail, KeyRound
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

// ---------- date helpers ----------
function pad(n) { return String(n).padStart(2, "0"); }
function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfWeek(d) { const date = new Date(d); const day = (date.getDay() + 6) % 7; date.setDate(date.getDate() - day); date.setHours(0, 0, 0, 0); return date; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
const DAY_NAMES = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nie"];
const MONTH_NAMES = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"];
function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function overlaps(aStart, aEnd, bStart, bEnd) { return timeToMin(aStart) < timeToMin(bEnd) && timeToMin(bStart) < timeToMin(aEnd); }
function userColor(userId, profiles) { const u = profiles.find(p => p.id === userId); return u ? u.color : COLORS.textMuted; }
function userName(userId, profiles) { const u = profiles.find(p => p.id === userId); return u ? u.name : "(usunięty)"; }
function buildJoinRequestText(fromName, conflictEvent, draftEvent, message) {
  return `${fromName} pyta, czy możesz zmienić swój termin${conflictEvent ? ` „${conflictEvent.title}” (${conflictEvent.date} ${conflictEvent.start}–${conflictEvent.end})` : ""} i dołączyć do „${draftEvent.title}” (${draftEvent.date} ${draftEvent.start}–${draftEvent.end}${draftEvent.location ? " @ " + draftEvent.location : ""}). Wiadomość: ${message || "—"}`;
}

// ---------- data access (Supabase) ----------
async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at");
  if (error) throw error;
  return data || [];
}
async function fetchEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("*, event_participants(user_id,status)")
    .order("date", { ascending: true }).order("start_time", { ascending: true });
  if (error) throw error;
  return (data || []).map(e => ({
    id: e.id, title: e.title, date: e.date, start: e.start_time, end: e.end_time,
    location: e.location, notes: e.notes, type: e.type, ownerId: e.owner_id,
    participants: (e.event_participants || []).map(p => ({ userId: p.user_id, status: p.status })),
  }));
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

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  const [profiles, setProfiles] = useState([]);
  const [events, setEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);

  const [view, setView] = useState("calendar");
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [filterUserIds, setFilterUserIds] = useState(null);
  const [showNewEvent, setShowNewEvent] = useState(null);
  const [showEditEvent, setShowEditEvent] = useState(null);
  const [showJoinReq, setShowJoinReq] = useState(null);

  const [notifPermission, setNotifPermission] = useState(
    typeof window !== "undefined" && typeof window.Notification !== "undefined" ? window.Notification.permission : "unsupported"
  );
  const seenNotifIds = useRef(null);

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
      const [p, e, n, j] = await Promise.all([fetchProfiles(), fetchEvents(), fetchNotifications(), fetchJoinRequests()]);
      setProfiles(p); setEvents(e); setNotifications(n); setJoinRequests(j);
    } catch (err) { console.error("Błąd wczytywania danych", err); }
  }, []);

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
          try { new window.Notification("Grafik zespołu", { body: n.message }); } catch (e) {}
        }
      }
    });
  }, [notifications, profile, notifPermission]);

  async function requestNotifPermission() {
    if (typeof window === "undefined" || typeof window.Notification === "undefined") { setNotifPermission("unsupported"); return; }
    try { setNotifPermission(await window.Notification.requestPermission()); } catch (e) { setNotifPermission("denied"); }
  }

  function isUserBusy(userId, date, start, end, excludeEventId) {
    return events.some(ev => {
      if (ev.id === excludeEventId || ev.date !== date) return false;
      const p = ev.participants.find(p => p.userId === userId && p.status !== "declined");
      if (!p) return false;
      return overlaps(start, end, ev.start, ev.end);
    });
  }
  function conflictEventFor(userId, date, start, end, excludeEventId) {
    return events.find(ev => {
      if (ev.id === excludeEventId || ev.date !== date) return false;
      const p = ev.participants.find(p => p.userId === userId && p.status !== "declined");
      if (!p) return false;
      return overlaps(start, end, ev.start, ev.end);
    });
  }

  async function pushNotification(userId, type, message, extra) {
    await supabase.from("notifications").insert({ user_id: userId, type, message, event_id: extra?.eventId || null, request_id: extra?.requestId || null });
  }

  // ---------- mutations ----------
  async function createEvent(form) {
    const { data: ev, error } = await supabase.from("events").insert({
      title: form.title, date: form.date, start_time: form.start, end_time: form.end,
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
    setShowNewEvent(null);
    refreshAll();
  }

  async function updateEvent(updated) {
    await supabase.from("events").update({
      title: updated.title, date: updated.date, start_time: updated.start, end_time: updated.end,
      location: updated.location, notes: updated.notes, type: updated.type,
    }).eq("id", updated.id);
    setShowEditEvent(null);
    refreshAll();
  }

  async function deleteEvent(ev) {
    await supabase.from("events").delete().eq("id", ev.id);
    setShowEditEvent(null);
    refreshAll();
  }

  async function inviteToExistingEvent(ev, userId) {
    await supabase.from("event_participants").upsert({ event_id: ev.id, user_id: userId, status: "pending" });
    await pushNotification(userId, "invite", `${profile.name} zaprasza Cię do wspólnej pracy „${ev.title}” — ${ev.date} ${ev.start}–${ev.end}${ev.location ? " @ " + ev.location : ""}.`, { eventId: ev.id });
    refreshAll();
  }

  async function respondToInvite(notif, accept) {
    await supabase.from("event_participants").update({ status: accept ? "accepted" : "declined" }).eq("event_id", notif.eventId).eq("user_id", profile.id);
    const ev = events.find(e => e.id === notif.eventId);
    if (ev) await pushNotification(ev.ownerId, "invite_response", `${profile.name} ${accept ? "zaakceptował(a)" : "odrzucił(a)"} zaproszenie do „${ev.title}” (${ev.date} ${ev.start}–${ev.end}).`);
    await supabase.from("notifications").delete().eq("id", notif.id);
    refreshAll();
  }

  async function sendJoinRequest({ busyUserId, conflictEvent, draftEvent, message }) {
    const { data: jr } = await supabase.from("join_requests").insert({
      from_user_id: profile.id, to_user_id: busyUserId, conflict_event_id: conflictEvent ? conflictEvent.id : null,
      draft_event_id: draftEvent.id, message,
    }).select().single();
    await pushNotification(busyUserId, "join_request", buildJoinRequestText(profile.name, conflictEvent, draftEvent, message), { requestId: jr.id });
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
    await supabase.from("notifications").delete().eq("id", notif.id);
    refreshAll();
  }

  async function markRead(id) { await supabase.from("notifications").update({ read: true }).eq("id", id); refreshAll(); }
  async function dismissNotification(id) { await supabase.from("notifications").delete().eq("id", id); refreshAll(); }

  async function updateOwnProfile(fields) {
    const { name, color, theme } = fields;
    await supabase.from("profiles").update({ name, color, theme }).eq("id", profile.id);
    setProfile(p => ({ ...p, ...fields }));
  }
  async function changePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return error ? error.message : null;
  }

  async function adminSetApproved(userId, approved) { await supabase.from("profiles").update({ approved }).eq("id", userId); refreshAll(); }
  async function adminSetRole(userId, role) { await supabase.from("profiles").update({ role }).eq("id", userId); refreshAll(); }
  async function adminSendPasswordReset(email) {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  }

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
      <style>{FONT_IMPORT}</style>
      <TopNav
        profile={profile} view={view} setView={setView} unreadCount={unreadCount} pendingCount={pendingCount}
        onLogout={() => supabase.auth.signOut()}
        onToggleTheme={() => updateOwnProfile({ theme: profile.theme === "light" ? "dark" : "light" })}
        notifPermission={notifPermission} onRequestNotifPermission={requestNotifPermission}
      />
      <div style={{ flex: 1, padding: "16px 20px 28px" }}>
        {view === "calendar" && (
          <CalendarView
            profiles={profiles} events={events} profile={profile}
            weekStart={weekStart} setWeekStart={setWeekStart}
            filterUserIds={filterUserIds} setFilterUserIds={setFilterUserIds}
            onNewEvent={(date) => setShowNewEvent({ date })}
            onEditEvent={(ev) => setShowEditEvent(ev)}
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
            profiles={profiles} events={events}
            onSetApproved={adminSetApproved} onSetRole={adminSetRole}
            onSendPasswordReset={adminSendPasswordReset}
            onDeleteEvent={deleteEvent} onEditEvent={(ev) => setShowEditEvent(ev)}
          />
        )}
      </div>

      {showNewEvent && (
        <EventModal mode="new" profiles={profiles} profile={profile} defaultDate={showNewEvent.date}
          onClose={() => setShowNewEvent(null)} isUserBusy={isUserBusy} conflictEventFor={conflictEventFor}
          onSubmit={createEvent} />
      )}
      {showEditEvent && (
        <EventModal mode="edit" profiles={profiles} profile={profile} existing={showEditEvent}
          onClose={() => setShowEditEvent(null)} isUserBusy={isUserBusy} conflictEventFor={conflictEventFor}
          onSubmit={updateEvent} onDelete={deleteEvent} onInviteUser={inviteToExistingEvent}
          onRequestJoin={(busyUserId, conflictEvent, draftEvent) => setShowJoinReq({ busyUserId, conflictEvent, draftEvent })} />
      )}
      {showJoinReq && <JoinRequestModal profiles={profiles} data={showJoinReq} onClose={() => setShowJoinReq(null)} onSend={sendJoinRequest} />}
    </div>
  );
}

function CenteredMessage({ text }) {
  return (
    <div style={{ background: COLORS.bg, minHeight: 520, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.textMuted, fontFamily: "Inter, sans-serif" }}>
      <style>{FONT_IMPORT}</style>
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
      <style>{FONT_IMPORT}</style>
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
      <style>{FONT_IMPORT}</style>
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
      <style>{FONT_IMPORT}</style>
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
function TopNav({ profile, view, setView, unreadCount, pendingCount, onLogout, onToggleTheme, notifPermission, onRequestNotifPermission }) {
  const Tab = ({ id, icon: Icon, label, badge }) => (
    <button onClick={() => setView(id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 9, background: view === id ? COLORS.panel2 : "transparent", border: "none", color: view === id ? COLORS.text : COLORS.textMuted, cursor: "pointer", fontSize: 13.5, fontWeight: 500, position: "relative" }}>
      <Icon size={16} /> {label}
      {badge > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: COLORS.rose, color: "#fff", fontSize: 10, borderRadius: 8, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{badge}</span>}
    </button>
  );
  const isLight = profile.theme === "light";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 20px", borderBottom: `1px solid ${COLORS.line}`, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 12 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: COLORS.amber, display: "flex", alignItems: "center", justifyContent: "center" }}><CalIcon size={15} color="#12141C" /></div>
        <span style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 15 }}>Grafik zespołu</span>
      </div>
      <Tab id="calendar" icon={CalIcon} label="Kalendarz" />
      <Tab id="notifications" icon={Bell} label="Powiadomienia" badge={unreadCount} />
      <Tab id="profile" icon={UserIcon} label="Mój profil" />
      {profile.role === "admin" && <Tab id="admin" icon={Settings} label="Panel admina" badge={pendingCount} />}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {notifPermission !== "granted" && notifPermission !== "unsupported" && (
          <button onClick={onRequestNotifPermission} title="Włącz powiadomienia przeglądarki" style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.amber}`, background: "transparent", color: COLORS.amber, cursor: "pointer", fontSize: 11.5 }}>
            <Bell size={13} /> Włącz powiadomienia
          </button>
        )}
        <button onClick={onToggleTheme} title={isLight ? "Ciemny motyw" : "Jasny motyw"} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: "transparent", color: COLORS.textMuted, cursor: "pointer", fontSize: 11.5 }}>
          {isLight ? <Moon size={14} /> : <Sun size={14} />} {isLight ? "Ciemny" : "Jasny"}
        </button>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: COLORS.textMuted }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: profile.color }} /> {profile.name}
        </span>
        <button onClick={onLogout} title="Wyloguj" style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", display: "flex" }}><LogOut size={16} /></button>
      </div>
    </div>
  );
}

// ================= CALENDAR =================
function CalendarView({ profiles, events, profile, weekStart, setWeekStart, filterUserIds, setFilterUserIds, onNewEvent, onEditEvent }) {
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));
  const activeFilter = filterUserIds || profiles.map(u => u.id);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={navBtnStyle()}><ChevronLeft size={16} /></button>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={navBtnStyle()}><ChevronRight size={16} /></button>
        <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={{ ...navBtnStyle(), fontSize: 12, padding: "6px 10px" }}>Dziś</button>
        <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 600, fontSize: 15, marginLeft: 4 }}>
          {days[0].getDate()} {MONTH_NAMES[days[0].getMonth()]} – {days[6].getDate()} {MONTH_NAMES[days[6].getMonth()]} {days[6].getFullYear()}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
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
        <button onClick={() => onNewEvent(toISODate(new Date()))} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, border: "none", background: COLORS.amber, color: "#12141C", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          <Plus size={15} /> Nowy termin
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(140px, 1fr))", gap: 10, overflowX: "auto" }}>
        {days.map(day => {
          const iso = toISODate(day);
          const isToday = iso === toISODate(new Date());
          const dayEvents = events.filter(e => e.date === iso).filter(e => e.participants.some(p => activeFilter.includes(p.userId) && p.status !== "declined")).sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
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
    </div>
  );
}
function navBtnStyle() { return { background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "6px 8px", color: COLORS.text, cursor: "pointer", display: "flex" }; }

function EventCard({ ev, profiles, onClick }) {
  const ownerColor = userColor(ev.ownerId, profiles);
  const isBlock = ev.type === "block";
  return (
    <div onClick={onClick} style={{ cursor: "pointer", borderRadius: 8, padding: "7px 9px", background: COLORS.bg, border: `1px solid ${COLORS.line}`, borderLeftWidth: 3, borderLeftColor: ownerColor }}>
      <div style={{ fontSize: 11, color: COLORS.textMuted, display: "flex", alignItems: "center", gap: 4 }}><Clock size={10} /> {ev.start}–{ev.end}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, margin: "2px 0", color: isBlock ? COLORS.textMuted : COLORS.text, fontStyle: isBlock ? "italic" : "normal" }}>{isBlock ? "🚫 " : ""}{ev.title}</div>
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
function EventModal({ mode, profiles, profile, defaultDate, existing, onClose, onSubmit, onDelete, isUserBusy, conflictEventFor, onInviteUser, onRequestJoin }) {
  const [form, setForm] = useState(() => existing ? {
    title: existing.title, date: existing.date, start: existing.start, end: existing.end,
    location: existing.location || "", notes: existing.notes || "", type: existing.type,
    participantIds: [], pendingJoinUserIds: [], joinMessage: "",
  } : { title: "", date: defaultDate, start: "09:00", end: "10:00", location: "", notes: "", type: "work", participantIds: [], pendingJoinUserIds: [], joinMessage: "" });

  const canEdit = mode === "new" || profile.role === "admin" || (existing && existing.ownerId === profile.id);
  const others = profiles.filter(u => u.id !== profile.id);

  function toggleParticipant(uid) { setForm(f => ({ ...f, participantIds: f.participantIds.includes(uid) ? f.participantIds.filter(id => id !== uid) : [...f.participantIds, uid] })); }
  function togglePendingJoin(uid) { setForm(f => ({ ...f, pendingJoinUserIds: f.pendingJoinUserIds.includes(uid) ? f.pendingJoinUserIds.filter(id => id !== uid) : [...f.pendingJoinUserIds, uid] })); }
  function busyCheck(uid) { return isUserBusy(uid, form.date, form.start, form.end, existing ? existing.id : null); }

  function submit() {
    if (!form.title.trim() || !form.date || !form.start || !form.end) return;
    if (existing) onSubmit({ ...existing, ...form });
    else onSubmit(form);
  }

  return (
    <ModalShell onClose={onClose} title={mode === "new" ? "Nowy termin" : "Szczegóły terminu"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Rodzaj">
          <div style={{ display: "flex", gap: 8 }}>
            <ChoiceBtn active={form.type === "work"} onClick={() => setForm(f => ({ ...f, type: "work" }))} disabled={!canEdit}>Wspólna praca</ChoiceBtn>
            <ChoiceBtn active={form.type === "block"} onClick={() => setForm(f => ({ ...f, type: "block", participantIds: [] }))} disabled={!canEdit}>Moja niedostępność</ChoiceBtn>
          </div>
        </Field>
        <Field label="Tytuł"><Input value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} disabled={!canEdit} placeholder="np. Instalacja u klienta X" /></Field>
        <div style={{ display: "flex", gap: 8 }}>
          <Field label="Data" style={{ flex: 1 }}><Input type="date" value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} disabled={!canEdit} /></Field>
          <Field label="Od" style={{ flex: 1 }}><Input type="time" value={form.start} onChange={v => setForm(f => ({ ...f, start: v }))} disabled={!canEdit} /></Field>
          <Field label="Do" style={{ flex: 1 }}><Input type="time" value={form.end} onChange={v => setForm(f => ({ ...f, end: v }))} disabled={!canEdit} /></Field>
        </div>
        {form.type === "work" && <Field label="Lokalizacja"><Input value={form.location} onChange={v => setForm(f => ({ ...f, location: v }))} disabled={!canEdit} placeholder="adres / miejsce" /></Field>}
        <Field label="Notatki"><Input value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} disabled={!canEdit} placeholder="opcjonalnie" /></Field>

        {form.type === "work" && mode === "new" && (
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
                    {busy && <span style={{ fontSize: 10.5, color: COLORS.rose, display: "flex", alignItems: "center", gap: 3 }}><Ban size={11} /> zajęty(a) — zaznacz, aby wysłać prośbę o zmianę</span>}
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
                          style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 6, border: `1px solid ${COLORS.amber}`, background: "transparent", color: COLORS.amber, cursor: "pointer" }}>Wyślij prośbę</button>
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
                  {userName(p.userId, profiles)} — <span style={{ color: p.status === "accepted" ? COLORS.teal : p.status === "declined" ? COLORS.rose : COLORS.amber }}>{p.status === "accepted" ? "potwierdził(a)" : p.status === "declined" ? "odrzucił(a) / zajęty(a)" : "oczekuje"}</span>
                </div>
              ))}
            </div>
          </Field>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          {canEdit && <button onClick={submit} style={primaryBtnStyle()}>{mode === "new" ? "Utwórz termin" : "Zapisz zmiany"}</button>}
          {existing && (profile.role === "admin" || existing.ownerId === profile.id) && (
            <button onClick={() => onDelete(existing)} style={{ ...secondaryBtnStyle(), color: COLORS.rose, borderColor: COLORS.rose }}><Trash2 size={14} /> Usuń</button>
          )}
          <button onClick={onClose} style={{ ...secondaryBtnStyle(), marginLeft: "auto" }}>Zamknij</button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children, style }) { return <div style={style}><div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4, fontWeight: 500 }}>{label}</div>{children}</div>; }
function Input({ value, onChange, type = "text", placeholder, disabled }) {
  return <input type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={e => onChange(e.target.value)}
    style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, background: disabled ? COLORS.panel2 : COLORS.bg, color: COLORS.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />;
}
function ChoiceBtn({ active, onClick, children, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ flex: 1, padding: "7px 10px", borderRadius: 8, fontSize: 12.5, cursor: disabled ? "default" : "pointer", border: `1px solid ${active ? COLORS.amber : COLORS.line}`, background: active ? COLORS.amber + "22" : "transparent", color: active ? COLORS.text : COLORS.textMuted }}>{children}</button>;
}
function primaryBtnStyle() { return { padding: "9px 16px", borderRadius: 9, border: "none", background: COLORS.amber, color: "#12141C", fontWeight: 600, fontSize: 13, cursor: "pointer" }; }
function secondaryBtnStyle() { return { padding: "9px 14px", borderRadius: 9, border: `1px solid ${COLORS.line}`, background: "transparent", color: COLORS.text, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }; }

function ModalShell({ onClose, title, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#00000099", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxHeight: "85vh", overflowY: "auto", background: COLORS.panel, border: `1px solid ${COLORS.line}`, borderRadius: 14, padding: 20, fontFamily: "Inter, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 16 }}>{title}</div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer" }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ================= JOIN REQUEST MODAL =================
function JoinRequestModal({ profiles, data, onClose, onSend }) {
  const [message, setMessage] = useState("");
  const busyUser = profiles.find(u => u.id === data.busyUserId);
  return (
    <ModalShell onClose={onClose} title="Prośba o zmianę terminu">
      <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
        <b style={{ color: COLORS.text }}>{busyUser?.name}</b> ma już zaplanowany termin w tym czasie. Możesz wysłać prośbę z pytaniem, czy może zmienić swój termin i dołączyć do Twojego.
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
                {(n.type === "invite_response" || n.type === "join_response" || n.type === "info") && (
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
  const map = { invite: <Bell size={15} color={COLORS.amber} />, join_request: <AlertTriangle size={15} color={COLORS.rose} />, invite_response: <Check size={15} color={COLORS.teal} />, join_response: <Check size={15} color={COLORS.teal} />, info: <Bell size={15} color={COLORS.textMuted} /> };
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
function AdminPanel({ profiles, events, onSetApproved, onSetRole, onSendPasswordReset, onDeleteEvent, onEditEvent }) {
  const [tab, setTab] = useState("team");
  const pending = profiles.filter(p => !p.approved);
  const approved = profiles.filter(p => p.approved);
  const upcoming = events.slice().sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  return (
    <div style={{ maxWidth: 780 }}>
      <div style={{ fontFamily: "Space Grotesk, sans-serif", fontWeight: 700, fontSize: 18, marginBottom: 14 }}>Panel admina</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[["team", `Zespół${pending.length ? ` (${pending.length} oczekuje)` : ""}`], ["events", "Wszystkie terminy"]].map(([id, label]) => (
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
    </div>
  );
}
