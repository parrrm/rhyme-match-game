import { MODES } from './modes.js';

function calculateScores(engine){
    const cfg = MODES[engine.mode];
    const modifier = engine.roundRule?.modifier || 'none';
    const validGroupCounts = {};
    engine.activePlayers().forEach(p => {
      const s = engine.submissions.get(p.id);
      if (s && s.valid && !s.timeout && s.word.length > 0) validGroupCounts[s.word] = (validGroupCounts[s.word] || 0) + 1;
    });

    engine.players.forEach((player) => {
      if (player.eliminated || player.connected === false || player.pendingNextRound) { player.delta = 0; return; }
      const sub = engine.submissions.get(player.id);
      if (!sub || sub.timeout) { player.delta = cfg.timeout; player.score += cfg.timeout; player.streak = 0; player.bountyRun = 0; return; }
      if (!sub.valid) { player.delta = cfg.invalid; player.score += cfg.invalid; player.streak = 0; player.bountyRun = 0; return; }
      const count = validGroupCounts[sub.word] || 0;
      let points = cfg.points(count);
      if (modifier === 'streak'){
        player.streak = count >= 2 ? (player.streak || 0) + 1 : 0;
        if (player.streak >= 2){ player.roundBonus = player.streak; player.roundEvent = `🔥 ${player.streak}-round streak`; points += player.roundBonus; }
        else if (!player.streak) player.roundEvent = 'Streak broken';
      } else player.streak = 0;
      if (modifier === 'bounty'){
        player.bountyRun = count === 1 ? (player.bountyRun || 0) + 1 : 0;
        if (player.bountyRun){ player.roundBonus = player.bountyRun * 2; player.roundEvent = `🎯 Solo bounty +${player.roundBonus}`; points += player.roundBonus; }
        else player.roundEvent = 'Bounty reset';
      } else player.bountyRun = 0;
      player.delta = points;
      player.score += points;
    });

    return {
      target: engine.targetWord,
      round: engine.round,
      mode: engine.mode,
      modifier,
      challenge:engine.roundRule?.challenge || null,
      submissions: Array.from(engine.players.entries()).map(([id, p]) => {
        if (p.eliminated || p.connected === false || p.pendingNextRound) return { id, name: p.name, word:"", valid:false, timeout:false, matches:0, pointsEarned:0, outOfGame:true, colorIndex:p.colorIndex, waiting:p.pendingNextRound, disconnected:p.connected === false };
        const s = engine.submissions.get(id) || { word:"", valid:false, timeout:true };
        const matchCount = s.valid && !s.timeout ? (validGroupCounts[s.word] || 0) : 0;
        return { id, name:p.name, word:s.word, valid:s.valid, timeout:s.timeout, matches:matchCount, pointsEarned:p.delta, bonus:p.roundBonus || 0, roundEvent:p.roundEvent || '', streak:p.streak || 0, bountyRun:p.bountyRun || 0, outOfGame:false, colorIndex:p.colorIndex };
      })
    };
  }

function applyElimination(engine){
    const cfg = MODES[engine.mode];
    if (!cfg.elimination) return { eliminatedNames: [], lifeLostNames:[], gameOver:false, winnerName:null };
    const active = engine.activePlayers();
    if (active.length <= 1) return { eliminatedNames: [], lifeLostNames:[], gameOver:true, winnerName: active[0] ? active[0].name : null };
    const minScore = Math.min(...active.map(p => p.score));
    let toEliminate = active.filter(p => p.score === minScore);
    if (toEliminate.length >= active.length) toEliminate = [toEliminate[0]];
    const threeLives = engine.roundRule?.modifier === 'lives';
    toEliminate.forEach(p => {
      if (threeLives){ p.lives = Math.max(0, (p.lives ?? 3) - 1); p.roundEvent = `Lost a life · ${p.lives} left`; }
      if (!threeLives || p.lives === 0) p.eliminated = true;
    });
    const remaining = engine.activePlayers();
    const gameOver = remaining.length <= 1;
    return { eliminatedNames: toEliminate.filter(p => p.eliminated).map(p => p.name), lifeLostNames:threeLives ? toEliminate.filter(p => !p.eliminated).map(p => p.name) : [], gameOver, winnerName: gameOver ? (remaining[0] ? remaining[0].name : null) : null };
  }

function settlePredictionResults(engine, results){
  if (!engine.predictionRound) return;
  const reward = engine.predictionStake;
  const penalty = Math.ceil(reward / 2);
  results.voteResults = [];
  engine.predictions.forEach((pick, voterId) => {
    const voter = engine.players.get(voterId);
    if (!voter) return;
    const counts = engine.predictionCounts.get(voterId) || new Map();
    const most = Math.max(0, ...counts.values());
    const pickedMatches = counts.get(pick) || 0;
    const delta = pick === null ? 0 : (most > 0 && pickedMatches === most ? reward : -penalty);
    voter.score += delta;
    voter.delta += delta;
    results.voteResults.push({ voterName:voter.name, pickName:pick && engine.players.get(pick) ? engine.players.get(pick).name : null, matches:pickedMatches, delta });
  });
  engine.predictions.clear();
  engine.predictionCounts.clear();
  engine.predictionRound = 0;
  engine.predictionEndRound = 0;
  engine.predictionStake = 0;
}
function updatePredictionResults(engine, results){
  if (!engine.predictionRound || results.round < engine.predictionRound) return;
  const valid = results.submissions.filter(s => !s.outOfGame && s.valid && !s.timeout);
  for (const voter of valid){
    const counts = engine.predictionCounts.get(voter.id);
    if (!counts) continue;
    for (const partner of valid){
      if (partner.id !== voter.id && partner.word === voter.word){
        counts.set(partner.id, (counts.get(partner.id) || 0) + 1);
      }
    }
  }
  if (results.round >= engine.predictionEndRound) settlePredictionResults(engine, results);
  else results.voteProgress = engine.predictionEndRound;
}


export { calculateScores, applyElimination, settlePredictionResults, updatePredictionResults };
