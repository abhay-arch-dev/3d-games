// TV game picker. A phone can also pick a game; net.ts then moves the TV to it.
import { connect, $ } from './net';
import { GAMES, gameUrl, type GameId } from './protocol';

const ids = Object.keys(GAMES) as Exclude<GameId, 'hub'>[];
$('grid').innerHTML = ids.map((g) =>
  `<button class="tile" data-g="${g}"><span class="ic">${GAMES[g].icon}</span><b>${GAMES[g].name}</b><span>${GAMES[g].blurb}</span></button>`).join('');
const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('.tile'));
let sel = 0;
const focus = (i: number) => { sel = (i + tiles.length) % tiles.length; tiles[sel].focus(); };
tiles.forEach((t, i) => {
  t.addEventListener('click', () => { location.href = gameUrl(ids[i]); });
  t.addEventListener('focus', () => { sel = i; });
});
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focus(sel + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focus(sel - 1); }
  else if (e.key >= '1' && e.key <= '4') location.href = gameUrl(ids[Number(e.key) - 1]);
});
focus(0);

connect<never, never>('tv', (msg) => {
  if (msg.type === 'peers') {
    $('status').classList.toggle('on', msg.controller > 0);
    $('statusTxt').textContent = msg.controller > 0 ? 'Phone connected: pick a game' : 'Waiting for phone…';
  }
});
