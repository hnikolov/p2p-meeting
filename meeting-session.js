// Room signaling for a two-person call. See docs/signaling-design.md.
//
// Firebase layout (every peer writes only under its own id):
//   rooms/{room}/members/{peerId}                { joinedAt }
//   rooms/{room}/signals/{fromId}/{toId}/{push}  { description } | { candidate }
//
// - Presence comes from server-side onDisconnect(), not from timestamps.
// - A peer connection is created only once both members are present, so
//   descriptions and ICE candidates are always fresh.
// - Negotiation uses the W3C "perfect negotiation" pattern; both sides run
//   identical code and the polite side is derived from the two peer ids.
// - Recovery ladder: ICE restart first, then rejoin with a new peer id.
import {
  ref,
  push,
  set,
  remove,
  runTransaction,
  onChildAdded,
  onChildRemoved,
  onValue,
  onDisconnect,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

const MAX_MEMBERS = 2;
const DISCONNECTED_GRACE_MS = 5000;
const CONNECT_DEADLINE_MS = 30000;
const CONNECT_DEADLINE_JITTER_MS = 5000;

function toPlainDescription(description) {
  return { type: description.type, sdp: description.sdp };
}

/**
 * Status phases reported through onStatus(phase):
 *   'joining' | 'waiting' | 'connecting' | 'connected' | 'recovering' | 'peer-left'
 * Terminal phases (the session has ended by itself):
 *   'full' | 'error'
 */
export function createMeetingSession({
  db,
  roomName,
  rtcConfig,
  preparePeerConnection,
  onStatus = () => {},
  onPeerConnection = () => {},
  onRemoteTrack = () => {}
}) {
  const membersRef = ref(db, `rooms/${roomName}/members`);

  let ended = false;
  let selfId = null;
  let joined = false;
  let listeners = [];
  let remote = null;
  let closedRemoteIds = new Set();
  let presentMembers = new Set();

  const memberRef = () => ref(db, `rooms/${roomName}/members/${selfId}`);
  const outboxRef = () => ref(db, `rooms/${roomName}/signals/${selfId}`);
  const mailboxRef = (fromId, toId) => ref(db, `rooms/${roomName}/signals/${fromId}/${toId}`);

  function report(phase) {
    if (!ended || phase === 'full' || phase === 'error') {
      onStatus(phase);
    }
  }

  // ---------------------------------------------------------------- membership

  async function join() {
    selfId = push(membersRef).key;
    closedRemoteIds = new Set();
    presentMembers = new Set();
    report('joining');

    // Register server-side cleanup before writing anything.
    await onDisconnect(memberRef()).remove();
    await onDisconnect(outboxRef()).remove();

    const myId = selfId;
    const myMemberRef = memberRef();
    const result = await runTransaction(membersRef, (members) => {
      const current = members || {};
      const others = Object.keys(current).filter(id => id !== myId);
      if (others.length >= MAX_MEMBERS) {
        return undefined; // abort: room is full
      }
      return { ...current, [myId]: { joinedAt: serverTimestamp() } };
    });

    if (ended || selfId !== myId) {
      // leave() was called while the transaction was in flight.
      if (result.committed) await remove(myMemberRef).catch(() => {});
      return;
    }

    if (!result.committed) {
      ended = true;
      await Promise.allSettled([onDisconnect(myMemberRef).cancel(), onDisconnect(outboxRef()).cancel()]);
      report('full');
      return;
    }

    joined = true;
    report('waiting');

    listeners.push(
      onChildAdded(membersRef, snapshot => handleMemberAdded(snapshot.key)),
      onChildRemoved(membersRef, snapshot => handleMemberRemoved(snapshot.key)),
      onValue(ref(db, '.info/connected'), snapshot => {
        if (snapshot.val() === true) reassertMembership();
      })
    );
  }

  // After a Firebase reconnect the server has already run our onDisconnect
  // handlers, so re-register them and restore our member record (same id).
  async function reassertMembership() {
    if (ended || !joined) return;
    const myId = selfId;
    const myMemberRef = memberRef();
    try {
      await onDisconnect(myMemberRef).remove();
      await onDisconnect(outboxRef()).remove();
      if (ended || !joined || selfId !== myId) return; // left or rejoined meanwhile
      await set(myMemberRef, { joinedAt: serverTimestamp() });
    } catch (err) {
      console.warn('[meeting] could not restore membership:', err);
    }
  }

  function handleMemberAdded(id) {
    if (ended || id === selfId) return;
    presentMembers.add(id);

    if (remote && remote.id === id) {
      remote.present = true;
      return;
    }
    if (remote && !remote.present) {
      closeRemote(remote); // the previous peer left and came back under a new id
    }
    pairWithPresentMember();
  }

  function handleMemberRemoved(id) {
    presentMembers.delete(id);
    if (ended || !remote || remote.id !== id) return;

    remote.present = false;
    // A brief Firebase blip on the other side also removes its member record,
    // so keep a working media connection; it is closed once it stops working.
    if (remote.pc.connectionState !== 'connected') {
      peerLeft(remote);
    }
  }

  function peerLeft(peer) {
    closeRemote(peer);
    report('peer-left');
    pairWithPresentMember();
  }

  // Pairs with a present member we have not connected to yet (independent of
  // the order in which join/leave events arrive).
  function pairWithPresentMember() {
    if (ended || remote) return;
    const nextId = [...presentMembers].find(id => !closedRemoteIds.has(id));
    if (nextId) connectTo(nextId);
  }

  // ------------------------------------------------------------ peer connection

  function connectTo(id) {
    const pc = new RTCPeerConnection(rtcConfig);
    const peer = {
      id,
      pc,
      polite: selfId > id,
      present: true,
      makingOffer: false,
      ignoreOffer: false,
      queue: Promise.resolve(),
      unsubscribe: null,
      graceTimerId: null,
      deadlineTimerId: null
    };
    remote = peer;

    pc.ontrack = event => {
      if (remote === peer) onRemoteTrack(event);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && remote === peer) send(peer, { candidate: candidate.toJSON() });
    };

    pc.onnegotiationneeded = async () => {
      // Both sides add tracks at about the same time. Letting only the impolite
      // side make the first offer avoids a guaranteed offer collision; the
      // polite side's tracks are included in its answer.
      if (peer.polite && !peer.pc.remoteDescription) return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (remote === peer) send(peer, { description: toPlainDescription(pc.localDescription) });
      } catch (err) {
        console.warn('[meeting] negotiation failed:', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => handleConnectionState(peer);

    // Messages are applied strictly in the order they were sent.
    peer.unsubscribe = onChildAdded(mailboxRef(id, selfId), snapshot => {
      const message = snapshot.val();
      peer.queue = peer.queue
        .then(() => handleSignal(peer, message))
        .catch(err => console.warn('[meeting] signal handling failed:', err));
    });

    onPeerConnection(pc);
    preparePeerConnection(pc); // adds local tracks -> triggers negotiationneeded
    armConnectDeadline(peer);
    report('connecting');
  }

  function send(peer, message) {
    push(mailboxRef(selfId, peer.id), message).catch(err => {
      console.warn('[meeting] could not send signal:', err);
    });
  }

  async function handleSignal(peer, message) {
    if (remote !== peer || !message) return;
    const { pc } = peer;

    if (message.description) {
      const description = message.description;
      const offerCollision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && offerCollision;
      if (peer.ignoreOffer) return;

      await pc.setRemoteDescription(description); // rolls back our own offer if needed
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        if (remote === peer) send(peer, { description: toPlainDescription(pc.localDescription) });
      }
      return;
    }

    if (message.candidate) {
      try {
        await pc.addIceCandidate(message.candidate);
      } catch (err) {
        if (!peer.ignoreOffer) console.warn('[meeting] ICE candidate rejected:', err);
      }
    }
  }

  function handleConnectionState(peer) {
    if (remote !== peer) return;
    const state = peer.pc.connectionState;

    if (state === 'connected') {
      clearRecoveryTimers(peer);
      report('connected');
      return;
    }

    if (state === 'new' || state === 'connecting') return;

    if (!peer.present) {
      peerLeft(peer);
      return;
    }

    if (state === 'disconnected') {
      report('recovering');
      if (!peer.graceTimerId) {
        peer.graceTimerId = setTimeout(() => {
          peer.graceTimerId = null;
          restartIce(peer);
        }, DISCONNECTED_GRACE_MS);
      }
      return;
    }

    if (state === 'failed') {
      report('recovering');
      restartIce(peer);
    }
  }

  // Recovery step 1: ICE restart, renegotiated through the same mailbox.
  function restartIce(peer) {
    if (remote !== peer || peer.pc.connectionState === 'connected') return;
    if (peer.graceTimerId) {
      clearTimeout(peer.graceTimerId);
      peer.graceTimerId = null;
    }
    peer.pc.restartIce();
    armConnectDeadline(peer);
  }

  // Recovery step 2: if still not connected, rejoin under a new peer id.
  function armConnectDeadline(peer) {
    if (peer.deadlineTimerId) clearTimeout(peer.deadlineTimerId);
    const delayMs = CONNECT_DEADLINE_MS + Math.random() * CONNECT_DEADLINE_JITTER_MS;
    peer.deadlineTimerId = setTimeout(() => {
      peer.deadlineTimerId = null;
      if (remote === peer && peer.pc.connectionState !== 'connected') {
        rejoin();
      }
    }, delayMs);
  }

  function clearRecoveryTimers(peer) {
    if (peer.graceTimerId) clearTimeout(peer.graceTimerId);
    if (peer.deadlineTimerId) clearTimeout(peer.deadlineTimerId);
    peer.graceTimerId = null;
    peer.deadlineTimerId = null;
  }

  function closeRemote(peer) {
    clearRecoveryTimers(peer);
    if (peer.unsubscribe) peer.unsubscribe();
    peer.pc.ontrack = null;
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    closedRemoteIds.add(peer.id);

    if (remote === peer) {
      remote = null;
      onPeerConnection(null);
    }

    if (selfId) {
      remove(mailboxRef(selfId, peer.id)).catch(() => {});
    }
  }

  // ------------------------------------------------------------------ teardown

  async function teardown() {
    listeners.forEach(unsubscribe => unsubscribe());
    listeners = [];
    if (remote) closeRemote(remote);

    if (selfId && joined) {
      joined = false;
      const ownRefs = [memberRef(), outboxRef()];
      await Promise.allSettled(ownRefs.map(pathRef => remove(pathRef)));
    }
  }

  async function rejoin() {
    if (ended) return;
    report('recovering');
    await teardown();
    if (ended) return;
    try {
      await join();
    } catch (err) {
      fail(err);
    }
  }

  function fail(err) {
    console.error('[meeting] session failed:', err);
    if (ended) return;
    ended = true;
    teardown();
    report('error');
  }

  async function leave() {
    if (ended) return;
    ended = true;
    await teardown();
  }

  join().catch(fail);

  return {
    leave,
    get peerId() {
      return selfId;
    }
  };
}
