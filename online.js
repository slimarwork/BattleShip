'use strict';
/* Онлайн-режим (Firebase). Расстановка игрока не покидает его устройство:
   стреляющий пишет выстрел в комнату, защищающийся сам считает результат и пишет ответ. */

// Вход и сайт должны быть на одном домене, иначе Safari/iPhone блокирует вход.
if (location.hostname.endsWith('.web.app')) {
  location.replace('https://' + location.hostname.replace('.web.app', '.firebaseapp.com') + location.pathname + location.search);
}

let fbUser = null, fbOn = false, role = null, roomRef = null;
let seq = 0, lastShot = 0, lastRes = 0, pending = false;

function fbInit() {
  if (typeof firebase === 'undefined' || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith('ВСТАВЬ')) return false;
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  firebase.auth().onAuthStateChanged(u => { fbUser = u; renderMenu(); });
  firebase.auth().getRedirectResult().catch(e => alert('Не удалось войти: ' + e.message));
  return true;
}
function signIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider).catch(e => {
    // Телефоны часто блокируют всплывающее окно — тогда входим через переход на страницу Google.
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      firebase.auth().signInWithRedirect(provider);
    } else if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
      alert('Не удалось войти: ' + e.message);
    }
  });
}
function renderMenu() {
  $('user').textContent = !fbOn ? 'Онлайн-режим не настроен (заполните firebase-config.js)'
    : fbUser ? 'Вы вошли как ' + (fbUser.displayName || 'игрок') : 'Для игры с другом войдите через Google';
  $('login').hidden = !fbOn;
  $('login').textContent = fbUser ? 'Выйти' : 'Войти через Google';
  $('create').disabled = $('join').disabled = $('code').disabled = !fbUser;
}
const uname = () => fbUser.displayName || 'Игрок';

/* ---------- комнаты ---------- */
async function createRoom() {
  const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[rnd(32)]).join('');
  try {
    await firebase.database().ref('rooms/' + code).set({ host: { uid: fbUser.uid, name: uname() }, phase: 'wait', t: Date.now() });
  } catch (e) { return alert('Не удалось создать комнату: ' + e.message); }
  enter(code, 'host');
}
async function joinRoom(raw) {
  const code = raw.trim().toUpperCase();
  if (!code) return;
  const ref = firebase.database().ref('rooms/' + code);
  try {
    const d = (await ref.get()).val();
    if (!d) return alert('Комната не найдена');
    if (d.host.uid === fbUser.uid) return alert('Это ваша комната: отправьте код другу');
    if (d.guest) return alert('В комнате уже двое игроков');
    await ref.update({ guest: { uid: fbUser.uid, name: uname() }, phase: 'place' });
  } catch (e) { return alert('Ошибка: ' + e.message); }
  enter(code, 'guest');
}
function enter(code, r) {
  role = r; seq = lastShot = lastRes = 0; pending = false;
  roomRef = firebase.database().ref('rooms/' + code);
  G = {
    online: true, code, phase: r === 'host' ? 'lobby' : 'place', turn: 'bot', horiz: true,
    me: newBoard(), bot: newBoard(),
    msg: r === 'host' ? `Комната ${code}. Отправьте код другу и дождитесь его входа…` : ''
  };
  $('enemyWrap').querySelector('h2').textContent = 'Флот соперника';
  showGame(); render();
  roomRef.on('value', onRoom);
}
function leaveRoom() {
  if (roomRef) { roomRef.off(); roomRef.remove().catch(() => {}); }
  roomRef = null; role = null;
}

/* ---------- синхронизация ---------- */
function onRoom(snap) {
  const d = snap.val();
  if (!G || !G.online) return;
  if (!d) { alert('Комната закрыта'); goMenu(); return; }
  seq = d.shot ? d.shot.id : 0;
  const opp = role === 'host' ? d.guest : d.host;
  if (opp) $('enemyWrap').querySelector('h2').textContent = 'Флот: ' + opp.name;
  if (G.phase === 'lobby' && d.guest) G.phase = 'place';
  if (d.shot && d.shot.by !== role && d.shot.id > lastShot) {
    lastShot = d.shot.id;
    setTimeout(() => respond(d.shot), 0);
  }
  if (d.res && d.res.to === role && d.res.id > lastRes) {
    lastRes = d.res.id; pending = false; applyRes(d.res);
  }
  if (G.phase === 'wait' && d.phase === 'play') {
    G.phase = 'play';
    G.msg = d.turn === role ? 'Ваш ход. Нажмите на клетку поля соперника.' : 'Ход соперника…';
  }
  if (d.phase === 'over' && G.phase !== 'over') {
    G.phase = 'over';
    G.msg = d.winner === role ? 'Победа! Вы потопили весь флот соперника.' : 'Поражение: ваш флот потоплен.';
  }
  G.turn = d.turn === role ? 'me' : 'bot';
  if (role === 'host' && d.phase === 'place' && d.ready && d.ready.host && d.ready.guest) {
    roomRef.update({ phase: 'play', turn: 'host' });
  }
  render();
}

function onlineReady() {
  if (G.me.ships.length !== FLEET.length) return;
  G.phase = 'wait'; G.msg = 'Ждём готовности соперника…'; render();
  roomRef.child('ready/' + role).set(true);
}

function onlineFire(r, c) {
  if (G.phase !== 'play' || G.turn !== 'me' || pending || G.bot.shots[r][c] !== 0) return;
  pending = true;
  roomRef.child('shot').set({ by: role, r, c, id: seq + 1 });
}

// Я защищаюсь: считаю результат на своём поле и отвечаю.
function respond(s) {
  const out = shoot(G.me, s.r, s.c);
  if (out.result === 'repeat') return;
  const w = at(s.r, s.c);
  const res = { id: s.id, to: s.by, r: s.r, c: s.c, result: out.result };
  if (out.result === 'sunk') res.cells = G.me.ships[G.me.ids[s.r][s.c]].cells;
  const upd = { res };
  if (allSunk(G.me)) { upd.phase = 'over'; upd.winner = s.by; }
  else if (out.result === 'miss') upd.turn = role;
  G.msg = out.result === 'miss' ? `Соперник: ${w} — мимо. Ваш ход.`
    : `Соперник: ${w} — ${out.result === 'sunk' ? 'убил' : 'ранил'}…`;
  roomRef.update(upd);
  render();
}

// Я стрелял: отмечаю ответ соперника на его поле (видны только выстрелы).
function applyRes(x) {
  const S = G.bot.shots, w = at(x.r, x.c);
  if (x.result === 'miss') { S[x.r][x.c] = 1; G.msg = `${w}: мимо. Ход соперника…`; return; }
  if (x.result === 'hit') { S[x.r][x.c] = 2; G.msg = `${w}: ранил! Стреляйте ещё.`; return; }
  x.cells.forEach(([y, c]) => {
    S[y][c] = 3;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = y + dy, nx = c + dx;
        if (inside(ny, nx) && S[ny][nx] === 0) S[ny][nx] = 1;
      }
    }
  });
  G.msg = `${w}: убил! Стреляйте ещё.`;
}
