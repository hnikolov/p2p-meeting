# Room signaling design (v0.6.0)

This document describes how two browsers find each other, negotiate and recover. The implementation is [meeting-session.js](../meeting-session.js); [app.js](../app.js) only connects it to local media and the UI.

It replaces the lease/timestamp design used up to v0.5.12. The previous docs `stale-room-problem.md`, `webrtc-sudden-disconnect.md` and `webrtc-media-watchdog.md` described that design.

## Why the design changed

Up to v0.5.12 the first connection often failed when the host had been waiting for a few minutes:

1. The host published its offer and ICE candidates **when the room was created**. The offer SDP contained no candidates; the candidates were stored separately and never renewed.
2. Liveness was inferred from **client timestamps** (leases). The joiner ran a cleanup that deleted "expired" records written by the *other* peer, including the host's ICE candidates (after 45 s, later 8 min).
3. The joiner then received a valid offer but no candidates, and ICE failed.
4. The recovery paths (reconnect, media watchdog, manual Disconnect) were separate special cases. Disconnect deleted the other peer's records too, which left the room half-populated ("busy", or two callers).

Each fix tuned one of these behaviours. The new design removes all of them.

## Three building blocks

### 1. Presence comes from Firebase `onDisconnect`

Each client registers `onDisconnect().remove()` for its own records **before** writing them. The Firebase **server** runs these when the client's connection ends: tab closed, browser crashed, machine asleep or network lost. A clean close is handled immediately; a dead connection within about a minute.

As a result:
- there are no leases, timestamps, clock offsets or refresh timers;
- **no client ever deletes another client's data.**

A tab that is only in the background does **not** lose presence:
- its websocket stays open;
- Chrome does not freeze or discard tabs that hold a live camera/mic track;
- presence no longer depends on page timers.

If the socket does drop briefly, the SDK reconnects and the client restores its member record (see the lifecycle below).

### 2. Data model: each peer owns only its own subtree

```
rooms/{room}/members/{peerId}               { joinedAt: <server timestamp> }
rooms/{room}/signals/{fromId}/{toId}/{push} { description: {type, sdp} } | { candidate: {...} }
```

- `peerId` is a fresh Firebase `push()` key for **every Call press**. Leftovers from an old tab can never be confused with a new join.
- `signals/{from}/{to}` is the mailbox for exactly one peer-connection pairing. Replaying it when subscribing is always correct, so no sessionId filtering and no candidate queue are needed.
- `onDisconnect` on `members/{self}` and `signals/{self}` removes everything the peer ever wrote. When both people leave, the room node disappears by itself.
- **A peer connection is created only when both members are present.** Descriptions and candidates are therefore always fresh, however long someone waited.

### 3. Negotiation: "perfect negotiation" (W3C / MDN pattern)

- Both sides run identical code. There are no caller/callee roles and no start/join modes.
- `polite = selfId > remoteId`. Push keys are chronological, so the later joiner is polite.
- Only the impolite side makes the first offer; the polite side's tracks go into its answer. Later renegotiations (ICE restarts) may come from either side, and offer collisions are resolved by the pattern: the polite side rolls back, the impolite side ignores the incoming offer.
- Incoming messages are processed strictly in send order through one promise chain.

Reference: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation

## Lifecycle

| Event | Action |
|---|---|
| **Call** pressed | New `peerId`. Register the `onDisconnect`s. Add self to `members` in a transaction (max 2; otherwise "Room is full"). Listen to `members`. Status: *Waiting for the other person…* |
| A member appears (not me, not previously closed) | Create the PC, add local tracks, listen to `signals/{remote}/{self}`. Negotiation starts by itself. Status: *Connecting…* |
| PC `connected` | Status: *Connected*. Clear recovery timers. Start the elapsed timer. |
| PC `disconnected` for more than 5 s, or `failed`, while the remote is still a member | **Recovery step 1:** `pc.restartIce()`, renegotiated in-session through the same mailbox. |
| Still not connected 30 s (+0–5 s jitter) after the PC was created or ICE was restarted | **Recovery step 2: rejoin.** Remove own records and join again with a new `peerId`. The other side sees old-id-left / new-id-joined and builds a fresh PC. |
| The remote member leaves while the PC is not `connected` (or once it stops being connected) | Close the PC. Status: *The other person left. Waiting…*. **Stay in the room**, so the other person can press Call again without any action on this side. |
| Firebase `.info/connected` becomes true again | Re-register the `onDisconnect`s and re-`set` the member record (same id). |
| **Leave** / page unload | Close the PC and remove only our own `members/{self}` and `signals/{self}`. |

A connected PC is kept when the remote member record briefly disappears, because a Firebase blip on the other side also removes that record. It is closed as soon as it stops being connected.

## Operational notes

- **Old and new versions are incompatible.** v0.6.0 does not see rooms created by v0.5.x and vice versa. Both people must run v0.6.0; the version is shown in the UI.
- **Service worker:** network-first for the app's own files, so a single reload while online gets the latest code. Right after deploying v0.6.0, the old cache-first worker still serves the first load, so reload once more.
- **Legacy data:** records left by v0.5.x under `rooms/*` (`offer`, `answer`, `participants`, `*Candidates`) are ignored. The room debug panel (key `F`) lists them as "Legacy data", and they can be deleted in the Firebase console.
- **Database rules** must allow authenticated reads/writes under `rooms/$room/members` and `rooms/$room/signals`; for example `{ "rooms": { ".read": "auth != null", ".write": "auth != null" } }`.
- **TURN:** none is configured; the free `openrelay.metered.ca` service was removed because it no longer responds. Networks that cannot connect directly (strict NAT or corporate firewalls) need a working TURN server. This is independent of the signaling design.
