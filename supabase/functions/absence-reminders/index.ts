// Edge Function Supabase : rappel automatique « pense à indiquer ton absence ».
// Appelée chaque heure par pg_cron (en-tête x-cron-key, vérifié par reminder_key_ok).
// Pour chaque ligue où le réglage absenceReminderDays (1 à 7) est actif : si une session
// tombe dans N jours (jour de jeu, saison, dates bloquées) et que l'heure d'envoi choisie
// (absenceReminderHour, heure du Québec) est passée, les joueurs de la ligue qui n'ont pas
// déjà indiqué d'absence reçoivent un rappel (push + cloche). Un seul envoi par session,
// noté dans league_reminders_sent. { dry: true } calcule sans rien envoyer.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const TZ = 'America/Toronto';
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function localNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false }).formatToParts(new Date());
  const g = (t: string) => (parts.find((p) => p.type === t) || { value: '0' }).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: parseInt(g('hour'), 10) % 24 };
}
function addDays(ds: string, n: number) {
  const d = new Date(ds + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(ds: string) { return new Date(ds + 'T12:00:00Z').getUTCDay(); }
function frDate(ds: string) { const d = new Date(ds + 'T12:00:00Z'); return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`; }
function frTime(t: unknown) { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? `${parseInt(m[1], 10)} h ${m[2]}` : ''; }

// deno-lint-ignore no-explicit-any
function isPlayDate(data: any, ds: string) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  // Une session déjà créée à cette date compte toujours.
  if (sessions.some((s: { date?: string }) => s && s.date === ds)) return true;
  if (typeof data.playDayOfWeek !== 'number' || dow(ds) !== data.playDayOfWeek) return false;
  if (data.seasonStartDate && ds < data.seasonStartDate) return false;
  if (data.seasonEndDate && ds > data.seasonEndDate) return false;
  if (Array.isArray(data.blockedDates) && data.blockedDates.includes(ds)) return false;
  return true;
}

// deno-lint-ignore no-explicit-any
function expectedPlayers(data: any, ds: string): string[] {
  const rec = data.leagueFormat === 'social' || data.leagueType === 'recreational';
  const sess = (Array.isArray(data.sessions) ? data.sessions : []).find((s: { date?: string }) => s && s.date === ds);
  const absent = new Set<string>(sess && Array.isArray(sess.absences) ? sess.absences : []);
  (Array.isArray(data.plannedAbsences) ? data.plannedAbsences : []).forEach((a: { playerId: string; startDate: string; endDate?: string }) => {
    if (a && a.playerId && a.startDate <= ds && (a.endDate || a.startDate) >= ds) absent.add(a.playerId);
  });
  return (Array.isArray(data.players) ? data.players : [])
    .filter((p: { id: string; groupId?: string | null; injured?: boolean }) => p && p.id && !p.injured && (rec || p.groupId) && !absent.has(p.id))
    .map((p: { id: string }) => p.id);
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const key = req.headers.get('x-cron-key') || '';
    const { data: ok } = await supabase.rpc('reminder_key_ok', { k: key });
    if (ok !== true) return json({ error: 'Non autorisé' }, 401);
    let body: { dry?: boolean; league_id?: string; date?: string; hour?: number; days?: number } = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const dry = body.dry === true;
    const now = localNow();
    if (dry && body.date) now.date = body.date;
    if (dry && typeof body.hour === 'number') now.hour = body.hour;

    let q = supabase.from('league_data').select('league_id, data');
    if (body.league_id) q = q.eq('league_id', body.league_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    const report: unknown[] = [];

    for (const row of rows || []) {
      const data = row.data || {};
      const days = dry && body.days ? body.days : parseInt(String(data.absenceReminderDays || 0), 10);
      if (!(days >= 1 && days <= 7) || data.testMode === true) continue;
      const hour = Number.isFinite(parseInt(String(data.absenceReminderHour), 10)) ? parseInt(String(data.absenceReminderHour), 10) : 18;
      const target = addDays(now.date, days);
      const entry: Record<string, unknown> = { league: row.league_id, target, hour };
      if (now.hour < hour) { entry.skip = 'trop tôt'; report.push(entry); continue; }
      if (!isPlayDate(data, target)) { entry.skip = 'pas de session'; report.push(entry); continue; }
      const { data: done } = await supabase.from('league_reminders_sent').select('sent_at').eq('league_id', row.league_id).eq('session_date', target).eq('kind', 'absence').maybeSingle();
      if (done) { entry.skip = 'déjà envoyé'; report.push(entry); continue; }

      const playerIds = expectedPlayers(data, target);
      const { data: links } = playerIds.length
        ? await supabase.from('profile_players').select('profile_id, player_id').eq('league_id', row.league_id).is('substitute_id', null).in('player_id', playerIds)
        : { data: [] };
      let ids = [...new Set((links || []).map((l: { profile_id: string }) => l.profile_id).filter(Boolean))];
      entry.joueurs = playerIds.length; entry.comptes = ids.length;
      if (dry) { entry.dry = true; report.push(entry); continue; }

      // Réserve l'envoi avant d'envoyer : jamais deux rappels pour la même session.
      const { error: insErr } = await supabase.from('league_reminders_sent').insert({ league_id: row.league_id, session_date: target, kind: 'absence', recipients: ids.length });
      if (insErr) { entry.skip = 'déjà réservé'; report.push(entry); continue; }

      // Préférences : type « sessions de ligue » désactivé = rien ; heures calmes = cloche seulement.
      const { data: prefRows } = ids.length ? await supabase.from('notification_prefs').select('*').in('profile_id', ids) : { data: [] };
      const prefs = new Map<string, Record<string, unknown>>((prefRows || []).map((p: Record<string, unknown>) => [p.profile_id as string, p]));
      ids = ids.filter((id) => { const p = prefs.get(id); return !(p && p.league_sessions === false); });
      const pushIds = ids.filter((id) => {
        const p = prefs.get(id);
        if (!p || !p.quiet_enabled) return true;
        const st = (p.quiet_start as number) ?? 22, en = (p.quiet_end as number) ?? 7;
        return !(st <= en ? (now.hour >= st && now.hour < en) : (now.hour >= st || now.hour < en));
      });

      const when = days === 1 ? 'demain' : frDate(target);
      const time = frTime(data.playTime);
      const title = `Rappel : session ${days === 1 ? 'de demain' : 'du ' + frDate(target)}`;
      const msg = `${data.leagueName ? data.leagueName + ' · ' : ''}Ta session est ${when}${time ? ' à ' + time : ''}. Tu ne pourras pas être là ? Indique ton absence dans Dinkeo dès maintenant.`;
      const url = '/?go=' + encodeURIComponent('league:' + row.league_id);

      if (ids.length) {
        const { error: inboxErr } = await supabase.from('notif_inbox').insert(ids.map((id) => ({ profile_id: id, title, body: msg, url, kind: 'league_sessions' })));
        if (inboxErr) console.error('historique', inboxErr.message);
      }
      let sent = 0; const stale: string[] = [];
      if (pushIds.length) {
        const { data: subs } = await supabase.from('push_subscriptions').select('*').in('profile_id', pushIds);
        const payload = JSON.stringify({ title, body: msg, url });
        await Promise.all((subs || []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'normal' }); sent++; }
          catch (e) { const c = (e as { statusCode?: number })?.statusCode; if (c === 410 || c === 404) stale.push(s.id); else console.error('Erreur envoi push', e); }
        }));
        if (stale.length) await supabase.from('push_subscriptions').delete().in('id', stale);
      }
      entry.historique = ids.length; entry.envoyes = sent;
      report.push(entry);
    }
    console.log('rappels absence', JSON.stringify({ now, dry, report }));
    return json({ now, dry, report });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
