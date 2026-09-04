---
applyTo: "**/*.js,**/*.md,**/*.html"
---

# WebRTC signaling + NAT/ICE debugging

## Purpose

Use this skill whenever the task involves WebRTC room setup, peer connection negotiation, Firebase signaling, ICE connectivity, NAT traversal issues, or “looks connected but no video/audio is flowing” failures.

This project is a browser-to-browser meeting app that uses Firebase only for signaling and peer coordination. The actual media path is direct WebRTC between browsers. The important distinction is:

- Firebase carries metadata such as SDP offers/answers and ICE candidates.
- The real audio/video traffic is peer-to-peer and can fail even when signaling succeeds.

## Project-specific context

This repository is a two-person WebRTC meeting app with:

- shared room keys for rendezvous
- Firebase Realtime Database as the signaling channel
- `RTCPeerConnection` negotiation for SDP and ICE
- optional STUN/TURN configuration for NAT traversal
- browser device selection and audio output tuning
- PWA packaging and service worker lifecycle in separate files

The core app logic is in `app.js`, and the architecture is described in `docs/p2p-meeting-architecture.md`.

## Required debugging approach

When debugging a WebRTC issue, do not jump directly to editing the app. First reason through the full lifecycle.

1. Confirm the room/key flow
   - Is the room being created or joined correctly?
   - Is one side the caller and the other the callee?
   - Are participant slots or room state being cleaned up correctly?

2. Trace signaling state
   - Check Firebase paths such as:
     - `rooms/{roomName}/offer`
     - `rooms/{roomName}/answer`
     - `rooms/{roomName}/callerCandidates`
     - `rooms/{roomName}/calleeCandidates`
     - `rooms/{roomName}/participants/caller`
     - `rooms/{roomName}/participants/callee`
   - Confirm that the remote side actually receives the SDP and ICE candidate data.

3. Trace peer connection state
   - Check `onicecandidate`, `ontrack`, `onconnectionstatechange`, and `iceconnectionstatechange`.
   - Verify the peer connection is created only once per role.
   - Look for duplicate listeners, stale state, or reset flows that leave old connections behind.

4. Separate signaling success from media success
   - A Firebase write succeeding does not mean direct media is working.
   - A browser may appear “connected” at the signaling layer while ICE cannot establish a successful direct path.
   - In enterprise or restrictive networks, the signaling path can work while the media plane fails.

5. Inspect NAT/firewall/ICE possibilities
   - Check `rtcConfig` and STUN/TURN server usage.
   - Decide whether the issue is likely:
     - candidate gathering failure
     - answer/offer not exchanged
     - ICE candidate mismatch
     - blocked direct UDP media
     - firewall/VPN/NAT restrictions
     - remote video track never arrives

6. Verify cleanup and stale data
   - When a room is abandoned or a peer disconnects, stale Firebase state can confuse the next attempt.
   - Look for cleanup via `remove()`, `onDisconnect()`, `runTransaction()`, and room reset flows.

## Questions to answer before proposing a fix

When debugging WebRTC here, the assistant should explicitly answer:

- Is the problem in room creation, join logic, or role assignment?
- Did the offer or answer arrive at the expected Firebase path?
- Are the ICE candidates being published and consumed as expected?
- Does the remote side receive a `MediaStreamTrack` via `ontrack`?
- Is the failure caused by browser permissions, network policy, or NAT traversal?
- Are stale room records or old peer state causing the next session to fail?

## Must-check implementation points

The assistant should pay special attention to the following patterns in this codebase:

- `runTransaction()` used for role assignment and session coordination
- `onChildAdded()` or `onValue()` listeners for remote SDP/candidates
- `setLocalDescription()` and `setRemoteDescription()` time ordering
- `addIceCandidate()` usage and candidate queuing
- `peerConnection.ontrack` to confirm remote media arrives
- cleanup logic around `beforeunload`, disconnect handlers, and role-specific Firebase paths

## Rules for diagnosis

- Treat signaling and media as separate layers.
- Do not assume a Firebase success means the call is healthy.
- Do not ignore candidate gathering or ICE state transitions.
- Do not propose “just reconnect” fixes without checking stale room state.
- Do not treat every failure as a Firebase bug; many WebRTC failures are network path or browser policy issues.

## Typical issue patterns in this app

The assistant should recognize these patterns:

- room appears created, but no answer arrives
- both peers connect to Firebase but never exchange media
- one side has remote candidates queued but not applied
- app says “Connected” but remote audio/video never appears
- stale room data prevents a fresh room key from starting cleanly
- browser is on a restrictive corporate network or behind a VPN and ICE fails

## Example prompts this skill is designed for

- “Why does the call establish signaling but never show remote video?”
- “Trace the caller/callee room flow and find where the SDP exchange breaks.”
- “Why do ICE candidates keep failing even though the room is created?”
- “The app says connected but the remote track never arrives. Diagnose the likely cause.”
- “Check stale room cleanup and whether a prior session is preventing new WebRTC negotiation.”
- “Explain the difference between a Firebase signaling problem and a NAT/ICE connectivity problem here.”

## Expected output style

When working on a WebRTC issue under this skill, the assistant should:

- explain the relevant flow clearly
- distinguish signaling from media
- point to the exact room/role paths and API lifecycle points
- identify the most likely cause based on WebRTC semantics
- propose the smallest, safest next debugging step instead of a broad rewrite

## Do not do

- Do not treat this as a generic frontend bug without checking the signaling/ICE path.
- Do not suggest backend replacement when the issue is likely browser networking or ICE.
- Do not change peer-connection logic without first validating the room state and candidate flow.
- Do not forget to consider browser security restrictions and mobile constraints.

This skill is intended to help maintain the correct mental model for this project: direct browser-to-browser media, Firebase-only signaling, and a frequent need to debug connectivity rather than just code syntax.
