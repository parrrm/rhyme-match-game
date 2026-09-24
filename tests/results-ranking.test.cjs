const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../results-ranking.js');

test('round ranking and movement use the final delta including bonuses', () => {
  const result = build([
    { id:'alex', score:30, delta:2 },
    { id:'bea', score:35, delta:15 },
    { id:'cam', score:27, delta:-3 }
  ]);
  assert.deepEqual(result.round.map(row => row.player.id), ['bea','alex','cam']);
  assert.deepEqual(result.standings.map(player => player.id), ['bea','alex','cam']);
  assert.equal(result.round[0].movement, 2);
  assert.equal(result.round[1].movement, 0);
  assert.equal(result.round[2].movement, -2);
});

test('ties retain join order and empty rooms produce empty rankings', () => {
  assert.deepEqual(build([]), { standings:[], round:[] });
  const result = build([{ id:'first', score:5, delta:0 }, { id:'second', score:5, delta:0 }]);
  assert.deepEqual(result.round.map(row => row.player.id), ['first','second']);
  assert.deepEqual(result.round.map(row => row.movement), [0,0]);
});
