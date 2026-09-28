import { RHYME_FIREBASE_CONFIG } from '../../firebase-config.js?esm=1';
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const subscriptions = [];
let database = null;
let auth = null;
let lastCommandSeq = 0;

function roomRandomId(){
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return Array.from(window.crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
}
function makeRoomCode(){
  const bytes = window.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}
function validRoomCode(value){ return /^[A-Z2-9]{8}$/.test(value); }
function localSessionId(code){
  const key = 'rhymeMatchSession:' + code;
  try {
    let value = sessionStorage.getItem(key);
    if (!value){ value = roomRandomId(); sessionStorage.setItem(key, value); }
    return value;
  } catch(e){ return roomRandomId(); }
}
function subscribe(ref, event, callback, cancel){ ref.on(event, callback, cancel); subscriptions.push(() => ref.off(event, callback)); }
function clearSubscriptions(){ subscriptions.splice(0).forEach(off => off()); }
async function authenticate(){
  if (typeof firebase === 'undefined' || !RHYME_FIREBASE_CONFIG){
    throw { code:'auth/network-request-failed', message:'Firebase library did not load' };
  }
  if (!database){
    firebase.initializeApp(RHYME_FIREBASE_CONFIG);
    auth = firebase.auth();
    database = firebase.database();
  }
  const credential = await auth.signInAnonymously();
  return { database, user:credential.user };
}
function nextCommandSeq(roomCode){
  const key = 'rhymeMatchCommandSeq:' + roomCode;
  let previous = lastCommandSeq;
  try { previous = Math.max(previous, Number(localStorage.getItem(key)) || 0); } catch(e){}
  lastCommandSeq = Math.max(Date.now() * 1000, previous + 1);
  try { localStorage.setItem(key, String(lastCommandSeq)); } catch(e){}
  return lastCommandSeq;
}
function roomUrl(code, isRoomHost){
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  url.searchParams.delete('host');
  url.searchParams.set(isRoomHost ? 'host' : 'room', code);
  return url.toString();
}

async function publishPresence(roomRef, isHost, myUid, localConnectionId){
  const root = isHost ? roomRef.child('hostConnections') : roomRef.child('presence').child(myUid);
  const ref = root.child(localConnectionId);
  await ref.onDisconnect().remove();
  await ref.set({ at:firebase.database.ServerValue.TIMESTAMP });
}
function persistHostState(roomRef, state, snapshot){
  return Promise.all([roomRef.child('hostState').set(state), roomRef.child('snapshot').set(snapshot)]);
}
function publishHostMessage(roomRef, uid, message){
  return roomRef.child('messages').child(uid).set(message);
}
function publishGuestCommand(roomRef, uid, command){
  return roomRef.child('commands').child(uid).set(command);
}

export { ROOM_LIFETIME_MS, roomRandomId, makeRoomCode, validRoomCode, localSessionId, roomUrl, subscribe, clearSubscriptions, authenticate, nextCommandSeq, publishPresence, persistHostState, publishHostMessage, publishGuestCommand };
