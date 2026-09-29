const test = require('node:test');
const assert = require('node:assert/strict');

let localSessionId, publishHostMessage;
test.before(async () => {
  globalThis.window = { crypto:globalThis.crypto };
  globalThis.sessionStorage = { getItem:() => { throw new Error('blocked'); }, setItem:() => { throw new Error('blocked'); } };
  ({localSessionId,publishHostMessage} = await import('../client/room/roomManager.js'));
});

test('session ID remains stable when session storage is blocked', () => {
  const first = localSessionId('ABCDEFGH');
  assert.equal(localSessionId('ABCDEFGH'),first);
  assert.notEqual(localSessionId('BCDEFGHJ'),first);
});

test('join and roster events use separate ordered keys', async () => {
  const writes = [];
  const ref = {child(key){ writes.push(key); return this; },set(message){ writes.push(message.type); return Promise.resolve(); }};
  await publishHostMessage(ref,'guest',{seq:100,type:'ROOM_STATE'});
  await publishHostMessage(ref,'guest',{seq:101,type:'ROSTER_UPDATE'});
  assert.deepEqual(writes,['messages','guest','100','ROOM_STATE','messages','guest','101','ROSTER_UPDATE']);
});
