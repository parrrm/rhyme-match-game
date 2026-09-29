const test = require('node:test');
const assert = require('node:assert/strict');

let Engine, prepareRound, startRoundClock, recoverRoundPhase, pickTarget, roundScoreDeltas;
test.before(async () => {
  const storage = new Map();
  globalThis.localStorage = { getItem:key => storage.get(key) ?? null, setItem:(key,value) => storage.set(key,String(value)) };
  ({ RhymeGameEngine:Engine } = await import('../client/game/gameState.js'));
  ({ prepareRound, startRoundClock, recoverRoundPhase } = await import('../client/game/rounds.js'));
  ({ pickTarget } = await import('../client/game/words.js'));
  ({ roundScoreDeltas } = await import('../client/game/scoring.js'));
});
function entry(mode = 'classic', modifier = 'none', target = 'CAT'){
  const engine = new Engine();
  engine.addPlayer('a','A'); engine.addPlayer('b','B');
  engine.mode = mode;
  engine.settings[mode].modifier = modifier;
  const prepared = prepareRound(engine, target);
  assert.equal(prepared.error, undefined);
  startRoundClock(engine, 1000);
  return engine;
}

test('round one random target uses the same preparation path for every mode and modifier', () => {
  for (const [mode, modifiers] of Object.entries({ classic:['none','prediction','twist','streak'], speed:['none','streak','shrinking','chaos'], lonewolf:['none','bounty'], suddendeath:['none','lives'] })){
    for (const modifier of modifiers){
      const engine = new Engine(); engine.addPlayer('a','A'); engine.addPlayer('b','B');
      engine.mode = mode; engine.settings[mode].modifier = modifier;
      const target = pickTarget();
      const prepared = prepareRound(engine, target);
      assert.equal(engine.round, 1, `${mode}/${modifier}`);
      assert.equal(engine.targetWord, target, `${mode}/${modifier}`);
      assert.equal(prepared.error, undefined, `${mode}/${modifier}`);
      if (modifier === 'twist') assert.ok(prepared.challenge);
    }
  }
});

test('round start requires two active players without advancing round', () => {
  const engine = new Engine(); engine.addPlayer('a','A');
  assert.equal(prepareRound(engine, 'CAT').error, 'min-players');
  assert.equal(engine.round, 0);
});

test('unsupported custom Twist target fails without advancing round', () => {
  const engine = new Engine(); engine.addPlayer('a','A'); engine.addPlayer('b','B');
  engine.settings.classic.modifier = 'twist';
  assert.equal(prepareRound(engine,'UNKNOWNWORD').error,'unsupported-twist-target');
  assert.equal(engine.round,0);
  assert.equal(engine.targetWord,'');
});

test('one deadline governs recovery and stale, duplicate, post-deadline commands', () => {
  const engine = entry();
  assert.equal(engine.roundExpiresAt, 21000);
  assert.equal(recoverRoundPhase(engine, 20999), 'submitRhymeView');
  assert.equal(recoverRoundPhase(engine, 21000), 'judgingView');
  assert.equal(engine.registerSubmission('a','BAT',null,0,2000), false);
  assert.equal(engine.registerSubmission('a','BAT',null,1,21001), false);
  assert.equal(engine.registerSubmission('a','BAT',null,1,2000), true);
  assert.equal(engine.registerSubmission('a','HAT',null,1,2001), false);
  assert.equal(engine.submissions.get('a').word, 'BAT');
  engine.markDisconnected('a');
  assert.equal(engine.submissions.get('a').word, 'BAT');
  engine.registerTimeout('b');
  assert.equal(engine.allSubmitted(), true);
  engine.phase = 'judgingView';
  assert.equal(engine.registerSubmission('b','HAT',null,1,2000), false);
});

test('canonical punctuation, case, whitespace and target rejection affect scoring', () => {
  const engine = entry();
  engine.registerSubmission('a','  bat!  ',null,1,2000);
  engine.registerSubmission('b','BAT',null,1,2000);
  const before = [...engine.players].map(([id,p]) => [id,p.score]);
  const preview = roundScoreDeltas(engine);
  assert.deepEqual([...engine.players].map(([id,p]) => [id,p.score]), before);
  assert.equal(preview.outcomes.get('a').delta, 3);
  assert.deepEqual(engine.calculateScores().submissions.map(s => s.pointsEarned), [3,3]);
  const target = entry();
  target.registerSubmission('a','cat!',null,1,2000);
  target.registerSubmission('b',' CAT ',null,1,2000);
  target.toggleWordValidity('a');
  assert.equal(target.submissions.get('a').valid,false);
  assert.deepEqual(target.calculateScores().submissions.map(s => s.pointsEarned), [-2,-2]);
});

test('all-way Sudden Death ties preserve everyone; a unique lowest score loses', () => {
  const tied = entry('suddendeath');
  tied.registerSubmission('a','BAT',null,1,2000);
  tied.registerSubmission('b','BAT',null,1,2000);
  tied.calculateScores();
  assert.deepEqual(tied.applyElimination().eliminatedNames, []);
  assert.deepEqual([...tied.players.values()].map(p => p.eliminated), [false,false]);
  const decided = entry('suddendeath');
  decided.registerSubmission('a','BAT',null,1,2000);
  decided.registerTimeout('b');
  decided.calculateScores();
  assert.deepEqual(decided.applyElimination().eliminatedNames, ['B']);
});

test('a locked disconnected participant retains the earned match', () => {
  const engine = entry();
  engine.registerSubmission('a','BAT',null,1,2000);
  engine.markDisconnected('a');
  engine.registerSubmission('b','BAT',null,1,2000);
  assert.deepEqual(engine.calculateScores().submissions.map(s => s.pointsEarned), [3,3]);
});

test('identity transfer keeps the active round participant and locked answer', () => {
  const engine = entry();
  engine.registerSubmission('a','BAT',null,1,2000);
  engine.rekeyPlayer('a','replacement','A');
  assert.deepEqual(engine.roundPlayerIds,['replacement','b']);
  assert.equal(engine.submissions.get('replacement').word,'BAT');
  engine.registerSubmission('b','BAT',null,1,2000);
  assert.deepEqual(engine.calculateScores().submissions.map(s => s.pointsEarned),[3,3]);
});
