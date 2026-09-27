const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const definitions = source.slice(source.indexOf('const MODES ='), source.indexOf('/* Each mode gets its own accent'));
const engineCode = source.slice(source.indexOf('class RhymeGameEngine'), source.indexOf('/* ============================================================\n   NETWORKING & APP STATE'));
const Engine = vm.runInNewContext(`${definitions}\nconst PLAYER_COLORS = Array(8).fill('');\nfunction rememberTarget(){}\n${engineCode}\nRhymeGameEngine`);
const timerCode = source.slice(source.indexOf('function resolveRoundTimer()'), source.indexOf('function beginRound('));
const predictionCode = source.slice(source.indexOf('function settlePredictionResults('), source.indexOf('/* --- TARGET SETUP (HOST) --- */'));
function resolveTimer(engine, random = 0){
  const math = Object.create(Math); math.random = () => random;
  return vm.runInNewContext(`${definitions}\n${timerCode}\nresolveRoundTimer()`, { engine, Math:math });
}

function round(engine, mode, modifier, answers){
  engine.mode = mode;
  engine.initRound('CAT');
  engine.roundRule = {modifier};
  answers.forEach(([id, word]) => engine.registerSubmission(id, word));
  return engine.calculateScores();
}

test('streak rewards consecutive matches and resets on a solo answer', () => {
  const e = new Engine(); e.addPlayer('a','A'); e.addPlayer('b','B');
  assert.equal(round(e,'classic','streak',[['a','BAT'],['b','BAT']]).submissions[0].pointsEarned,3);
  assert.equal(round(e,'classic','streak',[['a','BAT'],['b','BAT']]).submissions[0].pointsEarned,5);
  assert.equal(round(e,'classic','streak',[['a','HAT'],['b','BAT']]).submissions[0].streak,0);
  assert.equal(round(e,'classic','streak',[['a','BAT'],['b','BAT']]).submissions[0].pointsEarned,3);
});

test('bounty grows on consecutive solo answers and resets on a match', () => {
  const e = new Engine(); e.addPlayer('a','A'); e.addPlayer('b','B');
  assert.equal(round(e,'lonewolf','bounty',[['a','BAT'],['b','HAT']]).submissions[0].pointsEarned,6);
  assert.equal(round(e,'lonewolf','bounty',[['a','BAT'],['b','HAT']]).submissions[0].pointsEarned,8);
  assert.equal(round(e,'lonewolf','bounty',[['a','BAT'],['b','BAT']]).submissions[0].pointsEarned,1);
});

test('three lives eliminates only when the losing player reaches zero', () => {
  const e = new Engine(); e.addPlayer('a','A'); e.addPlayer('b','B');
  for (let i=2; i>=0; i--){
    round(e,'suddendeath','lives',[['a','BAT'],['b','']]);
    const outcome = e.applyElimination();
    assert.equal(e.players.get('b').lives,i);
    assert.equal(e.players.get('b').eliminated,i===0);
    assert.deepEqual(Array.from(outcome.eliminatedNames),i===0?['B']:[]);
  }
});

test('prediction choice locks with first submitted answer and skip is explicit', () => {
  const e = new Engine(); e.addPlayer('a','A'); e.addPlayer('b','B');
  e.predictionRound = 1;
  e.initRound('CAT');
  e.registerSubmission('a','BAT','b');
  e.registerSubmission('b','BAT',null);
  assert.equal(e.predictions.get('a'),'b');
  assert.equal(e.predictions.get('b'),null);
});

test('default and custom timers remain separate for all modes', () => {
  const e = new Engine();
  for (const [mode, expected] of [['classic',20],['speed',12],['lonewolf',15],['suddendeath',15]]){
    e.mode=mode;
    assert.equal(resolveTimer(e),expected);
    e.settings[mode].timerMode='custom'; e.settings[mode].customSeconds=23;
    assert.equal(resolveTimer(e),23);
  }
});

test('shrinking uses the configured start and a playable floor', () => {
  const e = new Engine(); e.mode='speed'; e.settings.speed.modifier='shrinking';
  assert.deepEqual([resolveTimer(e),resolveTimer(e),resolveTimer(e),resolveTimer(e),resolveTimer(e),resolveTimer(e)],[12,11,10,9,8,8]);
  e.settings.speed.timerMode='custom'; e.settings.speed.customSeconds=15;
  assert.deepEqual([resolveTimer(e),resolveTimer(e),resolveTimer(e),resolveTimer(e),resolveTimer(e),resolveTimer(e),resolveTimer(e)],[15,14,13,12,11,10,10]);
});

test('chaos selects a single whole duration in the 7–10 second range', () => {
  const e = new Engine(); e.mode='speed'; e.settings.speed.modifier='chaos';
  assert.deepEqual([resolveTimer(e,0),resolveTimer(e,.25),resolveTimer(e,.5),resolveTimer(e,.99)],[7,8,9,10]);
});

test('prediction settles correct, wrong, skip and tied leaders with the active-player stake', () => {
  const e = new Engine();
  for (const id of ['a','b','c']) e.addPlayer(id,id.toUpperCase());
  e.predictionRound=6; e.predictionEndRound=10; e.predictionStake=3;
  e.predictions=new Map([['a','b'],['b','c'],['c',null]]);
  e.predictionCounts=new Map([
    ['a',new Map([['b',2],['c',2]])],
    ['b',new Map([['a',2],['c',0]])],
    ['c',new Map([['a',1]])]
  ]);
  const settle = vm.runInNewContext(`${predictionCode}\nsettlePredictionResults`,{engine:e});
  const results={}; settle(results);
  assert.deepEqual(Array.from(results.voteResults,v=>v.delta),[3,-2,0]);
  assert.deepEqual(['a','b','c'].map(id=>e.players.get(id).score),[3,-2,0]);
  assert.equal(e.predictionRound,0);
});
