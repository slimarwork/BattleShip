'use strict';
/* Интерфейс и ход партии. Правила — в logic.js. */

const KEY = 'morskoy-boy-v1';
const NAMES = { 4: 'четырёхпалубный', 3: 'трёхпалубный', 2: 'двухпалубный', 1: 'однопалубный' };
const $ = id => document.getElementById(id);
const at = (r, c) => LETTERS[c] + (r + 1);

let G, timer;

const fresh = () => ({ phase: 'place', turn: 'me', horiz: true, me: newBoard(), bot: randomFleet(), msg: '' });

function save() {
  if (G && G.online) return;
  try { localStorage.setItem(KEY, JSON.stringify(G)); } catch (e) { /* хранилище недоступно */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    return d && d.me && d.bot && d.phase ? d : null;
  } catch (e) { return null; }
}

/* ---------- отрисовка ---------- */
function drawBoard(el, b, own) {
  const over = G.phase === 'over';
  let h = '<span class="lbl"></span>' + LETTERS.map(l => `<span class="lbl">${l}</span>`).join('');
  for (let r = 0; r < SIZE; r++) {
    h += `<span class="lbl">${r + 1}</span>`;
    for (let c = 0; c < SIZE; c++) {
      const s = b.shots[r][c];
      let k = 'cell';
      if (s === 1) k += ' miss';
      else if (s === 2) k += ' hit';
      else if (s === 3) k += ' sunk';
      else if (b.ids[r][c] !== -1 && (own || over)) k += ' ship';
      const off = own ? G.phase !== 'place' : G.phase !== 'play' || s !== 0;
      h += `<button class="${k}" data-r="${r}" data-c="${c}" aria-label="${at(r, c)}"${off ? ' disabled' : ''}></button>`;
    }
  }
  el.innerHTML = h;
}

function render() {
  const placing = G.phase === 'place';
  const placed = G.me.ships.length, full = placed === FLEET.length;
  document.body.dataset.phase = G.phase;
  if (placing) {
    G.msg = full
      ? 'Флот готов. Нажмите «В бой».'
      : `Поставьте ${NAMES[FLEET[placed]]} корабль (${FLEET[placed]} кл.): нажмите на клетку вашего поля`;
  }
  $('msg').textContent = G.msg;
  $('count').textContent = placing
    ? `Расставлено: ${placed} из ${FLEET.length}`
    : G.online ? `Комната ${G.code} · Ваши корабли: ${alive(G.me)}`
      : `Ваши корабли: ${alive(G.me)} · Корабли соперника: ${alive(G.bot)}`;
  $('auto').hidden = $('rot').hidden = $('clear').hidden = !placing;
  $('start').hidden = !(placing && full);
  $('rot').textContent = 'Повернуть: ' + (G.horiz ? 'горизонтально' : 'вертикально');
  $('start').textContent = G.online ? 'Готов' : 'В бой';
  $('new').hidden = !!G.online;
  $('enemyWrap').classList.toggle('off', placing);
  $('enemy').classList.toggle('active', G.phase === 'play' && G.turn === 'me');
  drawBoard($('me'), G.me, true);
  drawBoard($('enemy'), G.bot, false);
}

/* ---------- расстановка ---------- */
function clearPreview() {
  document.querySelectorAll('.pv-ok,.pv-bad').forEach(el => el.classList.remove('pv-ok', 'pv-bad'));
}
function preview(r, c) {
  clearPreview();
  if (G.phase !== 'place' || G.me.ships.length >= FLEET.length) return;
  const len = FLEET[G.me.ships.length];
  const ok = canPlace(G.me, r, c, len, G.horiz);
  shipCells(r, c, len, G.horiz).forEach(([y, x]) => {
    const el = document.querySelector(`#me [data-r="${y}"][data-c="${x}"]`);
    if (el) el.classList.add(ok ? 'pv-ok' : 'pv-bad');
  });
}
function placeAt(r, c) {
  if (G.phase !== 'place' || G.me.ships.length >= FLEET.length) return;
  const len = FLEET[G.me.ships.length];
  if (!canPlace(G.me, r, c, len, G.horiz)) {
    $('msg').textContent = 'Сюда нельзя: корабль выходит за поле или касается другого.';
    return;
  }
  place(G.me, r, c, len, G.horiz);
  save(); render();
}
function rotate() {
  if (!G || G.phase !== 'place') return;
  G.horiz = !G.horiz;
  save(); render();
}

/* ---------- ходы ---------- */
function fire(r, c) {
  if (G.phase !== 'play' || G.turn !== 'me') return;
  const res = shoot(G.bot, r, c);
  if (res.result === 'repeat') return;
  const w = at(r, c);
  if (allSunk(G.bot)) {
    G.phase = 'over';
    G.msg = 'Победа! Вы потопили весь флот соперника.';
  } else if (res.result === 'miss') {
    G.turn = 'bot';
    G.msg = `${w}: мимо. Ход соперника…`;
    timer = setTimeout(botTurn, 700);
  } else {
    G.msg = `${w}: ${res.result === 'sunk' ? 'убил' : 'ранил'}! Стреляйте ещё.`;
  }
  save(); render();
}

function botTurn() {
  if (G.phase !== 'play' || G.turn !== 'bot') return;
  const [r, c] = botPick(G.me);
  const res = shoot(G.me, r, c);
  const w = at(r, c);
  if (allSunk(G.me)) {
    G.phase = 'over';
    G.msg = `Соперник: ${w} — убил. Поражение: ваш флот потоплен.`;
  } else if (res.result === 'miss') {
    G.turn = 'me';
    G.msg = `Соперник: ${w} — мимо. Ваш ход.`;
  } else {
    G.msg = `Соперник: ${w} — ${res.result === 'sunk' ? 'убил' : 'ранил'}…`;
    timer = setTimeout(botTurn, 800);
  }
  save(); render();
}

/* ---------- события ---------- */
$('me').addEventListener('click', e => {
  const t = e.target.closest('.cell');
  if (t) placeAt(+t.dataset.r, +t.dataset.c);
});
$('me').addEventListener('mouseover', e => {
  const t = e.target.closest('.cell');
  if (t) preview(+t.dataset.r, +t.dataset.c);
});
$('me').addEventListener('mouseleave', clearPreview);
$('enemy').addEventListener('click', e => {
  const t = e.target.closest('.cell');
  if (t) (G.online ? onlineFire : fire)(+t.dataset.r, +t.dataset.c);
});

$('auto').onclick = () => { G.me = randomFleet(); save(); render(); };
$('clear').onclick = () => { G.me = newBoard(); save(); render(); };
$('rot').onclick = rotate;
$('start').onclick = () => {
  if (G.online) return onlineReady();
  if (G.me.ships.length !== FLEET.length) return;
  G.phase = 'play';
  G.turn = 'me';
  G.msg = 'Ваш ход. Нажмите на клетку поля соперника.';
  save(); render();
};
$('new').onclick = () => {
  if (G.phase === 'play' && !confirm('Начать заново? Текущая партия будет потеряна.')) return;
  clearTimeout(timer);
  G = fresh();
  save(); render();
};
document.addEventListener('keydown', e => {
  if (['r', 'к'].includes(e.key.toLowerCase())) rotate();
});

/* ---------- меню ---------- */
const showScreen = s => { document.body.dataset.screen = s; };
const showGame = () => showScreen('game');

function goMenu() {
  clearTimeout(timer);
  leaveRoom();
  showScreen('menu');
  renderMenu();
}
function startBot() {
  G = load() || fresh();
  $('enemyWrap').querySelector('h2').textContent = 'Флот соперника';
  showGame(); save(); render();
  if (G.phase === 'play' && G.turn === 'bot') timer = setTimeout(botTurn, 700); // продолжить после перезагрузки
}
$('playBot').onclick = startBot;
$('menuBtn').onclick = goMenu;
$('login').onclick = () => (fbUser ? firebase.auth().signOut() : signIn());
$('create').onclick = createRoom;
$('join').onclick = () => joinRoom($('code').value);

fbOn = fbInit();
renderMenu();
