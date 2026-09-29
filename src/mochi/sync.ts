import { supabase, supabaseConfigured } from '@/lib/supabase';

/**
 * Local-first sync between the Mochi page (WebView) and Supabase.
 *
 * The page keeps its own saved game in the WebView's localStorage, so it always opens instantly.
 * This side signs the player in (as a guest until they add an email), mirrors the game to Supabase
 * in the background, and keeps an outbox of session events and the friends board on the device
 * (expo-sqlite localStorage), so nothing is lost offline and friends show up before the network does.
 */

type SessionOp =
  | { kind: 'start'; id: string; minutes: number; day: string }
  | { kind: 'finish'; id: string }
  | { kind: 'abandon'; id: string };

type Profile = { look: unknown; equip: unknown; cozy: number; petName?: string; name?: string };
type Pending = { state: unknown; ts: number; profile?: Profile };

export type PageMessage =
  | { type: 'hello'; state: unknown; ts: number }
  | { type: 'state'; state: unknown; ts: number; profile?: Profile }
  | { type: 'session'; op: 'start' | 'finish' | 'abandon'; id: string; minutes?: number; day?: string }
  | { type: 'friends:refresh' }
  | { type: 'friend:add'; code: string; req: string }
  | { type: 'friend:remove'; id: string; req: string }
  | { type: 'account:link'; email: string; req: string }
  | { type: 'account:verify'; email: string; code: string; req: string }
  | { type: 'account:signin'; email: string; req: string }
  | { type: 'account:signinVerify'; email: string; code: string; req: string };

const K = { outbox: 'mochi-outbox', pending: 'mochi-pending-state', board: 'mochi-board', account: 'mochi-account' };
const PUSH_DELAY = 1500;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// a server error (bad input, rule broken) has a Postgres code; a network failure doesn't, so it's worth retrying
const isServerError = (e: { code?: string } | null) => !!e?.code;

export function createMochiSync(inject: (js: string) => void) {
  let localTs = 0;
  let ready = false;          // signed in
  let busy = false;           // an outbox flush is running
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  const call = (fn: string, ...args: unknown[]) =>
    inject(`window.mochiNative && window.mochiNative.${fn}(${args.map((a) => JSON.stringify(a ?? null)).join(',')}); true;`);
  const reply = (req: string, ok: boolean, error?: string) => call('reply', req, ok, error ?? null);

  async function ensureAuth() {
    if (!supabaseConfigured) return false;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) return false;
    }
    ready = true;
    await sendAccount();
    return true;
  }

  async function sendAccount() {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;
    let account = read<{ inviteCode?: string }>(K.account, {});
    const { data: prof } = await supabase.from('profiles').select('invite_code').eq('id', user.id).maybeSingle();
    account = {
      ...account,
      inviteCode: prof?.invite_code ?? account.inviteCode,
    };
    const full = { ...account, email: user.email ?? null, isGuest: !!user.is_anonymous, signedIn: true };
    write(K.account, full);
    call('setAccount', full);
  }

  /** On launch: take the server's copy if it's newer (e.g. a new phone), otherwise upload ours. */
  async function pull(force = false) {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { data, error } = await supabase
      .from('game_state')
      .select('state, client_updated_at')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (error || !data) return;
    const serverTs = Date.parse(data.client_updated_at);
    const hasState = data.state && Object.keys(data.state as object).length > 0;
    if (hasState && (force || serverTs > localTs)) {
      localTs = serverTs;
      write(K.pending, null);
      call('loadState', data.state, serverTs);
    } else if (localTs > serverTs) {
      schedulePush(0);
    }
  }

  function schedulePush(delay = PUSH_DELAY) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, delay);
  }

  async function push() {
    const pending = read<Pending | null>(K.pending, null);
    if (!pending || !ready) return;
    const { error } = await supabase.rpc('save_game_state', {
      p_state: pending.state,
      p_client_updated_at: new Date(pending.ts).toISOString(),
    });
    if (error && !isServerError(error)) return; // offline: keep it for later
    if (pending.profile) {
      const p = pending.profile;
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase
          .from('profiles')
          .update({
            look: p.look,
            equip: p.equip,
            cozy_score: Math.round(p.cozy || 0),
            pet_name: p.petName || 'Mochi',
            display_name: p.name || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', auth.user.id);
      }
    }
    // clear only if nothing newer arrived meanwhile
    const now = read<Pending | null>(K.pending, null);
    if (now && now.ts === pending.ts) write(K.pending, null);
  }

  async function flushOutbox() {
    if (!ready || busy) return;
    busy = true;
    try {
      let box = read<SessionOp[]>(K.outbox, []);
      while (box.length) {
        const op = box[0];
        const { error } =
          op.kind === 'start'
            ? await supabase.rpc('start_session', { p_id: op.id, p_minutes: op.minutes, p_local_day: op.day })
            : op.kind === 'finish'
              ? await supabase.rpc('finish_session', { p_id: op.id })
              : await supabase.rpc('abandon_session', { p_id: op.id });
        if (error && !isServerError(error)) break; // offline: try again later
        box = read<SessionOp[]>(K.outbox, []).slice(1);
        write(K.outbox, box);
      }
    } finally {
      busy = false;
    }
    refreshBoard();
  }

  async function refreshBoard() {
    if (!ready) return;
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const { data, error } = await supabase.rpc('friend_board', { p_from: dayKey(from) });
    if (error || !data) return;
    const board = { rows: data, at: Date.now() };
    write(K.board, board);
    call('setBoard', board.rows);
  }

  async function sync() {
    if (!ready && !(await ensureAuth())) return;
    await flushOutbox();
    await push();
  }

  async function onMessage(msg: PageMessage) {
    switch (msg.type) {
      case 'hello': {
        localTs = msg.ts || 0;
        // show cached friends and account right away, then go online
        const board = read<{ rows: unknown[] } | null>(K.board, null);
        if (board) call('setBoard', board.rows);
        const account = read<object | null>(K.account, null);
        if (account) call('setAccount', account);
        if (!supabaseConfigured) return;
        if (await ensureAuth()) {
          await pull();
          await sync();
        }
        return;
      }
      case 'state':
        localTs = msg.ts;
        write(K.pending, { state: msg.state, ts: msg.ts, profile: msg.profile });
        schedulePush();
        return;
      case 'session': {
        const op: SessionOp =
          msg.op === 'start'
            ? { kind: 'start', id: msg.id, minutes: msg.minutes ?? 25, day: msg.day ?? dayKey() }
            : { kind: msg.op, id: msg.id };
        write(K.outbox, [...read<SessionOp[]>(K.outbox, []), op]);
        flushOutbox();
        return;
      }
      case 'friends:refresh':
        refreshBoard();
        return;
      case 'friend:add': {
        if (!ready && !(await ensureAuth())) return reply(msg.req, false, "You're offline. Try again when you're connected.");
        const { error } = await supabase.rpc('add_friend', { p_code: msg.code });
        if (error) return reply(msg.req, false, isServerError(error) ? error.message : "You're offline. Try again when you're connected.");
        reply(msg.req, true);
        refreshBoard();
        return;
      }
      case 'friend:remove': {
        const { error } = await supabase.rpc('remove_friend', { p_friend: msg.id });
        reply(msg.req, !error, error?.message);
        refreshBoard();
        return;
      }
      case 'account:link': {
        // a guest adds an email: Supabase emails a 6-digit code
        const { error } = await supabase.auth.updateUser({ email: msg.email });
        return reply(msg.req, !error, error?.message);
      }
      case 'account:verify': {
        const { error } = await supabase.auth.verifyOtp({ email: msg.email, token: msg.code, type: 'email_change' });
        if (!error) await sendAccount();
        return reply(msg.req, !error, error?.message);
      }
      case 'account:signin': {
        // an existing player on a new phone
        const { error } = await supabase.auth.signInWithOtp({ email: msg.email, options: { shouldCreateUser: false } });
        return reply(msg.req, !error, error?.message);
      }
      case 'account:signinVerify': {
        const { error } = await supabase.auth.verifyOtp({ email: msg.email, token: msg.code, type: 'email' });
        if (error) return reply(msg.req, false, error.message);
        write(K.outbox, []);
        write(K.pending, null);
        write(K.board, null);
        ready = true;
        await sendAccount();
        await pull(true); // their saved game replaces this phone's guest game
        await refreshBoard();
        return reply(msg.req, true);
      }
    }
  }

  const interval = setInterval(sync, 30000);

  return {
    onMessage,
    /** the app came back to the foreground */
    onActive: () => {
      sync();
    },
    dispose: () => {
      clearInterval(interval);
      clearTimeout(pushTimer);
    },
  };
}
