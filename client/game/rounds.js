import { configuredTimer, shrinkingFloor } from './modes.js';
import { pickTwistChallenge } from './words.js';

function resolveRoundTimer(engine, random = Math.random){
  const modeKey = engine.mode;
  const config = engine.settings[modeKey];
  const start = configuredTimer(modeKey, engine.settings);
  if (config.modifier === 'chaos'){
    engine.clockRun = null;
    return 7 + Math.floor(random() * 4);
  }
  if (config.modifier === 'shrinking'){
    const key = `${modeKey}:shrinking:${start}`;
    engine.clockRun = engine.clockRun?.key === key ? { key, count:engine.clockRun.count + 1 } : { key, count:1 };
    return Math.max(shrinkingFloor(start), start - engine.clockRun.count + 1);
  }
  engine.clockRun = null;
  return start;
}
function prepareRound(engine, targetWord){
  engine.initRound(targetWord);
  const currentTimerSeconds = resolveRoundTimer(engine);
  const modifier = engine.settings[engine.mode].modifier;
  const challenge = modifier === 'twist' ? pickTwistChallenge(engine.targetWord, engine.twistHistory) : null;
  if (challenge) engine.twistHistory = [...engine.twistHistory, challenge.id].slice(-10);
  engine.roundRule = { mode:engine.mode, modifier, timerSeconds:currentTimerSeconds, challenge };
  engine.promoteWaiting();
  if (engine.mode === 'classic' && engine.roundRule.modifier === 'prediction' && engine.round > 1 && engine.round % 5 === 1){
    engine.predictionRound = engine.round;
    engine.predictionEndRound = engine.round + 4;
    engine.predictionStake = engine.activePlayers().length;
    engine.predictions.clear();
    engine.predictionCounts = new Map(engine.activePlayers().map(p => [p.id, new Map()]));
  } else if (engine.predictionRound && (engine.mode !== 'classic' || engine.roundRule.modifier !== 'prediction')){
    engine.predictionRound = 0; engine.predictionEndRound = 0; engine.predictionStake = 0;
    engine.predictions.clear(); engine.predictionCounts.clear();
  }
  return challenge;
}

export { resolveRoundTimer, prepareRound };
