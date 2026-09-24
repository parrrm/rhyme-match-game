(function(root){
  'use strict';

  const issues = {
    offline: {
      title:'This device is offline',
      steps:['Turn on Wi-Fi or mobile data and check that another website opens.', 'Return here when connected. Your room link and nickname are still ready.']
    },
    service: {
      title:'The room service is unreachable',
      steps:['Try switching between Wi-Fi and mobile data, or turn off a VPN or restrictive network filter.', 'If other websites work but this keeps failing, try again later or use another network.']
    },
    permission: {
      title:'The room service refused access',
      steps:['Reload the page and try the same room link again.', 'If it persists for everyone, the game owner needs to check Firebase Authentication and Database rules.']
    },
    room: {
      title:'This room is unavailable',
      steps:['Check that you opened the host’s latest join link.', 'Ask the host whether the room was closed or expired.']
    },
    full: {
      title:'This room is full',
      steps:['Ask the host to make space or start another room.', 'Keep this link; you can try again if a place opens.']
    },
    sameBrowser: {
      title:'This browser is already hosting the room',
      steps:['Open the join link on another device or in a private browser window.', 'Keep the host tab open on this browser.']
    },
    host: {
      title:'The host is temporarily away',
      steps:['Stay in this room; other players can remain here while the host reconnects.', 'Ask the host to reopen the same room link if they do not return.']
    },
    sync: {
      title:'Room synchronization stalled',
      steps:['Press Retry to fetch the room again. Do not create another room.', 'If it repeats, reload and rejoin with the same link and nickname. Report the room code and time to the game owner.']
    },
    connection: {
      title:'The connection dropped',
      steps:['Check your internet connection, then press Retry.', 'If it keeps happening on one network, try another Wi-Fi or mobile data connection.']
    }
  };

  function classify(input){
    const { online=true, code='', stage='', serviceReachable=null, hostOnline=null } = input || {};
    if (online === false) return 'offline';
    if (code === 'permission-denied' || code === 'PERMISSION_DENIED' || code === 'auth/operation-not-allowed' || code === 'auth/invalid-api-key') return 'permission';
    if (code === 'room-not-found' || code === 'room-expired' || code === 'peer-unavailable') return 'room';
    if (code === 'room-full') return 'full';
    if (code === 'same-browser-host') return 'sameBrowser';
    if (hostOnline === false || stage === 'host-disconnect') return 'host';
    if (serviceReachable === false || code === 'auth/network-request-failed' || code === 'network' || stage === 'signaling') return 'service';
    if (stage === 'ack' || stage === 'identity' || code === 'identity-mismatch') return 'sync';
    return 'connection';
  }

  root.ConnectionHelp = { classify, issues };
  if (typeof module !== 'undefined' && module.exports) module.exports = { classify, issues };
})(typeof window !== 'undefined' ? window : globalThis);
