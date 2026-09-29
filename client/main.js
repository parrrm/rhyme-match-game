import { qrcode } from '../qrcode.js?esm=1';
import { ROOM_LIFETIME_MS, roomRandomId, makeRoomCode, validRoomCode, localSessionId, roomUrl, subscribe, clearSubscriptions, authenticate, nextCommandSeq, publishPresence, persistHostState, publishHostMessage, publishGuestCommand } from './room/roomManager.js';
import * as ConnectionHelp from './ui/connectionHelp.js';
import * as ResultsRanking from './ui/results.js';
import { buildHeadline } from './ui/results.js';
import { configureUI, MODE_COLORS, hexToRgba, applyModeTheme, avatarDot, Sound, showToast, showModal, shakeInput, spawnConfetti, formatDelta, UIManager, escapeHtml } from './ui/ui.js';
import { prepareRound } from './game/rounds.js';
import { settlePredictionResults, updatePredictionResults } from './game/scoring.js';
import { RhymeGameEngine } from './game/gameState.js';
import { pickTarget, QUALITY_WORDS } from './game/words.js';
import { MODES, MODE_MODIFIERS, MIN_CUSTOM_TIMER, MAX_CUSTOM_TIMER, normalizeModeSettings, configuredTimer, shrinkingFloor, previewTimer } from './game/modes.js';
'use strict';
/* ============================================================
   WORD BANK — curated real words across ~40 rhyme families
   so "Random Word" always lands on something genuinely rhymeable.
   ============================================================ */
/* ============================================================
   GAME MODES
   ============================================================ */
const MAX_PLAYERS = 8;
/* ============================================================
   NETWORKING & APP STATE
   ============================================================ */
const engine = new RhymeGameEngine();
let isHost = false;
let localName = "";
let myUid = "";
let localScore = 0;
let currentRound = 1;
let currentTimerSeconds = 20;
let countdownInterval = null;
let lastKnownPlayers = [];
configureUI(() => ({ engine, isHost, myUid, hostUid, MAX_PLAYERS }));
function setConnectionStatus(message, state){
  const el = document.getElementById('connectionStatus');
  el.textContent = message;
  el.className = 'connection-status ' + (state || '');
  if (state === 'online') document.getElementById('connectionHelp').hidden = true;
}
function showConnectionIssue(input){
  const kind = ConnectionHelp.classify({ online:navigator.onLine, ...input });
  const issue = ConnectionHelp.issues[kind];
  document.getElementById('connectionHelpTitle').textContent = issue.title;
  document.getElementById('connectionHelpSteps').innerHTML = issue.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  document.getElementById('connectionHelp').hidden = false;
  document.getElementById('btnRetryConnection').disabled = kind === 'offline';
}
document.getElementById('btnRetryConnection').addEventListener('click', () => {
  if (!navigator.onLine) { showConnectionIssue({ online:false }); return; }
  document.getElementById('connectionHelp').hidden = true;
  if (isHost){
    if (roomRef) roomRef.child('meta').once('value').then(() => queuePersist()).catch(error => reportRoomError(error, 'service'));
    else document.getElementById('btnHostInit').click();
  } else if (roomRef){
    roomRef.child('snapshot').once('value').then(snap => {
      clientNeedsSync = true;
      if (clientJoined) syncClientSnapshot(snap.val());
      else sendGuestCommand({ type:'JOIN', name:localName, sessionId:localSessionId(roomCode), capabilities:{hostTransfer:true} });
    }).catch(error => reportRoomError(error, 'service'));
  } else document.getElementById('btnJoinInit').click();
});
window.addEventListener('offline', () => {
  setConnectionStatus('This device is offline', 'error');
  showConnectionIssue({ online:false });
});
window.addEventListener('online', () => {
  setConnectionStatus('Internet is back — checking the room service', 'pending');
  if (!roomRef) showConnectionIssue({ stage:'connection' });
});
function updateReadyStatus(ready, total){
  document.getElementById('readyStatus').textContent = `${ready} / ${total} players ready`;
}
function broadcastReadyStatus(){
  const total = engine.activePlayers().length;
  const ready = engine.activePlayers().filter(p => engine.submissions.has(p.id)).length;
  updateReadyStatus(ready, total);
  broadcastToGuests({ type:'READY_STATUS', ready, total });
}

function getValidatedName(){
  const input = document.getElementById('inputPlayerName');
  const raw = input.value.trim().replace(/\s+/g, ' ');
  const feedback = document.getElementById('nicknameFeedback');
  if (!raw){ feedback.textContent = 'Enter a nickname to continue.'; feedback.className = 'field-feedback error'; input.setAttribute('aria-invalid','true'); input.focus(); return null; }
  feedback.textContent = `${raw.length} / 15 characters · ready to play`;
  feedback.className = 'field-feedback ok'; input.removeAttribute('aria-invalid');
  return raw;
}
document.getElementById('inputPlayerName').addEventListener('input', () => {
  const input = document.getElementById('inputPlayerName');
  const feedback = document.getElementById('nicknameFeedback');
  const count = input.value.trim().length;
  feedback.textContent = count ? `${count} / 15 characters · ready to play` : '1–15 characters. This name appears to other players.';
  feedback.className = 'field-feedback' + (count ? ' ok' : '');
  input.removeAttribute('aria-invalid');
});

/* --- Menu tabs --- */
document.getElementById('tabHost').addEventListener('click', () => {
  document.getElementById('tabHost').classList.add('active');
  document.getElementById('tabJoin').classList.remove('active');
  document.getElementById('panelHost').classList.add('active');
  document.getElementById('panelJoin').classList.remove('active');
  document.getElementById('tabHost').setAttribute('aria-pressed','true');
  document.getElementById('tabJoin').setAttribute('aria-pressed','false');
});
document.getElementById('tabJoin').addEventListener('click', () => {
  document.getElementById('tabJoin').classList.add('active');
  document.getElementById('tabHost').classList.remove('active');
  document.getElementById('panelJoin').classList.add('active');
  document.getElementById('panelHost').classList.remove('active');
  document.getElementById('tabJoin').setAttribute('aria-pressed','true');
  document.getElementById('tabHost').setAttribute('aria-pressed','false');
});

/* --- Sound toggle --- */
function refreshSoundIcon(){ document.getElementById('soundToggleBtn').textContent = Sound.isEnabled() ? '🔊' : '🔇'; }
refreshSoundIcon();
document.getElementById('soundToggleBtn').addEventListener('click', () => { Sound.toggle(); refreshSoundIcon(); });

/* --- Password toggle --- */
document.getElementById('btnToggleVisibility').addEventListener('click', () => {
  const input = document.getElementById('inputRhyme');
  const btn = document.getElementById('btnToggleVisibility');
  if (input.type === 'password'){ input.type = 'text'; btn.innerText = 'Hide'; }
  else { input.type = 'password'; btn.innerText = 'Show'; }
});
document.getElementById('inputRhyme').addEventListener('input', (e) => {
  document.getElementById('btnSubmitRhyme').disabled = e.target.value.trim().length === 0;
});

/* --- Mobile scoreboard sheet --- */
function syncScoreboardPlacement(){
  const content = document.getElementById('scoreboardContent');
  const mobile = window.matchMedia('(max-width:860px)').matches;
  const destination = document.getElementById(mobile ? 'bottomSheet' : 'sidebarView');
  if (content.parentElement !== destination) destination.appendChild(content);
  if (!mobile) closeSheet();
}
function openSheet(){ document.getElementById('sheetBackdrop').classList.add('active'); document.getElementById('bottomSheet').classList.add('active'); }
function closeSheet(){ document.getElementById('sheetBackdrop').classList.remove('active'); document.getElementById('bottomSheet').classList.remove('active'); }
window.addEventListener('resize', syncScoreboardPlacement);
syncScoreboardPlacement();
document.getElementById('fabScoreboard').addEventListener('click', openSheet);
document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);

/* --- Copy room code from the code itself. --- */
document.getElementById('roomCodeDisplay').addEventListener('click', async () => {
  const code = document.getElementById('roomCodeDisplay').textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    const feedback = document.getElementById('roomCodeCopyFeedback');
    feedback.textContent = '✓ Copied!';
    feedback.classList.add('copied');
  } catch (e) { showModal('Copy this room code', code); }
});

/* --- One short tutorial, opened from the game heading or settings. --- */
const tutorialDialog = document.getElementById('howToPlayDialog');
const tutorialSteps = [...tutorialDialog.querySelectorAll('[data-tutorial-step]')];
let tutorialIndex = 0;
function updateModeTutorial(){
  const mode = MODES[engine.mode] || MODES.classic;
  document.getElementById('howToPlayTitle').textContent = `How to Play · ${mode.label}`;
  document.getElementById('tutorialReveal').textContent = engine.mode === 'lonewolf'
    ? 'Answers appear together. The host checks the rhymes; unique valid words score the most.'
    : 'Answers appear together. The host checks the rhymes before points are awarded.';
  document.querySelectorAll('[data-tutorial-step="3"] .tutorial-answer').forEach((answer, index) => {
    answer.classList.toggle('matched', engine.mode === 'lonewolf' ? index === 2 : index < 2);
  });
  document.getElementById('tutorialScore').textContent = mode.tutorialScore;
  document.getElementById('tutorialScoreDetail').textContent = mode.tutorialDetail;
  document.getElementById('tutorialFinish').textContent = mode.tutorialFinish;
  document.getElementById('tutorialNextRound').textContent = mode.elimination ? '→ Next Round or Champion' : '→ Next Round';
}
function showTutorialStep(index){
  tutorialIndex = Math.max(0, Math.min(index, tutorialSteps.length - 1));
  tutorialSteps.forEach((step, i) => { step.hidden = i !== tutorialIndex; });
  document.getElementById('tutorialProgress').textContent = `${tutorialIndex + 1} / ${tutorialSteps.length}`;
  document.getElementById('btnTutorialBack').hidden = tutorialIndex === 0;
  document.getElementById('btnTutorialNext').textContent = tutorialIndex === tutorialSteps.length - 1 ? (isHost ? 'Got it — Back to Room' : 'Got it — Join the Room') : 'Next';
}
document.querySelectorAll('[data-open-tutorial]').forEach(button => button.addEventListener('click', () => {
  updateModeTutorial();
  showTutorialStep(0);
  tutorialDialog.showModal();
}));
document.getElementById('btnCloseTutorial').addEventListener('click', () => tutorialDialog.close());
document.getElementById('btnTutorialBack').addEventListener('click', () => showTutorialStep(tutorialIndex - 1));
document.getElementById('btnTutorialNext').addEventListener('click', () => {
  if (tutorialIndex === tutorialSteps.length - 1) tutorialDialog.close();
  else showTutorialStep(tutorialIndex + 1);
});

function normalizeRoomInput(value){
  let candidate = String(value || '').trim();
  if (/^https?:\/\//i.test(candidate)){
    try { const url = new URL(candidate); candidate = url.searchParams.get('room') || url.searchParams.get('host') || ''; }
    catch(e){ return ''; }
  }
  return candidate.replace(/[\s-]/g, '').toUpperCase();
}
document.getElementById('inputJoinId').addEventListener('input', () => {
  const input = document.getElementById('inputJoinId');
  const normalized = normalizeRoomInput(input.value);
  const feedback = document.getElementById('roomCodeFeedback');
  const valid = /^[A-Z2-9]{8}$/.test(normalized);
  feedback.textContent = !normalized ? 'Paste a room code or the full join link.' : valid ? 'Room code looks ready.' : 'Enter the 8-character code from the host’s link.';
  feedback.className = 'field-feedback' + (!normalized ? '' : valid ? ' ok' : ' error');
  input.setAttribute('aria-invalid', normalized && !valid ? 'true' : 'false');
});
document.getElementById('inputJoinId').addEventListener('change', () => {
  const input = document.getElementById('inputJoinId');
  const normalized = normalizeRoomInput(input.value);
  if (/^[A-Z2-9]{8}$/.test(normalized)) input.value = normalized;
});

/* --- Shareable room link, with a code fallback for browsers without clipboard access. --- */
function joinUrl(code){
  const url = new URL(window.location.href);
  url.searchParams.delete('host');
  url.searchParams.set('room', code);
  return url.toString();
}
function renderRoomQr(code){
  const panel = document.getElementById('roomQrPanel');
  const target = document.getElementById('roomQrCode');
  if (!code || window.location.protocol === 'file:' || typeof qrcode !== 'function'){
    panel.hidden = true;
    target.innerHTML = '';
    return;
  }
  try {
    const qr = qrcode(0, 'M');
    qr.addData(joinUrl(code));
    qr.make();
    target.innerHTML = qr.createSvgTag({ cellSize:4, margin:16, scalable:true });
    const svg = target.querySelector('svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'QR code for this room’s join link');
    panel.hidden = false;
  } catch(e){
    panel.hidden = true;
    target.innerHTML = '';
  }
}
document.getElementById('btnCopyLink').addEventListener('click', async () => {
  if (window.location.protocol === 'file:'){ showModal('Publish to share a link', 'Open this game from an HTTPS website to share a join link across devices. For now, share the room code.'); return; }
  const link = joinUrl(document.getElementById('roomCodeDisplay').textContent.trim());
  try { await navigator.clipboard.writeText(link); showToast('Join link copied!', 'success'); }
  catch(e){ showModal('Share this link', link); }
});
const incomingRoom = new URL(window.location.href).searchParams.get('room');
if (incomingRoom){
  document.getElementById('inputJoinId').value = normalizeRoomInput(incomingRoom);
  document.getElementById('tabJoin').click();
  setConnectionStatus('Room link ready — enter a nickname to join', 'pending');
}

/* --- Mode selector (host, lobby) --- */
function updateLobbyRules(){
  const mode = MODES[engine.mode] || MODES.classic;
  document.getElementById('lobbyModeLabel').textContent = `${mode.emoji} ${mode.label}`;
  document.getElementById('roundModeLabel').textContent = `${mode.emoji} ${mode.label}`;
  const modifier = engine.settings[engine.mode].modifier;
  const briefing = {
    classic:{ objective:'Find a valid rhyme that one other player chooses.', scoring:'Two-player matches earn +3 each; larger groups earn +1.', special:'The host checks rhymes before points are awarded.' },
    speed:{ objective:'Find your rhyme before time runs out.', scoring:'Classic match points and penalties are doubled.', special:'Lock in quickly; the host checks answers before scoring.' },
    lonewolf:{ objective:'Find a valid rhyme nobody else chooses.', scoring:'A solo answer earns +4; a shared answer earns +1.', special:'A unique word is your best chance to score.' },
    suddendeath:{ objective:'Score enough to survive this round.', scoring:'Classic points apply; the lowest total loses the round.', special:'Eliminated players can exit or spectate.' }
  }[engine.mode];
  const special = {
    prediction:'Pick who will match you while locking your rhyme in the first round of a five-round window.',
    twist:'A special answer challenge will be revealed before the timer starts.',
    streak:'Consecutive valid matches build a bonus: +2, +3, +4 and higher.',
    shrinking:`The clock drops 1 second each consecutive round, to a floor of ${shrinkingFloor(configuredTimer(engine.mode,engine.settings))}s.`,
    chaos:'Each round receives one random 7–10 second timer. Custom Timer is unavailable with Chaos.',
    bounty:'Each consecutive solo answer grows your extra bounty by +2.',
    lives:'Start with 3 lives. The lowest total loses one; zero lives means elimination.'
  };
  document.getElementById('briefingTimer').textContent = `⏱️ ${previewTimer(engine.mode, engine.settings, engine.clockRun)}`;
  document.getElementById('briefingModifier').textContent = MODE_MODIFIERS[engine.mode].find(item => item.key === modifier).label;
  document.getElementById('briefingObjective').textContent = briefing.objective;
  document.getElementById('briefingScoring').textContent = briefing.scoring;
  document.getElementById('briefingSpecial').textContent = special[modifier] || briefing.special;
  document.getElementById('clientModeLabel').textContent = `${mode.emoji} ${mode.label}`;
  document.getElementById('clientModeLabel').style.color = MODE_COLORS[engine.mode];
}
function renderAdvancedSettings(){
  const modeKey = engine.mode;
  const mode = MODES[modeKey];
  const config = engine.settings[modeKey];
  for (const [location, containerId] of [['lobby','lobbyAdvancedSettings'],['round','roundAdvancedSettings']]){
    const container = document.getElementById(containerId);
    const timerName = `timer-${location}`;
    const modifierName = `modifier-${location}`;
    container.innerHTML = `<h4 class="advanced-settings-title">Timer</h4>
      <div class="advanced-choice-list">
        <label class="advanced-choice ${config.timerMode === 'default' ? 'selected' : ''}"><input type="radio" name="${timerName}" data-setting="timerMode" value="default" ${config.timerMode === 'default' ? 'checked' : ''}><span><strong>Default · ${mode.timerSeconds}s</strong><small>Use this mode’s standard clock.</small></span></label>
        <label class="advanced-choice ${config.timerMode === 'custom' ? 'selected' : ''}"><input type="radio" name="${timerName}" data-setting="timerMode" value="custom" ${config.timerMode === 'custom' ? 'checked' : ''} ${config.modifier === 'chaos' ? 'disabled' : ''}><span><strong>Custom Timer</strong><small>${config.modifier === 'chaos' ? 'Choose another modifier to set a custom clock.' : `Choose ${MIN_CUSTOM_TIMER}–${MAX_CUSTOM_TIMER} seconds.`}</small></span></label>
      </div>
      <label class="custom-timer-row" for="customTimer-${location}">Custom seconds <input id="customTimer-${location}" type="number" inputmode="numeric" min="${MIN_CUSTOM_TIMER}" max="${MAX_CUSTOM_TIMER}" step="1" data-setting="customSeconds" value="${config.customSeconds}" ${config.modifier === 'chaos' ? 'disabled' : ''}></label>
      <h4 class="advanced-settings-title">Modifier · choose one</h4>
      <div class="advanced-choice-list">${MODE_MODIFIERS[modeKey].map(item => `<label class="advanced-choice ${config.modifier === item.key ? 'selected' : ''}"><input type="radio" name="${modifierName}" data-setting="modifier" value="${item.key}" ${config.modifier === item.key ? 'checked' : ''}><span><strong>${item.label}</strong><small>${item.detail}</small></span></label>`).join('')}</div>
      <p class="advanced-settings-note">Mode choices are saved separately. Only one modifier can be active.</p>`;
  }
}
function updateHostSetting(event){
  const input = event.target;
  const setting = input.dataset.setting;
  if (!setting || !isHost) return;
  const config = engine.settings[engine.mode];
  if (setting === 'customSeconds'){
    const seconds = Number(input.value);
    if (!Number.isInteger(seconds) || seconds < MIN_CUSTOM_TIMER || seconds > MAX_CUSTOM_TIMER){
      input.setAttribute('aria-invalid','true');
      showToast(`Choose ${MIN_CUSTOM_TIMER}–${MAX_CUSTOM_TIMER} whole seconds.`, 'error');
      return;
    }
    config.customSeconds = seconds;
    input.setAttribute('aria-invalid','false');
  } else if (setting === 'timerMode'){
    if (input.value === 'custom' && config.modifier === 'chaos'){
      showToast('Choose another modifier before using Custom Timer.', 'error');
      renderAdvancedSettings(); return;
    }
    config.timerMode = input.value;
  } else if (setting === 'modifier'){
    if (input.value === 'chaos' && config.timerMode === 'custom'){
      showToast('Chaos uses 7–10 seconds. Select Default Timer first; your custom value will be saved.', 'error');
      renderAdvancedSettings(); return;
    }
    config.modifier = input.value;
  }
  renderAdvancedSettings();
  broadcastRoster();
}
['lobbyAdvancedSettings','roundAdvancedSettings'].forEach(id => document.getElementById(id).addEventListener('change', updateHostSetting));
function renderModeGrid(){
  const markup = Object.keys(MODES).map(key => {
    const m = MODES[key];
    const accent = MODE_COLORS[key];
    const selected = engine.mode === key;
    const ring = selected ? `box-shadow:0 0 0 3px ${hexToRgba(accent, .22)};` : '';
    return `<button type="button" class="mode-card ${selected ? 'selected' : ''}" data-mode="${key}" aria-pressed="${selected}" style="border-left:5px solid ${accent};${ring}">
      <span class="mode-card-title" style="${selected ? `color:${accent};` : ''}">${m.emoji} ${m.label}</span>
      <span class="mode-card-desc">${m.desc}</span>
    </button>`;
  }).join('');
  const grids = [document.getElementById('modeGrid'), document.getElementById('roundModeGrid')];
  grids.forEach(grid => { grid.innerHTML = markup; });
  applyModeTheme(engine.mode);
  updateLobbyRules();
  renderAdvancedSettings();
  grids.forEach(grid => grid.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      engine.mode = card.dataset.mode;
      Sound.click();
      renderModeGrid();
      broadcastRoster();
      if (document.getElementById('targetSetupView').classList.contains('active')){
        const me = engine.players.get(myUid);
        UIManager.updateHeader(currentRound, me ? me.score : 0, engine.mode, false);
      }
    });
  }));
}

/* --- Firebase rooms: hosted discovery, persisted state, and resumable clients. --- */
const connectedGuestUids = new Set();
let hostSessionId = '';
let hostStarting = false;
let clientAttempt = 0;
let clientJoined = false;
let joinedRoomId = '';
let joinedHostSessionId = '';
let roomCode = '';
let roomRef = null;
let database = null;
let roomUser = null;
let hostUid = '';
let hostOnline = false;
let localConnectionId = '';
let lastEventSeq = 0;
let hostEventSeq = 0;
let persistTimer = null;
let persistChain = Promise.resolve();
let lastExpiryRenew = 0;
let lastPublicSnapshot = null;
let lastResultsPacket = null;
let clientJoinTimer = null;
let clientNeedsSync = false;
const processedCommands = new Map();
const incomingHost = new URL(window.location.href).searchParams.get('host');

function rememberName(name){ try { localStorage.setItem('rhymeMatchName', name); } catch(e){} }
function hostPhase(){
  return ['lobbyView','targetSetupView','twistRevealView','submitRhymeView','spectatorView','judgingView','resultsView']
    .find(id => document.getElementById(id).classList.contains('active')) || 'lobbyView';
}
function firebaseErrorCode(error){ return error && (error.code || error.message) || 'unknown'; }
function reportRoomError(error, stage){
  const code = firebaseErrorCode(error);
  console.warn(`Rhyme Match Firebase: ${stage} (${code}) in room ${roomCode}; online=${navigator.onLine}`);
  const issue = ConnectionHelp.issues[ConnectionHelp.classify({ online:navigator.onLine, code, stage })];
  setConnectionStatus(issue.title, 'error');
  showConnectionIssue({ code, stage });
}
async function ensureFirebase(){
  const connection = await authenticate();
  database = connection.database;
  roomUser = connection.user;
  myUid = roomUser.uid;
  return roomUser;
}
function setJoinBusy(busy){
  const button = document.getElementById('btnJoinInit');
  button.disabled = busy;
  button.textContent = busy ? 'Connecting…' : 'Join Game';
}
function showWaitingForNextRound(message){
  UIManager.showView('waitingView');
  document.getElementById('waitingRoomStatus').textContent = message || 'Connected to the same room; waiting for the next round.';
}
function showRoomIdentity(code){
  const codeButton = document.getElementById('roomCodeDisplay');
  codeButton.textContent = code;
  codeButton.setAttribute('aria-label', `Copy room code ${code}`);
  const feedback = document.getElementById('roomCodeCopyFeedback');
  feedback.textContent = 'Tap code to copy';
  feedback.classList.remove('copied');
  renderRoomQr(code);
}
async function setPresence(){
  if (!roomRef || !database || !localConnectionId) return;
  await publishPresence(roomRef, isHost, myUid, localConnectionId);
}
function bindConnectionMonitor(){
  let wasConnected = false;
  subscribe(database.ref('.info/connected'), 'value', snap => {
    const connected = snap.val() === true;
    if (connected){
      setPresence().catch(error => reportRoomError(error, 'presence'));
      if (wasConnected === false && clientJoined && !isHost){
        clientNeedsSync = true;
        sendGuestCommand({ type:'JOIN', name:localName, sessionId:localSessionId(roomCode), capabilities:{hostTransfer:true} });
        if (lastPublicSnapshot) syncClientSnapshot(lastPublicSnapshot);
      }
      if (isHost || clientJoined) setConnectionStatus('Connected to room service', 'online');
      wasConnected = true;
    } else if (wasConnected){
      setConnectionStatus(navigator.onLine ? 'Room service disconnected — reconnecting…' : 'This device is offline', 'error');
      showConnectionIssue({ stage:navigator.onLine ? 'signaling' : 'connection' });
      clientNeedsSync = true;
      wasConnected = false;
    }
  });
}
function serializeHostState(){
  return {
    round:engine.round, mode:engine.mode, settings:engine.settings, roundRule:engine.roundRule, clockRun:engine.clockRun, twistHistory:engine.twistHistory, targetWord:engine.targetWord,
    players:[...engine.players.values()], submissions:[...engine.submissions],
    predictions:[...engine.predictions], predictionCounts:[...engine.predictionCounts].map(([id, counts]) => [id,[...counts]]),
    predictionRound:engine.predictionRound, predictionEndRound:engine.predictionEndRound,
    predictionStake:engine.predictionStake, processedCommands:[...processedCommands],
    phase:hostPhase(), results:lastResultsPacket, savedAt:Date.now()
  };
}
function restoreHostState(state){
  engine.round = state.round || 0;
  engine.mode = state.mode || 'classic';
  engine.settings = normalizeModeSettings(state.settings);
  engine.roundRule = state.roundRule || null;
  engine.clockRun = state.clockRun || null;
  engine.twistHistory = Array.isArray(state.twistHistory) ? state.twistHistory.slice(-10) : [];
  engine.targetWord = state.targetWord || '';
  engine.players = new Map((state.players || []).map(p => [p.id, p]));
  engine.submissions = new Map(state.submissions || []);
  engine.predictions = new Map(state.predictions || []);
  engine.predictionCounts = new Map((state.predictionCounts || []).map(([id, counts]) => [id,new Map(counts)]));
  engine.predictionRound = state.predictionRound || 0;
  engine.predictionEndRound = state.predictionEndRound || 0;
  engine.predictionStake = state.predictionStake || 0;
  processedCommands.clear();
  (state.processedCommands || []).forEach(([id, seq]) => processedCommands.set(id, seq));
  lastResultsPacket = state.results || null;
  currentRound = Math.max(1, engine.round);
  connectedGuestUids.clear();
  engine.players.forEach(player => {
    if (player.id !== myUid && player.connected !== false){
      connectedGuestUids.add(player.id);
    }
  });
}
function queuePersist(){
  if (!isHost || !roomRef) return;
  if (Date.now() - lastExpiryRenew > 60 * 60 * 1000){
    lastExpiryRenew = Date.now();
    roomRef.child('meta/expiresAt').set(Date.now() + ROOM_LIFETIME_MS).catch(error => reportRoomError(error, 'save'));
  }
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const state = serializeHostState();
    const snapshot = {
      roomId:roomCode, hostUid, hostSessionId, phase:state.phase,
      round:state.round, mode:state.mode, settings:state.settings, roundRule:state.roundRule, clockRun:state.clockRun, targetWord:state.targetWord,
      players:state.players, results:state.phase === 'resultsView' ? lastResultsPacket : null,
      updatedAt:firebase.database.ServerValue.TIMESTAMP
    };
    persistChain = persistChain.then(() => persistHostState(roomRef, state, snapshot)).catch(error => reportRoomError(error, 'save'));
  }, 0);
}
function writeGuestMessage(uid, payload){
  if (!isHost || !roomRef || !uid) return;
  hostEventSeq = Math.max(Date.now() * 1000, hostEventSeq + 1);
  const message = { ...payload, roomId:roomCode, hostId:hostUid, hostSessionId, seq:hostEventSeq };
  const sent = publishHostMessage(roomRef, uid, message).then(() => true).catch(error => { reportRoomError(error, 'send'); return false; });
  queuePersist();
  return sent;
}
function broadcastToGuests(payload){
  return Promise.all([...connectedGuestUids].map(uid => writeGuestMessage(uid, payload)));
}
async function writeGuestCommand(payload){
  if (!roomRef || !roomUser) throw { code:'room-not-found' };
  const command = { ...payload, uid:myUid, seq:nextCommandSeq(roomCode), at:firebase.database.ServerValue.TIMESTAMP };
  await publishGuestCommand(roomRef, myUid, command);
}
function sendGuestCommand(payload){
  writeGuestCommand(payload).catch(error => reportRoomError(error, 'send'));
}
let transferPending = false;
function leaveRoomUi(){
  saveSpectateChoice(false);
  clearInterval(countdownInterval);
  clearTimeout(clientJoinTimer);
  clearTimeout(persistTimer);
  clearSubscriptions();
  roomRef = null;
  clientJoined = false;
  isHost = false;
  hostStarting = false;
  connectedGuestUids.clear();
  engine.resetForRematch();
  engine.players.clear();
  engine.submissions.clear();
  lastResultsPacket = null;
  lastKnownPlayers = [];
  localScore = 0;
  currentRound = 1;
  const url = new URL(window.location.href);
  url.searchParams.delete('room'); url.searchParams.delete('host');
  history.replaceState(null, '', url.toString());
  UIManager.showView('menuView');
  setConnectionStatus('You left the room', 'pending');
}
async function transferHost(keepSpectating){
    if ([...engine.players.values()].some(p => p.id !== myUid && p.connected !== false && !p.capabilities?.hostTransfer)){
      showToast('Every connected player must refresh to the latest game before a safe host handoff.', 'error');
      return false;
    }
    const successor = [...engine.players.values()].find(p => p.id !== myUid && p.connected !== false && !p.eliminated && p.capabilities?.hostTransfer)
      || [...engine.players.values()].find(p => p.id !== myUid && p.connected !== false && p.capabilities?.hostTransfer);
    if (!successor && (keepSpectating || [...engine.players.values()].some(p => p.id !== myUid && p.connected !== false))){
      showToast('Another player needs the latest game open before the host can hand off control.', 'error');
      return false;
    }
    if (successor){
      const nextSession = roomRandomId();
      const hostPlayer = engine.players.get(myUid);
      const wasConnected = hostPlayer.connected;
      let subscriptionsCleared = false;
      try {
        if (!keepSpectating) hostPlayer.connected = false;
        clearTimeout(persistTimer);
        await persistChain;
        await roomRef.child('hostState').set(serializeHostState());
        const sent = await broadcastToGuests({type:'HOST_TRANSFER', nextHostUid:successor.id, nextHostSessionId:nextSession});
        if (sent.some(ok => !ok)) throw new Error('transfer-message-failed');
        clearTimeout(persistTimer);
        await persistChain;
        await roomRef.child('hostConnections').child(localConnectionId).remove();
        await roomRef.child('hostConnections').child(localConnectionId).onDisconnect().cancel();
        clearSubscriptions();
        subscriptionsCleared = true;
        await roomRef.child('meta').update({hostUid:successor.id, hostSessionId:nextSession});
        isHost = false;
      } catch(error){
        hostPlayer.connected = wasConnected;
        if (subscriptionsCleared){ bindConnectionMonitor(); startHostSubscriptions(); }
        reportRoomError(error,'host-transfer');
        showToast('Host transfer did not finish. Stay in the room and try again.', 'error');
        setPresence().catch(() => {});
        return false;
      }
    }
    if (keepSpectating) window.location.assign(roomUrl(roomCode, false));
    else leaveRoomUi();
    return true;
}
async function exitGame(){
  if (!roomRef) return;
  if (isHost){
    await transferHost(false);
    return;
  }
  try { await writeGuestCommand({type:'LEAVE'}); }
  catch(error){ reportRoomError(error,'leave'); }
  try {
    const ref = roomRef.child('presence').child(myUid).child(localConnectionId);
    await ref.remove();
    await ref.onDisconnect().cancel();
  } catch(error){ reportRoomError(error,'presence-leave'); }
  leaveRoomUi();
}
function handleHostTransfer(data){
  if (transferPending || !roomRef || !data.nextHostUid || !data.nextHostSessionId) return;
  transferPending = true;
  setConnectionStatus('Moving room host — reconnecting…', 'pending');
  const metaRef = roomRef.child('meta');
  const timeout = setTimeout(() => { metaRef.off('value', onMeta); transferPending = false; showConnectionIssue({hostOnline:false}); }, 15000);
  function onMeta(snap){
    const meta = snap.val();
    if (meta?.hostUid !== data.nextHostUid || meta.hostSessionId !== data.nextHostSessionId) return;
    clearTimeout(timeout);
    metaRef.off('value', onMeta);
    transferPending = false;
    if (myUid === data.nextHostUid){
      window.location.assign(roomUrl(roomCode, true));
      return;
    }
    hostUid = data.nextHostUid;
    joinedHostSessionId = data.nextHostSessionId;
    lastEventSeq = 0;
    clientJoined = false;
    clientNeedsSync = true;
    sendGuestCommand({type:'JOIN',name:localName,sessionId:localSessionId(roomCode),capabilities:{hostTransfer:true}});
  }
  metaRef.on('value', onMeta, error => { clearTimeout(timeout); transferPending = false; reportRoomError(error,'host-transfer'); });
}
function markConnectionLost(uid, reason){
  if (!connectedGuestUids.has(uid)) return;
  connectedGuestUids.delete(uid);
  const changed = engine.markDisconnected(uid);
  if (!changed) return;
  console.info('Rhyme Match player disconnected', { uid, reason });
  broadcastRoster();
  if (document.getElementById('submitRhymeView').classList.contains('active')){
    broadcastReadyStatus();
    if (engine.allSubmitted()) openHostJudgingPhase();
  }
  setConnectionStatus(connectedGuestUids.size ? 'Room live — players connected' : 'Room live — waiting for players', 'online');
}
function registerHostJoin(uid, data){
  if (!data.sessionId || !/^[A-Za-z0-9-]{16,80}$/.test(data.sessionId)){
    writeGuestMessage(uid, { type:'ERROR', code:'invalid-session' }); return;
  }
  let player = engine.players.get(uid);
  const wasExisting = !!player;
  if (!player){
    const connected = [...engine.players.values()].filter(p => p.connected !== false).length;
    if (connected >= MAX_PLAYERS){ writeGuestMessage(uid, { type:'ERROR', code:'room-full' }); return; }
    engine.addPlayer(uid, String(data.name || 'Player').trim().slice(0,15) || 'Player');
    player = engine.players.get(uid);
  }
  player.connected = true;
  player.sessionId = data.sessionId;
  player.capabilities = data.capabilities || {};
  player.pendingNextRound = !['lobbyView','targetSetupView'].includes(hostPhase()) && !(wasExisting && hostPhase() === 'resultsView');
  connectedGuestUids.add(uid);
  writeGuestMessage(uid, {
    type:'ROOM_STATE', playerId:uid, clientSessionId:data.sessionId,
    players:[...engine.players.values()], mode:engine.mode, settings:engine.settings, roundRule:engine.roundRule, clockRun:engine.clockRun, round:engine.round,
    phase:hostPhase(), waiting:player.pendingNextRound, results:hostPhase() === 'resultsView' ? lastResultsPacket : null
  });
  broadcastRoster();
  if (hostPhase() === 'submitRhymeView') broadcastReadyStatus();
  setConnectionStatus('Room live — players connected', 'online');
}
function handleHostCommand(data){
  if (!data || !data.uid || !Number.isSafeInteger(data.seq)) return;
  const uid = data.uid;
  if (data.seq <= (processedCommands.get(uid) || 0)) return;
  processedCommands.set(uid, data.seq);
  if (data.type === 'JOIN') registerHostJoin(uid, data);
  else if (connectedGuestUids.has(uid) && data.type === 'LEAVE') markConnectionLost(uid, 'player-left');
  else if (connectedGuestUids.has(uid) && data.type === 'SUBMIT_RHYME' && hostPhase() === 'submitRhymeView'){
    engine.registerSubmission(uid, data.word || '', data.pick);
    broadcastReadyStatus();
    if (engine.allSubmitted()) openHostJudgingPhase();
  }
  queuePersist();
}
function startHostSubscriptions(){
  subscribe(roomRef.child('commands'), 'child_added', snap => handleHostCommand(snap.val()), error => reportRoomError(error, 'commands'));
  subscribe(roomRef.child('commands'), 'child_changed', snap => handleHostCommand(snap.val()), error => reportRoomError(error, 'commands'));
  subscribe(roomRef.child('presence'), 'value', snap => {
    const all = snap.val() || {};
    for (const uid of [...connectedGuestUids]) if (!all[uid] || !Object.keys(all[uid]).length) markConnectionLost(uid, 'presence-lost');
  }, error => reportRoomError(error, 'presence'));
}
function broadcastRoster(){
  const list = [...engine.players.values()];
  lastKnownPlayers = list;
  updateLobbyRules();
  if (isHost) renderAdvancedSettings();
  UIManager.updateRoster(list);
  const me = list.find(p => p.id === myUid);
  document.getElementById('clientModeLabel').textContent = MODES[engine.mode].emoji + ' ' + MODES[engine.mode].label;
  document.getElementById('clientModeLabel').style.color = MODE_COLORS[engine.mode];
  applyModeTheme(engine.mode);
  if (isHost && document.getElementById('lobbyView').classList.contains('active')) UIManager.updateHeader(currentRound, me ? me.score : 0, engine.mode, me ? me.eliminated : false);
  broadcastToGuests({ type:'ROSTER_UPDATE', players:list, mode:engine.mode, settings:engine.settings, roundRule:engine.roundRule, clockRun:engine.clockRun });
  queuePersist();
}
function resumeHostView(state){
  document.getElementById('hostLobbyControls').style.display = 'block';
  document.getElementById('hostModeSection').style.display = 'block';
  document.getElementById('clientModeSection').style.display = 'none';
  renderModeGrid();
  broadcastRoster();
  if (state.phase === 'resultsView' && lastResultsPacket){
    const p = lastResultsPacket;
    displayResults(p.results, p.players, p.eliminatedNames, p.gameOver, p.winnerName);
  } else if (state.phase === 'judgingView' || state.phase === 'submitRhymeView' || state.phase === 'spectatorView'){
    openHostJudgingPhase();
  } else if (state.phase === 'twistRevealView') showTwistReveal();
  else if (state.phase === 'targetSetupView') UIManager.showView('targetSetupView');
  else UIManager.showView('lobbyView');
  queuePersist();
}
async function startHost(){
  if (hostStarting || roomRef) return;
  const requestedName = getValidatedName();
  if (!requestedName) return;
  hostStarting = true;
  document.getElementById('btnHostInit').disabled = true;
  setConnectionStatus('Opening Firebase room…', 'pending');
  try {
    await ensureFirebase();
    isHost = true;
    localName = requestedName;
    rememberName(localName);
    hostUid = myUid;
    localConnectionId = roomRandomId();
    if (incomingHost && validRoomCode(incomingHost.toUpperCase())){
      roomCode = incomingHost.toUpperCase();
      roomRef = database.ref('rooms/' + roomCode);
      const [metaSnap, stateSnap] = await Promise.all([roomRef.child('meta').once('value'), roomRef.child('hostState').once('value')]);
      const meta = metaSnap.val();
      if (!meta || meta.hostUid !== myUid) throw { code:'permission-denied' };
      hostSessionId = meta.hostSessionId;
      restoreHostState(stateSnap.val() || {});
      if (!engine.players.has(myUid)) engine.addPlayer(myUid, localName);
      else engine.players.get(myUid).connected = true;
      showRoomIdentity(roomCode);
      resumeHostView(stateSnap.val() || {});
    } else {
      roomCode = makeRoomCode();
      roomRef = database.ref('rooms/' + roomCode);
      const existing = await roomRef.child('meta').once('value');
      if (existing.exists()) throw { code:'room-code-collision' };
      hostSessionId = roomRandomId();
      engine.addPlayer(myUid, localName);
      engine.players.get(myUid).sessionId = hostSessionId;
      await roomRef.set({
        meta:{ hostUid:myUid, hostSessionId, createdAt:firebase.database.ServerValue.TIMESTAMP, expiresAt:Date.now()+ROOM_LIFETIME_MS },
        snapshot:{ roomId:roomCode, hostUid:myUid, hostSessionId, phase:'lobbyView', round:0, mode:engine.mode, settings:engine.settings, roundRule:engine.roundRule, clockRun:engine.clockRun, players:[...engine.players.values()] },
        hostState:serializeHostState()
      });
      history.replaceState(null, '', roomUrl(roomCode, true));
      showRoomIdentity(roomCode);
      document.getElementById('hostLobbyControls').style.display = 'block';
      document.getElementById('hostModeSection').style.display = 'block';
      document.getElementById('clientModeSection').style.display = 'none';
      UIManager.showView('lobbyView');
      renderModeGrid();
      broadcastRoster();
    }
    bindConnectionMonitor();
    startHostSubscriptions();
    setConnectionStatus(connectedGuestUids.size ? 'Room live — players connected' : 'Room live — waiting for players', 'online');
  } catch(error){
    reportRoomError(error, 'host-start');
    roomRef = null;
    hostStarting = false;
    document.getElementById('btnHostInit').disabled = false;
  }
}
document.getElementById('btnHostInit').addEventListener('click', startHost);

function syncClientSnapshot(snapshot){
  if (!snapshot || snapshot.roomId !== roomCode || snapshot.hostUid !== hostUid || snapshot.hostSessionId !== joinedHostSessionId) return;
  lastPublicSnapshot = snapshot;
  lastKnownPlayers = snapshot.players || [];
  engine.mode = snapshot.mode || 'classic';
  engine.settings = normalizeModeSettings(snapshot.settings);
  engine.roundRule = snapshot.roundRule || null;
  engine.clockRun = snapshot.clockRun || null;
  updateLobbyRules();
  currentRound = Math.max(1, snapshot.round || 1);
  UIManager.updateRoster(lastKnownPlayers);
  const me = lastKnownPlayers.find(p => p.id === myUid);
  if (me){
    if (!me.eliminated) saveSpectateChoice(false);
    localScore = me.score;
    UIManager.updateHeader(currentRound, localScore, engine.mode, me.eliminated);
  }
  if (!clientNeedsSync) return;
  clientNeedsSync = false;
  if (snapshot.phase === 'lobbyView') UIManager.showView('lobbyView');
  else if (snapshot.phase === 'resultsView' && snapshot.results){
    const p = snapshot.results;
    displayResults(p.results, p.players, p.eliminatedNames, p.gameOver, p.winnerName);
  } else showWaitingForNextRound('Reconnected to the same room; you can play from the next round.');
}
function handleClientMessage(data, attempt){
  if (attempt !== clientAttempt || !data || data.roomId !== roomCode || data.hostId !== hostUid) return;
  if (data.seq <= lastEventSeq) return;
  lastEventSeq = data.seq;
  if (data.type === 'ERROR'){
    reportRoomError({ code:data.code }, 'host');
    setJoinBusy(false);
    return;
  }
  if (data.type === 'ROOM_STATE'){
    if (data.playerId !== myUid || data.clientSessionId !== localSessionId(roomCode) || data.hostSessionId !== joinedHostSessionId || !Array.isArray(data.players) || !data.players.some(p => p.id === myUid)){
      reportRoomError({ code:'identity-mismatch' }, 'identity'); return;
    }
    clearTimeout(clientJoinTimer);
    clientJoined = true;
    joinedRoomId = roomCode;
    setJoinBusy(false);
    lastKnownPlayers = data.players;
    engine.mode = data.mode || 'classic';
    engine.settings = normalizeModeSettings(data.settings);
    engine.roundRule = data.roundRule || null;
    engine.clockRun = data.clockRun || null;
    currentRound = Math.max(1, data.round || 1);
    updateLobbyRules();
    document.getElementById('hostModeSection').style.display = 'none';
    document.getElementById('clientModeSection').style.display = 'block';
    UIManager.updateRoster(data.players);
    const me = data.players.find(p => p.id === myUid);
    if (!me.eliminated) saveSpectateChoice(false);
    localScore = me.score;
    UIManager.updateHeader(currentRound, localScore, engine.mode, me.eliminated);
    if (data.phase === 'resultsView' && data.results && !data.waiting){
      const p = data.results;
      displayResults(p.results, p.players, p.eliminatedNames, p.gameOver, p.winnerName);
    } else if (data.waiting) showWaitingForNextRound();
    else UIManager.showView('lobbyView');
    setConnectionStatus('Connected to verified room', 'online');
    Sound.lock();
    return;
  }
  if (!clientJoined || data.hostSessionId !== joinedHostSessionId) return;
  switch (data.type){
    case 'HOST_TRANSFER': handleHostTransfer(data); break;
    case 'ROSTER_UPDATE': {
      lastKnownPlayers = data.players;
      engine.mode = data.mode || 'classic';
      engine.settings = normalizeModeSettings(data.settings);
      engine.roundRule = data.roundRule || null;
      engine.clockRun = data.clockRun || null;
      updateLobbyRules();
      document.getElementById('clientModeLabel').textContent = MODES[engine.mode].emoji + ' ' + MODES[engine.mode].label;
      document.getElementById('clientModeLabel').style.color = MODE_COLORS[engine.mode];
      applyModeTheme(engine.mode);
      UIManager.updateRoster(data.players);
      const me = data.players.find(p => p.id === myUid);
      if (me){
        if (!me.eliminated) saveSpectateChoice(false);
        localScore = me.score;
        UIManager.updateHeader(currentRound, localScore, engine.mode, me.eliminated);
      }
      break;
    }
    case 'TWIST_REVEAL': {
      currentRound = data.round;
      engine.mode = data.mode;
      engine.targetWord = data.targetWord;
      engine.roundRule = data.roundRule;
      const me = lastKnownPlayers.find(p => p.id === myUid);
      if (me?.pendingNextRound){ showWaitingForNextRound(); break; }
      showTwistReveal();
      break;
    }
    case 'START_RHYME_PHASE': {
      currentRound = data.round;
      currentTimerSeconds = data.timerSeconds;
      engine.mode = data.mode;
      engine.roundRule = data.roundRule || { mode:data.mode, modifier:'none', timerSeconds:data.timerSeconds, challenge:null };
      engine.predictionRound = data.predictionRound || 0;
      engine.predictionStake = data.predictionStake || 0;
      const me = lastKnownPlayers.find(p => p.id === myUid);
      if (me && me.pendingNextRound){ showWaitingForNextRound(); break; }
      setConnectionStatus('Connected — round in progress', 'online');
      if (me && me.eliminated) startSpectating(data.targetWord);
      else startRhymeEntry(data.targetWord);
      break;
    }
    case 'READY_STATUS': updateReadyStatus(data.ready, data.total); break;
    case 'JUDGING_PHASE':
      if (!document.getElementById('waitingView').classList.contains('active')) openClientJudgingPhase(data.targetWord, data.submissions);
      break;
    case 'ROUND_OVER':
      if (!document.getElementById('waitingView').classList.contains('active')){
        displayResults(data.results, data.players, data.eliminatedNames, data.gameOver, data.winnerName);
        setConnectionStatus('Connected — round results ready', 'online');
      }
      else { lastKnownPlayers = data.players; UIManager.updateRoster(data.players); }
      break;
    case 'LOBBY_RETURN':
      saveSpectateChoice(false);
      currentRound = 1; localScore = 0;
      UIManager.updateHeader(1, 0, engine.mode, false);
      UIManager.showView('lobbyView');
      break;
  }
}
async function startClient(){
  if (document.getElementById('btnJoinInit').disabled || roomRef) return;
  const requestedName = getValidatedName();
  if (!requestedName) return;
  const target = normalizeRoomInput(document.getElementById('inputJoinId').value);
  document.getElementById('inputJoinId').value = target;
  if (!validRoomCode(target)){
    shakeInput(document.getElementById('inputJoinId'));
    document.getElementById('inputJoinId').focus();
    document.getElementById('roomCodeFeedback').textContent = 'Enter the 8-character code from the host’s current link.';
    document.getElementById('roomCodeFeedback').className = 'field-feedback error';
    showToast('Enter the 8-character code from the host’s current link.', 'error'); return;
  }
  const attempt = ++clientAttempt;
  setJoinBusy(true);
  setConnectionStatus('Looking up room in Firebase…', 'pending');
  try {
    await ensureFirebase();
    isHost = false;
    localName = requestedName;
    rememberName(localName);
    roomCode = target;
    roomRef = database.ref('rooms/' + roomCode);
    const metaSnap = await roomRef.child('meta').once('value');
    const meta = metaSnap.val();
    if (!meta || meta.expiresAt < Date.now()) throw { code:'room-not-found' };
    if (meta.hostUid === myUid) throw { code:'same-browser-host' };
    hostUid = meta.hostUid;
    joinedHostSessionId = meta.hostSessionId;
    localConnectionId = roomRandomId();
    showRoomIdentity(roomCode);
    const existingMessage = await roomRef.child('messages').child(myUid).once('value');
    lastEventSeq = existingMessage.val()?.seq || 0;
    subscribe(roomRef.child('messages').child(myUid), 'value', snap => handleClientMessage(snap.val(), attempt), error => reportRoomError(error, 'messages'));
    subscribe(roomRef.child('snapshot'), 'value', snap => {
      lastPublicSnapshot = snap.val();
      if (clientJoined) syncClientSnapshot(lastPublicSnapshot);
    }, error => reportRoomError(error, 'snapshot'));
    subscribe(roomRef.child('hostConnections'), 'value', snap => {
      hostOnline = snap.exists();
      if (!hostOnline && clientJoined){
        setConnectionStatus('Host temporarily away — room saved', 'pending');
        showConnectionIssue({ hostOnline:false });
      } else if (hostOnline && clientJoined) setConnectionStatus('Connected to room', 'online');
    });
    bindConnectionMonitor();
    await setPresence();
    await writeGuestCommand({ type:'JOIN', name:localName, sessionId:localSessionId(roomCode), capabilities:{hostTransfer:true} });
    clientJoinTimer = setTimeout(() => {
      if (clientJoined || attempt !== clientAttempt) return;
      setJoinBusy(false);
      if (!hostOnline){
        showWaitingForNextRound('The room is saved. Waiting for the host to reconnect.');
        setConnectionStatus('Host temporarily away — room saved', 'pending');
        showConnectionIssue({ hostOnline:false });
      } else reportRoomError({ code:'sync-timeout' }, 'ack');
    }, 10000);
  } catch(error){
    if (attempt !== clientAttempt) return;
    clearSubscriptions();
    roomRef = null;
    setJoinBusy(false);
    reportRoomError(error, 'lookup');
  }
}
document.getElementById('btnJoinInit').addEventListener('click', startClient);

try {
  const remembered = localStorage.getItem('rhymeMatchName');
  if (remembered) document.getElementById('inputPlayerName').value = remembered;
} catch(e){}
if (incomingHost && validRoomCode(incomingHost.toUpperCase())){
  document.getElementById('btnHostInit').textContent = 'Resume Room';
  setTimeout(() => document.getElementById('btnHostInit').click(), 0);
} else if (incomingRoom && validRoomCode(incomingRoom.toUpperCase()) && document.getElementById('inputPlayerName').value){
  setTimeout(() => document.getElementById('btnJoinInit').click(), 0);
}

function startNextRound(action){
  engine.promoteWaiting();
  broadcastRoster();
  if (action === 'choose') document.getElementById('btnStartRound').click();
  else startQuickRound();
}
function beginRound(targetWord){
  const challenge = prepareRound(engine, targetWord);
  currentRound = engine.round;
  currentTimerSeconds = engine.roundRule.timerSeconds;
  broadcastRoster();
  if (challenge){
    broadcastToGuests({ type:'TWIST_REVEAL', targetWord:engine.targetWord, round:engine.round, mode:engine.mode, roundRule:engine.roundRule });
    showTwistReveal();
    return;
  }
  launchRoundTimer();
}
function showTwistReveal(){
  UIManager.showView('twistRevealView');
  document.getElementById('twistRound').textContent = currentRound;
  document.getElementById('twistChallenge').textContent = engine.roundRule?.challenge?.text || 'Find a creative rhyme.';
  document.getElementById('twistTarget').textContent = engine.targetWord;
  document.getElementById('btnBeginTwist').hidden = !isHost;
  document.getElementById('twistGuestWait').hidden = isHost;
  queuePersist();
}
document.getElementById('btnBeginTwist').addEventListener('click', () => {
  if (isHost && hostPhase() === 'twistRevealView') launchRoundTimer();
});
function launchRoundTimer(){
  broadcastToGuests({ type:'START_RHYME_PHASE', targetWord:engine.targetWord, round:engine.round, mode:engine.mode, timerSeconds:currentTimerSeconds, roundRule:engine.roundRule, predictionRound:engine.predictionRound, predictionStake:engine.predictionStake });
  startRhymeEntry(engine.targetWord);
}
function startQuickRound(){
  beginRound(pickTarget());
}
/* --- TARGET SETUP (HOST) --- */
document.getElementById('btnStartRound').addEventListener('click', () => {
  UIManager.showView('targetSetupView');
  renderModeGrid();
  queuePersist();
  document.getElementById('inputCustomTarget').value = '';
  document.getElementById('wordSlotDisplay').textContent = 'Tap "Random Word" to draw one';
  document.getElementById('wordSlotDisplay').classList.remove('spinning');
});

document.getElementById('btnRandomWord').addEventListener('click', () => {
  const randomBtn = document.getElementById('btnRandomWord');
  randomBtn.disabled = true;
  const slot = document.getElementById('wordSlotDisplay');
  const input = document.getElementById('inputCustomTarget');
  slot.classList.add('spinning');
  let ticks = 0;
  const spin = setInterval(() => {
    slot.textContent = QUALITY_WORDS[Math.floor(Math.random() * QUALITY_WORDS.length)];
    Sound.tick();
    ticks++;
    if (ticks > 9) {
      clearInterval(spin);
      const pick = pickTarget();
      slot.textContent = pick;
      slot.classList.remove('spinning');
      randomBtn.disabled = false;
      input.value = pick;
      Sound.reveal();
    }
  }, 65);
});

document.getElementById('btnConfirmTarget').addEventListener('click', () => {
  const word = document.getElementById('inputCustomTarget').value.trim();
  if (!word) { shakeInput(document.getElementById('inputCustomTarget')); showToast('Pick or type a target word first.', 'error'); return; }
  beginRound(word);
});

/* --- SPECTATOR (eliminated players) --- */
function startSpectating(targetWord){
  const me = lastKnownPlayers.find(p => p.id === myUid);
  UIManager.updateHeader(currentRound, me ? me.score : localScore, engine.mode, true);
  UIManager.showView('spectatorView');
  document.getElementById('spectatorTargetWord').textContent = 'Target word: ' + targetWord;
}
let spectateChosen = false;
function spectateChoiceKey(){ return `rhymeMatchSpectate:${roomCode}`; }
function hasChosenSpectate(){
  try { return spectateChosen || sessionStorage.getItem(spectateChoiceKey()) === 'yes'; }
  catch(e){ return spectateChosen; }
}
function saveSpectateChoice(chosen){
  spectateChosen = chosen;
  try { if (chosen) sessionStorage.setItem(spectateChoiceKey(),'yes'); else sessionStorage.removeItem(spectateChoiceKey()); } catch(e){}
}
document.getElementById('btnChooseSpectate').addEventListener('click', async () => {
  if (isHost){ saveSpectateChoice(true); if (!await transferHost(true)) saveSpectateChoice(false); return; }
  saveSpectateChoice(true);
  document.getElementById('eliminatedChoices').hidden = true;
  showToast('Spectating live — you will see judging and results.', 'success');
});
document.getElementById('btnChooseExit').addEventListener('click', exitGame);
document.getElementById('btnSpectatorExit').addEventListener('click', exitGame);

/* --- RHYME SUBMISSION & TIMER --- */
const RING_CIRCUMFERENCE = 2 * Math.PI * 52;
function startRhymeEntry(targetWord){
  const me = lastKnownPlayers.find(p => p.id === myUid);
  UIManager.updateHeader(currentRound, me ? me.score : localScore, engine.mode, false);
  UIManager.showView('submitRhymeView');
  document.getElementById('displayTargetWord').innerText = targetWord;
  document.getElementById('displayTargetWord').classList.toggle('long-word', targetWord.length > 9);
  const predictionBox = document.getElementById('answerPrediction');
  const predictionPick = document.getElementById('predictionPick');
  predictionBox.hidden = !(engine.roundRule?.modifier === 'prediction' && currentRound === engine.predictionRound);
  if (!predictionBox.hidden){
    predictionPick.innerHTML = '<option value="">Skip prediction · no points gained or lost</option>' +
      lastKnownPlayers.filter(p => p.id !== myUid && !p.eliminated && p.connected !== false && !p.pendingNextRound)
        .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
    document.getElementById('predictionPayoff').textContent = `Correct: +${engine.predictionStake}. Wrong: −${Math.ceil(engine.predictionStake / 2)}. Tied top partners count; no matches means no winner.`;
  }
  const rule = engine.roundRule || {};
  const ruleBox = document.getElementById('answerRule');
  const meState = lastKnownPlayers.find(p => p.id === myUid) || engine.players.get(myUid) || {};
  const ruleText = {
    streak:`🔥 Match streak: ${meState.streak || 0} · bonus on this match: +${Math.max(0,(meState.streak || 0) + 1) >= 2 ? (meState.streak || 0) + 1 : 0} · next: +${Math.max(2,(meState.streak || 0) + 2)}`,
    shrinking:`⏳ The clock has shrunk to ${currentTimerSeconds}s.`,
    chaos:`🎲 This round's surprise clock is ${currentTimerSeconds}s.`,
    bounty:`🎯 Current solo bounty: +${((meState.bountyRun || 0) + 1) * 2} on top of +4 · next bounty: +${((meState.bountyRun || 0) + 2) * 2}.`,
    lives:`❤️ Lives remaining: ${meState.lives ?? 3}${(meState.lives ?? 3) === 1 ? ' · Last life!' : ''}`,
    twist:rule.challenge ? `🎭 ${rule.challenge.text}` : ''
  }[rule.modifier] || '';
  ruleBox.hidden = !ruleText;
  ruleBox.textContent = ruleText;

  const inputEl = document.getElementById('inputRhyme');
  inputEl.placeholder = `Rhyme with ${targetWord}`;
  inputEl.value = '';
  inputEl.type = 'password';
  inputEl.disabled = false;
  document.getElementById('btnToggleVisibility').innerText = 'Show';

  const submitBtn = document.getElementById('btnSubmitRhyme');
  submitBtn.disabled = true;
  document.getElementById('rhymeWaitMsg').style.display = 'none';
  updateReadyStatus(0, lastKnownPlayers.filter(p => !p.eliminated && p.connected !== false && !p.pendingNextRound).length);
  inputEl.focus();

  const ring = document.getElementById('timerRingFg');
  ring.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  ring.classList.remove('warn','danger');
  document.getElementById('submitStageCard').classList.remove('time-low');

  let timeLeft = currentTimerSeconds;
  const total = currentTimerSeconds;
  const deadline = performance.now() + total * 1000;
  document.getElementById('timerDisplay').innerText = timeLeft;
  updateRing(ring, timeLeft, total);
  clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    timeLeft = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    document.getElementById('timerDisplay').innerText = Math.max(timeLeft, 0);
    updateRing(ring, timeLeft, total);
    if (timeLeft <= Math.min(5, total)) {
      document.getElementById('submitStageCard').classList.add('time-low');
      if (timeLeft > 0) Sound.tick();
    }
    if (timeLeft <= 0) {
      clearInterval(countdownInterval);
      document.getElementById('submitStageCard').classList.remove('time-low');
      if (!inputEl.disabled) processRhymeSubmission(true);
      if (isHost && document.getElementById('submitRhymeView').classList.contains('active')){
        engine.activePlayers().forEach(player => {
          if (!engine.submissions.has(player.id)) engine.registerSubmission(player.id, '');
        });
        broadcastReadyStatus();
        openHostJudgingPhase();
      }
    }
  }, 1000);
}
function updateRing(ring, timeLeft, total){
  const frac = Math.max(timeLeft, 0) / total;
  ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - frac));
  ring.classList.remove('warn','danger');
  if (frac <= 0.33) ring.classList.add('danger');
  else if (frac <= 0.6) ring.classList.add('warn');
}

document.getElementById('btnSubmitRhyme').addEventListener('click', () => processRhymeSubmission(false));

function processRhymeSubmission(isAutoSubmit){
  if (!isHost) clearInterval(countdownInterval);
  const rhyme = document.getElementById('inputRhyme').value.trim();
  const pick = !document.getElementById('answerPrediction').hidden ? document.getElementById('predictionPick').value || null : null;
  if (isAutoSubmit && document.getElementById('inputRhyme').disabled) return;

  document.getElementById('inputRhyme').disabled = true;
  document.getElementById('btnSubmitRhyme').disabled = true;
  document.getElementById('submitStageCard').classList.remove('time-low');
  Sound.lock();

  const msgEl = document.getElementById('rhymeWaitMsg');
  if (isAutoSubmit && !rhyme) msgEl.innerText = "Time's up! No word submitted (penalty applied). Waiting for others...";
  else if (isAutoSubmit) msgEl.innerText = "Time's up! Your word was auto-submitted. Waiting for others...";
  else msgEl.innerText = "Locked in! Waiting for everyone else...";
  msgEl.style.display = 'block';

  if (isHost) {
    engine.registerSubmission(myUid, rhyme, pick);
    broadcastReadyStatus();
    if (engine.allSubmitted()) openHostJudgingPhase();
  } else {
    sendGuestCommand({ type:'SUBMIT_RHYME', word: rhyme, pick });
  }
}

/* --- HOST JUDGING PHASE --- */
function openHostJudgingPhase(){
  clearInterval(countdownInterval);
  UIManager.showView('judgingView');
  document.getElementById('judgeTargetWord').innerText = engine.targetWord;
  document.getElementById('hostJudgeControls').style.display = 'block';
  document.getElementById('clientJudgeWaitMsg').style.display = 'none';
  document.getElementById('judgeInstructions').innerText = engine.roundRule?.challenge ? `Check the rhyme and challenge: ${engine.roundRule.challenge.text} Tap any non-fitting word to mark it invalid.` : "Tap a word to mark it invalid if it doesn't actually rhyme.";

  renderHostJudgeItems();

  const payload = Array.from(engine.submissions.entries()).map(([id, s]) => ({
    name: engine.players.get(id).name, word: s.word, timeout: s.timeout, colorIndex: engine.players.get(id).colorIndex
  }));
  broadcastToGuests({ type:'JUDGING_PHASE', targetWord: engine.targetWord, submissions: payload });
}

function renderHostJudgeItems(){
  const list = document.getElementById('judgeSubmissionList');
  list.innerHTML = '';
  const wordCounts = {};
  engine.submissions.forEach(s => { if (!s.timeout) wordCounts[s.word] = (wordCounts[s.word] || 0) + 1; });

  engine.submissions.forEach((sub, id) => {
    const player = engine.players.get(id);
    if (!player) return;
    const div = document.createElement('div');
    const isMatch = !sub.timeout && wordCounts[sub.word] > 1;
    div.className = 'judge-item' + (isMatch ? ' matched' : '');

    if (sub.timeout) {
      div.innerHTML = `
        <div><div class="judge-name">${avatarDot(player.colorIndex)}${escapeHtml(player.name)}</div><span class="judge-word timeout">No submission</span></div>
        <button class="judge-toggle-btn" disabled style="background:var(--line);color:var(--paper);">Timed out</button>`;
    } else {
      div.innerHTML = `
        <div><div class="judge-name">${avatarDot(player.colorIndex)}${escapeHtml(player.name)}</div>
          <span class="judge-word">${escapeHtml(sub.word)}</span>${isMatch ? `<span class="match-badge">×${wordCounts[sub.word]} match</span>` : ''}
        </div>
        <button class="judge-toggle-btn ${sub.valid ? 'btn-success' : 'btn-danger'}">${sub.valid ? 'Valid ✓' : 'Invalid ✗'}</button>`;
      div.querySelector('button').onclick = () => { Sound.click(); engine.toggleWordValidity(id); renderHostJudgeItems(); };
    }
    list.appendChild(div);
  });
}

function openClientJudgingPhase(targetWord, submissions){
  UIManager.showView('judgingView');
  document.getElementById('judgeTargetWord').innerText = targetWord;
  document.getElementById('hostJudgeControls').style.display = 'none';
  document.getElementById('clientJudgeWaitMsg').style.display = 'block';
  setConnectionStatus('Connected — host reviewing answers', 'online');
  document.getElementById('judgeInstructions').innerText = engine.roundRule?.challenge ? `The host is checking rhymes and the challenge: ${engine.roundRule.challenge.text}` : "Everyone's locked in! The host is checking the rhymes.";

  const list = document.getElementById('judgeSubmissionList');
  list.innerHTML = submissions.map(s => {
    if (s.timeout) return `<div class="judge-item"><div><div class="judge-name">${avatarDot(s.colorIndex)}${escapeHtml(s.name)}</div><span class="judge-word timeout">No submission</span></div></div>`;
    return `<div class="judge-item"><div><div class="judge-name">${avatarDot(s.colorIndex)}${escapeHtml(s.name)}</div><span class="judge-word">${escapeHtml(s.word)}</span></div><span style="font-size:11.5px;color:var(--muted);">Reviewing...</span></div>`;
  }).join('');
}

document.getElementById('btnFinalizeScores').addEventListener('click', () => {
  if (!isHost) return;
  const results = engine.calculateScores();
  updatePredictionResults(engine, results);
  const elim = engine.applyElimination();
  results.lifeLostNames = elim.lifeLostNames || [];
  results.submissions.forEach(sub => { const player = engine.players.get(sub.id); if (player){ sub.roundEvent = player.roundEvent || ''; sub.lives = player.lives ?? 3; } });
  if (elim.gameOver && engine.predictionRound) { settlePredictionResults(engine, results); delete results.voteProgress; }
  engine.players.forEach(player => { player.lastDelta = player.delta; });
  const playersSnapshot = Array.from(engine.players.values());
  lastResultsPacket = { results, players:playersSnapshot, eliminatedNames:elim.eliminatedNames, gameOver:elim.gameOver, winnerName:elim.winnerName };

  Sound.reveal();
  displayResults(results, playersSnapshot, elim.eliminatedNames, elim.gameOver, elim.winnerName);
  broadcastToGuests({ type:'ROUND_OVER', results, players: playersSnapshot, eliminatedNames: elim.eliminatedNames, gameOver: elim.gameOver, winnerName: elim.winnerName });
});

/* --- RESULTS DISPLAY --- */
function displayResults(results, players, eliminatedNames, gameOver, winnerName){
  const me = players.find(p => p.id === myUid);
  if (me) { localScore = me.score; UIManager.updateHeader(results.round, localScore, results.mode || engine.mode, me.eliminated); }
  lastKnownPlayers = players;

  UIManager.showView('resultsView');
  UIManager.renderScoreboard(players);
  document.getElementById('eliminatedChoices').hidden = !me?.eliminated || me.connected === false || hasChosenSpectate();

  const ranking = ResultsRanking.build(players);
  const submissions = new Map((results.submissions || []).map(submission => [submission.id, submission]));
  const myStanding = ranking.round.find(row => row.player.id === myUid);
  let html = '<div class="round-story">';
  if (gameOver && winnerName) html += `<div class="winner-banner"><span class="trophy" aria-hidden="true">🏆</span><div>Champion</div><div class="winner-name">${escapeHtml(winnerName)}</div></div>`;
  html += `<div class="headline-banner">${escapeHtml(buildHeadline(results))}</div>`;
  if (eliminatedNames && eliminatedNames.length) html += `<div class="elim-banner">💀 ${eliminatedNames.map(escapeHtml).join(', ')} eliminated this round</div>`;
  if (results.lifeLostNames?.length) html += `<div class="elim-banner">❤️ ${results.lifeLostNames.map(escapeHtml).join(', ')} lost a life</div>`;
  html += `<p class="target-context">Target word: <b style="color:var(--confetti);">${escapeHtml(results.target)}</b></p></div>`;
  if (results.challenge) html += `<p class="answer-rule">🎭 Challenge: ${escapeHtml(results.challenge.text)}</p>`;
  html += '<section aria-label="Points this round"><h3 class="results-section-title">Points This Round <small>Sorted by round points</small></h3><div class="round-ranking">';
  ranking.round.forEach(row => {
    const p = row.player;
    const sub = submissions.get(p.id);
    const delta = Number(p.delta) || 0;
    const movement = row.movement > 0 ? `↑ ${row.movement}` : row.movement < 0 ? `↓ ${Math.abs(row.movement)}` : '—';
    const movementLabel = row.movement > 0 ? `Up ${row.movement} ${row.movement === 1 ? 'place' : 'places'}` : row.movement < 0 ? `Down ${Math.abs(row.movement)} ${row.movement === -1 ? 'place' : 'places'}` : 'No rank change';
    let word = sub && sub.word ? escapeHtml(sub.word) : 'No submission';
    if (sub?.outOfGame) word = sub.disconnected ? 'Disconnected' : sub.waiting ? 'Joining next round' : 'Spectating';
    else if (sub?.timeout) word = 'No submission';
    else if (sub && !sub.valid) word += ' · invalid rhyme';
    else if (sub?.matches >= 2) word += ` · ${sub.matches}-player match`;
    else if (sub && results.mode === 'lonewolf') word += ' · Lone Wolf';
    else if (sub) word += ' · no match';
    if (sub?.roundEvent) word += ` · ${escapeHtml(sub.roundEvent)}`;
    if (results.mode === 'suddendeath' && results.modifier === 'lives' && !sub?.outOfGame) word += ` · ❤️ ${sub?.lives ?? 3}`;
    const predictionDelta = sub ? delta - (Number(sub.pointsEarned) || 0) : 0;
    if (predictionDelta) word += ` · prediction ${formatDelta(predictionDelta)}`;
    const tone = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
    html += `<div class="round-rank-row ${tone} ${row.roundRank <= 3 ? 'top-three' : ''} ${p.id === myUid ? 'you' : ''} ${sub?.outOfGame ? 'out' : ''}">
      <span class="rank-movement ${row.movement > 0 ? 'up' : row.movement < 0 ? 'down' : ''}" aria-label="${movementLabel}"><strong>${movement}</strong><span>rank</span></span>
      <span class="round-player"><span class="round-player-name">${avatarDot(p.colorIndex)}${escapeHtml(p.name)}${p.id === myUid ? '<span class="you-tag">YOU</span>' : ''}</span><span class="round-player-detail">${word}</span></span>
      <span class="round-score ${tone}"><strong>${formatDelta(delta)}</strong><small>→ ${p.score} total</small></span>
    </div>`;
  });
  html += '</div></section>';
  const topThree = ranking.standings.slice(0, 3);
  html += `<section class="standings-snapshot" aria-label="Current standings"><h3>Current Standings</h3><div class="standings-chips">${topThree.map((p, i) => `<span class="standings-chip ${p.id === myUid ? 'you' : ''}">${i + 1}. ${avatarDot(p.colorIndex)}${escapeHtml(p.name)} ${p.score}</span>`).join('')}</div>`;
  if (myStanding) html += `<p class="standings-summary">${ranking.standings[0].id === myUid ? 'You lead' : `${escapeHtml(ranking.standings[0].name)} leads`} with ${ranking.standings[0].score} · You are #${myStanding.currentRank} with ${myStanding.player.score}.</p>`;
  html += '</section>';
  if (results.voteProgress) html += `<p class="standings-summary">🔮 Your partner prediction settles after round ${results.voteProgress}.</p>`;
  if (results.voteResults?.length) html += `<details class="prediction-details"><summary>Prediction Results</summary>${results.voteResults.map(v => `<p>${escapeHtml(v.voterName)}: ${v.pickName ? escapeHtml(v.pickName) + ' (' + v.matches + ' matches)' : 'skipped'} · ${formatDelta(v.delta)}</p>`).join('')}</details>`;

  document.getElementById('resultsContent').innerHTML = html;
  window.scrollTo(0, 0);
  if (gameOver) spawnConfetti();
  if (gameOver) Sound.win();

  const nextBtn = document.getElementById('btnNextRound');
  const chooseBtn = document.getElementById('btnChooseTarget');
  const rematchBtn = document.getElementById('btnRematch');
  const lobbyBtn = document.getElementById('btnReturnLobby');
  document.getElementById('resultsWaiting').hidden = isHost;

  if (isHost) {
    lobbyBtn.style.display = 'inline-block';
    chooseBtn.style.display = gameOver ? 'none' : 'inline-block';
    chooseBtn.onclick = () => startNextRound('choose');
    if (gameOver) {
      nextBtn.style.display = 'none';
      rematchBtn.style.display = 'inline-block';
      rematchBtn.onclick = () => {
        engine.resetForRematch();
        saveSpectateChoice(false);
        currentRound = 1;
        UIManager.updateHeader(1, 0, engine.mode, false);
        broadcastRoster();
        UIManager.showView('targetSetupView');
        renderModeGrid();
      };
    } else {
      nextBtn.style.display = 'inline-block';
      rematchBtn.style.display = 'none';
      nextBtn.onclick = () => startNextRound('quick');
    }
    lobbyBtn.onclick = () => {
      saveSpectateChoice(false);
      engine.round = 0;
      engine.roundRule = null;
      engine.clockRun = null;
      engine.twistHistory = [];
      engine.predictions.clear();
      engine.predictionRound = 0;
      engine.predictionEndRound = 0;
      engine.predictionCounts.clear();
      engine.predictionStake = 0;
      engine.mode = engine.mode;
      engine.players.forEach(p => { p.score = 0; p.delta = 0; p.lastDelta = null; p.eliminated = false; p.streak = 0; p.bountyRun = 0; p.lives = 3; p.roundBonus = 0; p.roundEvent = ''; });
      localScore = 0; currentRound = 1;
      UIManager.updateHeader(1, 0, engine.mode, false);
      UIManager.showView('lobbyView');
      broadcastRoster();
      engine.promoteWaiting();
      broadcastRoster();
      broadcastToGuests({ type:'LOBBY_RETURN' });
    };
  } else {
    nextBtn.style.display = 'none';
    chooseBtn.style.display = 'none';
    rematchBtn.style.display = 'none';
    lobbyBtn.style.display = 'none';
  }
}
