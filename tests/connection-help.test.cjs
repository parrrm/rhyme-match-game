const assert = require('node:assert/strict');
const test = require('node:test');
const { classify, issues } = require('../connection-help.js');

test('offline device wins over secondary errors', () => {
  assert.equal(classify({ online:false, code:'network' }), 'offline');
});
test('service, permission, missing room, absent host and stalled sync have distinct guidance', () => {
  assert.equal(classify({ online:true, code:'auth/network-request-failed' }), 'service');
  assert.equal(classify({ online:true, code:'PERMISSION_DENIED' }), 'permission');
  assert.equal(classify({ online:true, code:'room-not-found' }), 'room');
  assert.equal(classify({ online:true, code:'room-full' }), 'full');
  assert.equal(classify({ online:true, code:'same-browser-host' }), 'sameBrowser');
  assert.equal(classify({ online:true, hostOnline:false }), 'host');
  assert.equal(classify({ online:true, stage:'ack' }), 'sync');
  for (const kind of ['offline','service','permission','room','full','sameBrowser','host','sync','connection']) {
    assert.ok(issues[kind].title);
    assert.ok(issues[kind].steps.length >= 2);
  }
});
