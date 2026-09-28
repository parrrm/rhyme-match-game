import * as ResultsRanking from './results.js';
import { MODES } from '../game/modes.js';
import { playerColor } from '../game/gameState.js';

let getContext = () => ({});
function configureUI(context){ getContext = context; }

/* Each mode gets its own accent color — it themes the stage card, timer ring,
   mode pill and lobby mode-card so the whole screen signals "which game are we
   playing" at a glance, not just the small emoji label. */
const MODE_COLORS = { classic:'#b6ff3c', speed:'#ff6a00', lonewolf:'#29e2ff', suddendeath:'#ff2e93' };
function hexToRgba(hex, alpha){
  const h = hex.replace('#','');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function applyModeTheme(modeKey){
  const c = MODE_COLORS[modeKey] || MODE_COLORS.classic;
  document.documentElement.style.setProperty('--mode-accent', c);
  document.documentElement.style.setProperty('--mode-glow', hexToRgba(c, .32));
}

/* Every player is assigned one of 8 identity colors the moment they join, fixed
   for the whole game (stored on the player object, not recomputed by position)
   so it never shifts around if someone else leaves. Used as a small dot next to
   their name in the roster, judging list, results and scoreboard. */
function avatarDot(idx){ return `<span class="avatar-dot" style="background:${playerColor(idx)}"></span>`; }

/* ============================================================
   SOUND — tiny synthesized cues, no external audio files
   ============================================================ */
const Sound = (() => {
  let ctx = null;
  let enabled = true;
  try { enabled = localStorage.getItem('rhymeMatchSound') !== 'off'; } catch (e) { enabled = true; }
  function ensureCtx(){ if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } } return ctx; }
  function tone(freq, dur, type, gainVal){
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.value = gainVal || 0.06;
    osc.connect(gain).connect(c.destination);
    const now = c.currentTime;
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.start(now);
    osc.stop(now + dur);
  }
  return {
    click(){ tone(520, .07, 'triangle', .05); },
    lock(){ tone(660, .09, 'sine', .07); tone(880, .12, 'sine', .05); },
    tick(){ tone(880, .05, 'square', .03); },
    reveal(){ tone(440,.1,'sine',.05); setTimeout(()=>tone(660,.12,'sine',.05),90); setTimeout(()=>tone(880,.16,'sine',.05),180); },
    win(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,.2,'sine',.06), i*110)); },
    toggle(){ enabled = !enabled; try { localStorage.setItem('rhymeMatchSound', enabled ? 'on' : 'off'); } catch(e){} return enabled; },
    isEnabled(){ return enabled; }
  };
})();

/* ============================================================
   TOAST / MODAL HELPERS (replace blocking alert())
   ============================================================ */
function showToast(message, type){
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 2900);
}
function showModal(title, message, onConfirm){
  const backdrop = document.getElementById('modalBackdrop');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  backdrop.classList.add('active');
  const btn = document.getElementById('modalConfirmBtn');
  const handler = () => { backdrop.classList.remove('active'); btn.removeEventListener('click', handler); if (onConfirm) onConfirm(); };
  btn.addEventListener('click', handler);
}
function shakeInput(el){ el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

function spawnConfetti(){
  const colors = ['#29e2ff','#ff2e93','#b6ff3c','#ffd23d','#ffffff'];
  for (let i = 0; i < 46; i++){
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
    piece.style.opacity = String(0.7 + Math.random() * 0.3);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 3000);
  }
}

/* ============================================================
   UI CONTROLLER
   ============================================================ */
const PHASES = ['target','rhyme','judge','results'];
function formatDelta(value){ const amount = Number(value) || 0; return amount > 0 ? `+${amount}` : String(amount); }
class UIManager {
  static showView(viewId){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    const isGameActive = (viewId !== 'menuView' && viewId !== 'lobbyView');
    document.getElementById('statsHeader').style.display = isGameActive ? 'flex' : 'none';
    document.getElementById('brandHeader').style.display = viewId === 'menuView' ? 'block' : 'none';
    document.getElementById('phaseTracker').style.display = isGameActive && viewId !== 'submitRhymeView' ? 'flex' : 'none';

    document.getElementById('sidebarView').classList.toggle('active', isGameActive);
    document.getElementById('fabScoreboard').classList.toggle('active', isGameActive);

    const phaseMap = { targetSetupView:'target', twistRevealView:'target', submitRhymeView:'rhyme', spectatorView:'rhyme', waitingView:'rhyme', judgingView:'judge', resultsView:'results' };
    if (phaseMap[viewId]) UIManager.setPhase(phaseMap[viewId]);
    const objective = document.getElementById('roundObjective');
    const mode = MODES[getContext().engine.mode] || MODES.classic;
    const instructions = {
      targetSetupView: 'Choose the target word for the next round.',
      twistRevealView: 'Read the challenge before the clock starts.',
      submitRhymeView: mode.objective,
      judgingView: getContext().isHost ? 'Check each rhyme, then award the round points.' : 'The host is checking the rhymes before scores appear.',
      waitingView: 'Stay in the room. You can play when the host starts the next round.',
      spectatorView: 'Watch this round; the remaining players are writing their rhymes.'
    };
    objective.textContent = instructions[viewId] || '';
    objective.hidden = !instructions[viewId];
  }

  static setPhase(phaseName){
    const idx = PHASES.indexOf(phaseName);
    document.querySelectorAll('.phase-dot').forEach((dot) => {
      const dotIdx = PHASES.indexOf(dot.dataset.phase);
      dot.classList.remove('done','current');
      if (dotIdx < idx) dot.classList.add('done');
      else if (dotIdx === idx) dot.classList.add('current');
    });
  }

  static updateHeader(round, score, modeKey, eliminated){
    document.getElementById('roundDisplay').innerText = round;
    document.getElementById('scoreDisplay').innerText = score;
    const pill = document.getElementById('modePill');
    const mode = MODES[modeKey] || MODES.classic;
    pill.textContent = eliminated ? 'OUT — spectating' : (mode.emoji + ' ' + mode.label);
    pill.classList.toggle('out', !!eliminated);
    applyModeTheme(modeKey);
  }

  static updateRoster(players){
    const count = players.filter(p => p.connected !== false).length;
    document.getElementById('playerCount').innerText = `${count} / ${getContext().MAX_PLAYERS}`;
    document.getElementById('playerRoster').innerHTML = players.map(p => `
      <span class="player-chip ${p.id === getContext().myUid ? 'you' : ''} ${p.connected === false ? 'offline' : ''}">
        <span class="player-presence" aria-hidden="true"></span><span class="player-name">${escapeHtml(p.name)}${p.id === getContext().myUid ? ' · You' : ''}${p.connected === false ? ' · offline' : p.pendingNextRound ? ' · next round' : ''}</span>${p.id === getContext().hostUid ? '<span class="host-badge">👑 HOST</span>' : ''}
      </span>`).join('') + (count < getContext().MAX_PLAYERS ? '<span class="player-chip waiting-slot"><span class="player-presence" aria-hidden="true"></span><span>Waiting for player…</span></span>' : '');

    const startBtn = document.getElementById('btnStartRound');
    if (startBtn){
      startBtn.disabled = count < 2;
      startBtn.innerText = 'Start Game';
    }
    const missing = Math.max(0, 2 - count);
    const status = document.getElementById('lobbyStatusMessage');
    status.textContent = getContext().isHost ? (missing ? `🔒 Waiting for ${missing} more ${missing === 1 ? 'player' : 'players'}` : '✓ Ready to play') : (missing ? '🔒 Waiting for more players' : '✓ Ready — waiting for host to start');
    status.classList.toggle('ready', !missing);
    document.getElementById('lobbyActionHint').textContent = missing ? 'Invite someone using the QR code above.' : getContext().isHost ? 'Everyone is connected. Start when your group is ready.' : 'The host will start the game.';
    UIManager.renderScoreboard(players);
  }

  static renderScoreboard(players){
    const sorted = ResultsRanking.build(players).standings;
    const podiumHtml = UIManager.buildPodium(sorted);
    const listHtml = sorted.map((p,i) => `
      <li data-player-id="${escapeHtml(p.id)}" class="${p.eliminated ? 'eliminated' : ''} ${p.id === getContext().myUid ? 'you' : ''}">
        <span class="score-player"><span class="rank">${i+1}.</span>${p.eliminated ? '<span aria-label="Eliminated">💀</span>' : avatarDot(p.colorIndex)}<span class="score-name">${escapeHtml(p.name)}</span>${p.id === getContext().myUid ? '<small class="you-tag">YOU</small>' : ''}</span>
        <span class="score-values"><b>${p.score}</b>${p.lastDelta == null ? '' : `<small class="score-delta ${p.lastDelta > 0 ? 'positive' : p.lastDelta < 0 ? 'negative' : 'neutral'}" aria-label="Last round ${formatDelta(p.lastDelta)}">${formatDelta(p.lastDelta)}</small>`}</span>
      </li>`).join('');
    document.getElementById('scoreboardPodium').innerHTML = podiumHtml;
    const list = document.getElementById('scoreboardList');
    const previous = new Map([...list.children].map(row => [row.dataset.playerId, row.getBoundingClientRect().top]));
    list.innerHTML = listHtml;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    [...list.children].forEach(row => {
      const before = previous.get(row.dataset.playerId);
      if (before == null) return;
      const distance = before - row.getBoundingClientRect().top;
      if (Math.abs(distance) > 2 && Math.abs(distance) < 800 && typeof row.animate === 'function'){
        row.animate([{ transform:`translateY(${distance}px)` }, { transform:'translateY(0)' }], { duration:260, easing:'cubic-bezier(.22,1,.36,1)' });
      }
    });
  }

  static buildPodium(sorted){
    if (sorted.length < 2) return '';
    const medals = ['🥇','🥈','🥉'];
    const order = [1,0,2].filter(i => sorted[i]); // silver, gold, bronze visual order
    const slotClass = { 0:'first', 1:'second', 2:'third' };
    return `<div class="podium">${order.map(i => `
      <div class="podium-slot ${slotClass[i]} ${sorted[i].id === getContext().myUid ? 'you' : ''} ${sorted[i].eliminated ? 'eliminated' : ''}">
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-bar"></div>
        <div class="podium-name">${avatarDot(sorted[i].colorIndex)}${escapeHtml(sorted[i].name)}<br>${sorted[i].score}</div>
      </div>`).join('')}</div>`;
  }
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ============================================================
   GAME ENGINE (HOST AUTHORITATIVE)
   ============================================================ */

export { configureUI, MODE_COLORS, hexToRgba, applyModeTheme, avatarDot, Sound, showToast, showModal, shakeInput, spawnConfetti, formatDelta, UIManager, escapeHtml };
