import './styles.css';
import { Game } from './core/Game.js';

const canvas = document.getElementById('game');
const ui = document.getElementById('ui');

function fatal(msg) {
  ui.innerHTML = `<div class="screen" style="align-items:center;justify-content:center;flex-direction:column;background:#05060a">
    <div class="logo" style="font-size:80px">RING KINGS</div><div style="max-width:560px;text-align:center;margin-top:20px">${msg}</div></div>`;
}

const gl = canvas.getContext('webgl2');
if (!gl) fatal('Your browser does not support WebGL2, which this game needs. Try a recent Chrome, Edge, Firefox or Safari.');
else {
  const game = new Game(canvas, ui);
  game.boot().catch((e) => { console.error(e); fatal('Failed to start: ' + e.message); });
}
