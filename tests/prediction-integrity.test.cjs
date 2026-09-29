const test = require('node:test');
const assert = require('node:assert/strict');

let Engine, countPredictionMatches, predictionAwards, updatePredictionResults;
test.before(async () => {
  globalThis.localStorage = { getItem:() => null, setItem:() => {} };
  ({ RhymeGameEngine:Engine } = await import('../client/game/gameState.js'));
  ({ countPredictionMatches, predictionAwards, updatePredictionResults } = await import('../client/game/scoring.js'));
});
function players(){
  const e = new Engine();
  for (const id of ['a','b','c','d']) e.addPlayer(id,id.toUpperCase());
  return e;
}
function row(id, word, valid = true, extras = {}){ return {id,word,valid,timeout:false,outOfGame:false,...extras}; }

test('prediction counts only finalized valid matches and does not mutate the previous totals', () => {
  const previous = new Map([['a',new Map([['b',2]])],['b',new Map()],['c',new Map()],['d',new Map()]]);
  const next = countPredictionMatches(previous,[row('a','BAT'),row('b','BAT'),row('c','BAT',false),row('d','BAT',true,{outOfGame:true})]);
  assert.equal(next.get('a').get('b'),3);
  assert.equal(next.get('b').get('a'),1);
  assert.equal(next.get('a').has('c'),false);
  assert.equal(next.get('a').has('d'),false);
  assert.equal(previous.get('a').get('b'),2);
});

test('missing and invalid answers cannot create prediction matches for any voter', () => {
  const counts = new Map(['a','b','c','d'].map(id => [id,new Map()]));
  const next = countPredictionMatches(counts,[
    row('a','BAT'), row('b','',false,{timeout:true}), row('c','BAT',false), row('d','BAT')
  ]);
  assert.deepEqual([...next.get('a')],[['d',1]]);
  assert.deepEqual([...next.get('b')],[]);
  assert.deepEqual([...next.get('c')],[]);
  assert.deepEqual([...next.get('d')],[['a',1]]);
});

test('multiple voters can each correctly predict the same partner', () => {
  const e = players();
  const picks = new Map([['a','b'],['c','b']]);
  const counts = new Map([['a',new Map([['b',2]])],['c',new Map([['b',2]])]]);
  assert.deepEqual(predictionAwards(picks,counts,4,e.players).map(x => x.delta),[4,4]);
});

test('prediction awards correct, incorrect, skipped and tied top partners deterministically', () => {
  const e = players();
  const picks = new Map([['a','b'],['b','c'],['c',null],['d','a']]);
  const counts = new Map([
    ['a',new Map([['b',3],['c',3]])],
    ['b',new Map([['a',3],['c',1]])],
    ['c',new Map()],
    ['d',new Map()]
  ]);
  assert.deepEqual(predictionAwards(picks,counts,4,e.players).map(x => x.delta),[4,-2,0,-2]);
  assert.equal(e.players.get('a').score,0);
  e.players.get('d').eliminated = true;
  assert.deepEqual(predictionAwards(picks,counts,4,e.players).map(x => x.voterId),['a','b','c']);
});

test('prediction totals accumulate across rounds and settle once', () => {
  const e = players();
  e.predictionRound = 1; e.predictionEndRound = 3; e.predictionStake = 4;
  e.predictions = new Map([['a','b'],['b','a'],['c',null]]);
  e.predictionCounts = new Map([['a',new Map()],['b',new Map()],['c',new Map()]]);
  for (let round = 1; round <= 3; round++){
    const result = {round,submissions:round === 2 ? [row('a','HAT'),row('b','BAT'),row('c','BAT',false)] : [row('a','BAT'),row('b','BAT'),row('c','',false,{timeout:true})]};
    updatePredictionResults(e,result);
    if (round < 3) assert.equal(result.voteProgress,3);
    else assert.deepEqual(result.voteResults.map(x => x.delta),[4,4,0]);
  }
  assert.deepEqual(['a','b','c'].map(id => e.players.get(id).score),[4,4,0]);
  assert.equal(e.predictionRound,0);
});

test('first prediction and answer remain locked even with repeat input', () => {
  const e = players(); e.predictionRound = 1; e.initRound('CAT');
  e.roundPlayerIds = ['a','b','c','d']; e.phase = 'submitRhymeView'; e.roundExpiresAt = 10000;
  assert.equal(e.registerSubmission('a','BAT','b',1,1000),true);
  assert.equal(e.registerSubmission('a','HAT','c',1,1001),false);
  assert.equal(e.predictions.get('a'),'b');
  assert.equal(e.submissions.get('a').word,'BAT');
});
