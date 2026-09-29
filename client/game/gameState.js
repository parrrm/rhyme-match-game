import { calculateScores, applyElimination } from './scoring.js';
import { defaultModeSettings } from './modes.js';
import { rememberTarget } from './words.js';
import { normalizeWord } from './normalize.js';

const PLAYER_COLORS = ['#ff4d6a','#3d9dff','#b6ff3c','#ffd23d','#b26bff','#29e2ff','#ff8a3d','#ff5cc0'];
function playerColor(idx){ return PLAYER_COLORS[(idx || 0) % PLAYER_COLORS.length]; }
class RhymeGameEngine {
  constructor(){
    this.round = 0;
    this.mode = 'classic';
    this.settings = defaultModeSettings();
    this.roundRule = null;
    this.clockRun = null;
    this.twistHistory = [];
    this.targetWord = "";
    this.players = new Map();
    this.submissions = new Map();
    this.predictions = new Map();
    this.predictionRound = 0;
    this.predictionEndRound = 0;
    this.predictionCounts = new Map();
    this.predictionStake = 0;
    this.phase = 'lobbyView';
    this.roundStartedAt = null;
    this.roundExpiresAt = null;
    this.roundPlayerIds = [];
  }
  addPlayer(id, name){
    const colorIndex = this.players.size % PLAYER_COLORS.length;
    this.players.set(id, { id, name, score:0, delta:0, lastDelta:null, eliminated:false, colorIndex, connected:true, pendingNextRound:false, sessionId:null, streak:0, bountyRun:0, lives:3, roundBonus:0, roundEvent:'' });
  }
  removePlayer(id){ this.players.delete(id); this.submissions.delete(id); this.predictions.delete(id); this.predictionCounts.delete(id); }
  activePlayers(){ return Array.from(this.players.values()).filter(p => p.connected !== false && !p.pendingNextRound && !p.eliminated); }
  roundPlayers(){ return this.roundPlayerIds.map(id => this.players.get(id)).filter(p => p && !p.eliminated); }
  markDisconnected(id){
    const player = this.players.get(id);
    if (!player || player.connected === false) return false;
    player.connected = false;
    return true;
  }
  promoteWaiting(){
    this.players.forEach(p => { if (p.connected !== false) p.pendingNextRound = false; });
  }
  rekeyPlayer(oldId, newId, name){
    const player = this.players.get(oldId);
    if (!player) return null;
    this.players.delete(oldId);
    player.id = newId;
    player.name = name;
    player.connected = true;
    this.players.set(newId, player);
    this.roundPlayerIds = this.roundPlayerIds.map(id => id === oldId ? newId : id);
    for (const map of [this.submissions, this.predictions, this.predictionCounts]){
      if (map.has(oldId)){ const value = map.get(oldId); map.delete(oldId); map.set(newId, value); }
    }
    this.predictions.forEach((pick, voterId) => { if (pick === oldId) this.predictions.set(voterId, newId); });
    this.predictionCounts.forEach(counts => {
      if (counts.has(oldId)){ const count = counts.get(oldId); counts.delete(oldId); counts.set(newId, count); }
    });
    return player;
  }
  initRound(targetWord){
    this.round += 1;
    this.targetWord = normalizeWord(targetWord);
    rememberTarget(this.targetWord);
    this.submissions.clear();
    this.roundStartedAt = null;
    this.roundExpiresAt = null;
    this.roundPlayerIds = [];
    this.players.forEach(p => { p.delta = 0; p.roundBonus = 0; p.roundEvent = ''; });
  }
  registerSubmission(id, rawWord, pick = null, round = this.round, now = Date.now()){
    const player = this.players.get(id);
    if (!player || player.eliminated || player.pendingNextRound || !this.roundPlayerIds.includes(id) ||
      this.phase !== 'submitRhymeView' || round !== this.round || this.submissions.has(id) ||
      this.roundExpiresAt == null || !Number.isFinite(now) || now < this.roundStartedAt || now > this.roundExpiresAt ||
      typeof rawWord !== 'string' || rawWord.length > 64) return false;
    const word = normalizeWord(rawWord);
    const isTimeout = word === "";
    this.submissions.set(id, { word, valid: !isTimeout && word !== this.targetWord, timeout: isTimeout });
    if (this.round === this.predictionRound && !this.predictions.has(id)){
      const chosen = this.roundPlayers().some(p => p.id === pick && p.id !== id) ? pick : null;
      this.predictions.set(id, chosen);
    }
    return true;
  }
  registerTimeout(id){
    if (this.submissions.has(id) || !this.roundPlayerIds.includes(id)) return false;
    this.submissions.set(id, { word:'', valid:false, timeout:true });
    return true;
  }
  allSubmitted(){ const active = this.roundPlayers(); return active.length > 0 && active.every(p => this.submissions.has(p.id)); }
  toggleWordValidity(id){
    const sub = this.submissions.get(id);
    if (sub && !sub.timeout && sub.word !== this.targetWord) sub.valid = !sub.valid;
  }
  calculateScores(){ return calculateScores(this); }
  applyElimination(){ return applyElimination(this); }
  resetForRematch(){
    this.round = 0;
    this.roundRule = null;
    this.phase = 'lobbyView';
    this.roundStartedAt = null;
    this.roundExpiresAt = null;
    this.roundPlayerIds = [];
    this.clockRun = null;
    this.twistHistory = [];
    this.predictions.clear();
    this.predictionRound = 0;
    this.predictionEndRound = 0;
    this.predictionCounts.clear();
    this.predictionStake = 0;
    this.players.forEach(p => { p.score = 0; p.delta = 0; p.lastDelta = null; p.eliminated = false; p.streak = 0; p.bountyRun = 0; p.lives = 3; p.roundBonus = 0; p.roundEvent = ''; if (p.connected !== false) p.pendingNextRound = false; });
  }
}


export { PLAYER_COLORS, playerColor, RhymeGameEngine };
