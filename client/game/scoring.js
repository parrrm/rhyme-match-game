import { MODES } from './modes.js';

function roundScoreDeltas(engine){
    const cfg = MODES[engine.mode];
    const modifier = engine.roundRule?.modifier || 'none';
    const validGroupCounts = Object.create(null);
    engine.roundPlayers().forEach(p => {
      const s = engine.submissions.get(p.id);
      if (s && s.valid && !s.timeout && s.word.length > 0) validGroupCounts[s.word] = (validGroupCounts[s.word] || 0) + 1;
    });
    const outcomes = new Map();
    engine.roundPlayers().forEach(player => {
      const sub = engine.submissions.get(player.id);
      const base = { delta:0, streak:0, bountyRun:0, roundBonus:0, roundEvent:'' };
      if (!sub || sub.timeout) base.delta = cfg.timeout;
      else if (!sub.valid) base.delta = cfg.invalid;
      else {
        const count = validGroupCounts[sub.word] || 0;
        base.delta = cfg.points(count);
        if (modifier === 'streak'){
          base.streak = count >= 2 ? (player.streak || 0) + 1 : 0;
          if (base.streak >= 2){ base.roundBonus = base.streak; base.roundEvent = `🔥 ${base.streak}-round streak`; }
          else if (!base.streak) base.roundEvent = 'Streak broken';
        }
        if (modifier === 'bounty'){
          base.bountyRun = count === 1 ? (player.bountyRun || 0) + 1 : 0;
          if (base.bountyRun){ base.roundBonus = base.bountyRun * 2; base.roundEvent = `🎯 Solo bounty +${base.roundBonus}`; }
          else base.roundEvent = 'Bounty reset';
        }
        base.delta += base.roundBonus;
      }
      outcomes.set(player.id, base);
    });
    return { validGroupCounts, outcomes };
}
function calculateScores(engine){
    const modifier = engine.roundRule?.modifier || 'none';
    const { validGroupCounts, outcomes } = roundScoreDeltas(engine);
    engine.players.forEach(player => {
      const outcome = outcomes.get(player.id);
      if (!outcome){ player.delta = 0; return; }
      Object.assign(player, outcome);
      player.score += outcome.delta;
    });

    return {
      target: engine.targetWord,
      round: engine.round,
      mode: engine.mode,
      modifier,
      challenge:engine.roundRule?.challenge || null,
      submissions: Array.from(engine.players.entries()).map(([id, p]) => {
        if (!engine.roundPlayerIds.includes(id) || p.eliminated) return { id, name: p.name, word:"", valid:false, timeout:false, matches:0, pointsEarned:0, outOfGame:true, colorIndex:p.colorIndex, waiting:p.pendingNextRound, disconnected:p.connected === false };
        const s = engine.submissions.get(id) || { word:"", valid:false, timeout:true };
        const matchCount = s.valid && !s.timeout ? (validGroupCounts[s.word] || 0) : 0;
        return { id, name:p.name, word:s.word, valid:s.valid, timeout:s.timeout, matches:matchCount, pointsEarned:p.delta, bonus:p.roundBonus || 0, roundEvent:p.roundEvent || '', streak:p.streak || 0, bountyRun:p.bountyRun || 0, outOfGame:false, colorIndex:p.colorIndex };
      })
    };
  }

function applyElimination(engine){
    const cfg = MODES[engine.mode];
    if (!cfg.elimination) return { eliminatedNames: [], lifeLostNames:[], gameOver:false, winnerName:null };
    const active = engine.roundPlayers();
    if (active.length <= 1) return { eliminatedNames: [], lifeLostNames:[], gameOver:true, winnerName: active[0] ? active[0].name : null };
    const minScore = Math.min(...active.map(p => p.score));
    let toEliminate = active.filter(p => p.score === minScore);
    // An all-way tie has no loser; play another round rather than using join order.
    if (toEliminate.length >= active.length) toEliminate = [];
    const threeLives = engine.roundRule?.modifier === 'lives';
    toEliminate.forEach(p => {
      if (threeLives){ p.lives = Math.max(0, (p.lives ?? 3) - 1); p.roundEvent = `Lost a life · ${p.lives} left`; }
      if (!threeLives || p.lives === 0) p.eliminated = true;
    });
    const remaining = engine.roundPlayers();
    const gameOver = remaining.length <= 1;
    return { eliminatedNames: toEliminate.filter(p => p.eliminated).map(p => p.name), lifeLostNames:threeLives ? toEliminate.filter(p => !p.eliminated).map(p => p.name) : [], gameOver, winnerName: gameOver ? (remaining[0] ? remaining[0].name : null) : null };
  }

function countPredictionMatches(previousCounts, submissions){
  const counts = new Map([...previousCounts].map(([id, partners]) => [id, new Map(partners)]));
  const valid = submissions.filter(s => !s.outOfGame && s.valid && !s.timeout);
  for (const voter of valid){
    const partners = counts.get(voter.id);
    if (!partners) continue;
    for (const partner of valid){
      if (partner.id !== voter.id && partner.word === voter.word)
        partners.set(partner.id, (partners.get(partner.id) || 0) + 1);
    }
  }
  return counts;
}
function predictionAwards(predictions, countsByVoter, stake, players){
  const reward = stake;
  const penalty = Math.ceil(reward / 2);
  return [...predictions].flatMap(([pick, partnerId]) => {
    const voter = players.get(pick);
    if (!voter || voter.eliminated) return [];
    const counts = countsByVoter.get(pick) || new Map();
    const most = Math.max(0, ...counts.values());
    const pickedMatches = counts.get(partnerId) || 0;
    const delta = partnerId === null ? 0 : (most > 0 && pickedMatches === most ? reward : -penalty);
    return [{ voterId:pick, voterName:voter.name, pickName:partnerId && players.get(partnerId) ? players.get(partnerId).name : null, matches:pickedMatches, delta }];
  });
}
function settlePredictionResults(engine, results){
  if (!engine.predictionRound) return;
  const awards = predictionAwards(engine.predictions, engine.predictionCounts, engine.predictionStake, engine.players);
  results.voteResults = awards.map(({voterId, ...award}) => award);
  awards.forEach(({voterId, delta}) => {
    const voter = engine.players.get(voterId);
    voter.score += delta;
    voter.delta += delta;
  });
  engine.predictions.clear();
  engine.predictionCounts.clear();
  engine.predictionRound = 0;
  engine.predictionEndRound = 0;
  engine.predictionStake = 0;
}
function updatePredictionResults(engine, results){
  if (!engine.predictionRound || results.round < engine.predictionRound) return;
  engine.predictionCounts = countPredictionMatches(engine.predictionCounts, results.submissions);
  if (results.round >= engine.predictionEndRound) settlePredictionResults(engine, results);
  else results.voteProgress = engine.predictionEndRound;
}


export { roundScoreDeltas, calculateScores, applyElimination, countPredictionMatches, predictionAwards, settlePredictionResults, updatePredictionResults };
