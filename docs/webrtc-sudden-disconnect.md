# Sudden WebRTC disconnects and recovery approach

## Summary

A temporary call disconnect can happen at several different layers, not just because the user clicked Leave or because Firebase room state expired. In a peer-to-peer WebRTC app, the active connection can disappear while the room itself still looks valid. This is especially common when:

- the ICE path is lost or becomes stale
- a NAT or firewall temporarily closes an UDP mapping
- the browser OS drops the network socket briefly
- the peer loses internet connectivity for a short time
- the app backgrounding or network changes cause a temporary connection interruption

When this happens, the room may still exist, the UI may still show a healthy room state, and the app may not immediately know that the actual media path has been interrupted.

## Relevant levels of failure

### 1. Signaling layer

The Firebase room used for SDP and ICE candidate exchange can remain available while the actual media session is broken.

This is typically visible in:

- missing or stale SDP updates
- missing or stale ICE candidate stream
- remote presence disappearing or becoming stale
- the app failing to re-establish an active peer connection

### 2. Peer connection layer

The browser `RTCPeerConnection` can move into one of these states:

- `connecting`
- `connected`
- `disconnected`
- `failed`
- `closed`

The `connectionState` is the most important signal. A drop to `disconnected` or `failed` means the media path is no longer healthy and the call should be treated as interrupted even if the room still exists.

### 3. ICE layer

The WebRTC transport can fail even while the signaling room looks valid. ICE can lose a working candidate pair or fail to re-establish a path after a brief network interruption. This is common in NAT-heavy or restrictive networks.

### 4. Remote presence layer

The app also tracks peer presence in Firebase. If the other peer disappears from the active room or the room state no longer shows a valid lease, that is another signal that the remote side is no longer available.

## Why a clean disconnect is not obvious

In a healthy app, a disconnect may look like a sudden drop in media with no crash and no loud error. The room may still exist, and both players may be able to enter again immediately. That means the app should treat sudden disconnects as recoverable network interruptions rather than as a fatal user action.

## Recovery model: soft reconnect instead of immediate reset

A good reconnect flow should not immediately destroy the entire app state. Instead it should:

- keep the same room key and intended session context
- show a reconnecting status to the user
- attempt a fresh `RTCPeerConnection`
- re-register signaling listeners and participant lease state
- re-negotiate SDP and ICE candidates
- retry with bounded backoff
- only fall back to the user after a small number of failed attempts

This gives a graceful user experience with limited disruption.

## Recommended behavior

When the peer connection transitions to `disconnected` or `failed`, the app should:

- stop the current session timer
- stop the stale lease loop temporarily
- clear the current room listeners
- preserve the room name and local media stream
- signal: `Connection lost — reconnecting…`
- create a new peer connection
- rebuild the room listeners and negotiation flow
- re-publish presence and ensure the participant lease is active again
- retry with backoff

If the reconnect fails repeatedly, then the app should fall back to the user-facing state:

- `Connection lost. Press Call to retry.`

## Why this is better than a hard reset

A hard reset is suitable for user-driven leave or irrecoverable failure. However, a sudden drop in a live call is often temporary and recoverable. A soft reconnect keeps the user in the same room and avoids a visible disruption when the network blip is short.

## Implementation direction for this project

The app already has the core building blocks to support this:

- room name tracking
- session ID / participant role tracking
- Firebase listeners for SDP and candidates
- participant lease refresh loop
- reset and cleanup functions
- `peerConnection.onconnectionstatechange`

The reconnect logic should be layered on top of these rather than built as a separate service.

## Important guardrails

The reconnect flow should be intentionally conservative:

- do not reconnect while the user has explicitly left the call
- do not create overlapping peer connections
- do not reuse stale room signals from a prior failed connection
- do not re-trigger reconnect if one is already running
- do not silently duplicate session state

This is the most important design constraint for a single-file app that already manages a lot of live state.

## Conclusion

A sudden disconnect is a real WebRTC network transition and can be recovered from. The app should detect the corresponding connection states and move into a reconnect flow instead of treating every drop as a permanent reset. With bounded retries and clear status text, the user experience can absorb brief network interruptions without forcing them to re-enter the room manually.
