# P2P Meeting App: Concept, Technologies, and Topology

## 1. Executive summary

This application is a two-person WebRTC meeting app built in plain HTML, CSS, and JavaScript. It is designed to let two browsers connect directly and exchange audio/video without a dedicated media server in the main path.

The important distinction is this:

- There is no media server for the actual video/audio stream.
- The app does use a signaling backend, in this case Firebase Realtime Database, to exchange session metadata such as SDP offers/answers and ICE candidates.
- It still relies on STUN and optional TURN servers for NAT traversal and connectivity setup.

So the application is not fully "serverless" in the absolute sense, but it is serverless in the media plane: the audio and video traffic is peer-to-peer once the connection is established.

---

## 2. Main concept: direct browser-to-browser meeting

The app creates a WebRTC peer connection between the two participants, using the browser's native media APIs:

- `navigator.mediaDevices.getUserMedia()` captures local camera and microphone.
- `RTCPeerConnection` handles SDP negotiation, ICE candidate exchange, and the actual WebRTC media channel.
- A shared room key acts as the rendezvous identifier for both peers.
- Firebase is used only as a tiny signaling and coordination fabric.

The room key is not a media route. It is simply the address at which two browsers look for each other in the shared signaling data tree.

In practice, the flow is:

1. Browser A creates a local stream.
2. Browser A creates an offer and writes it to Firebase under `rooms/{room}/offer`.
3. Browser B sees the offer, creates its own peer connection, and responds with an answer.
4. Both browsers exchange ICE candidates through Firebase.
5. Once ICE succeeds, the browsers create a direct media path and the stream begins flowing peer-to-peer.

This is the standard WebRTC pattern for browser-to-browser communication.

---

## 3. Technologies used in this implementation

### 3.1 WebRTC core

The app builds the actual call using the browser WebRTC API:

- `RTCPeerConnection`
- `MediaStream`
- `getUserMedia()`
- `setLocalDescription()` / `setRemoteDescription()`
- `createOffer()` / `createAnswer()`
- ICE candidates and SDP exchange

This is the real mechanism that makes the direct P2P connection possible.

### 3.2 Firebase as signaling broker

The project imports Firebase JS SDK modules for:

- `initializeApp()`
- `getDatabase()`
- `getAuth()`
- `signInAnonymously()`
- `ref()`, `set()`, `get()`, `onValue()`, `onChildAdded()`, `remove()`, `runTransaction()`, `onDisconnect()`

The browser authenticates anonymously and then uses the Firebase Realtime Database as a lightweight coordination layer.

The app writes signals such as:

- `rooms/{roomName}/offer`
- `rooms/{roomName}/answer`
- `rooms/{roomName}/callerCandidates`
- `rooms/{roomName}/calleeCandidates`
- `rooms/{roomName}/participants/caller`
- `rooms/{roomName}/participants/callee`

This is not media streaming. It is only metadata needed to establish the session.

### 3.3 STUN and optional TURN

The app configures ICE servers in `rtcConfig`:

```js
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ],
  iceTransportPolicy: 'all'
};
```

This tells the browser:

- try direct peer-to-peer using public STUN servers to discover address/port mapping
- if necessary, allow TURN relay candidates as fallback

This means the app is designed to work in both direct and relayed scenarios, but the actual relay service is external, not built into the app itself.

### 3.4 Browser media selection and audio pipeline

The app also manages local device selection and remote audio output tuning:

- microphones and webcams are enumerated via `enumerateDevices()`
- local audio/video tracks are selected with `getUserMedia()`
- the remote audio is run through a Web Audio graph for EQ, mute, and volume control before being routed to the selected output device
- `speakerOutput` uses `setSinkId()` when supported by the browser

This part is independent of the peer-to-peer signaling architecture, but it is part of the end-user experience.

---

## 4. Actual runtime topology

The topology is best understood as a hybrid of signaling and direct media:

```text
Browser A                                  Firebase Realtime DB                              Browser B
   |                                                 |                                               |
   | 1. getUserMedia() -> local audio/video          |                                               |
   |------------------------------------------------>|                                               |
   |                                                 |                                               |
   | 2. createOffer() / setLocalDescription()        |                                               |
   |-----------------------------> offer ------------>|                                               |
   |                                                 |                                               |
   |                                                 | 3. sees offer / creates answer               |
   |                                                 |<---- answer ----------------------------------|
   | 4. ICE candidates published                     |                                               |
   |-----------------------------> candidates ----->|                                               |
   |                                                 |                                               |
   |                                                 | 5. ICE candidates published                 |
   |                                                 |<---- candidates ----------------------------|
   | 6. ICE connectivity checks                     |                                               |
   |<------------------------------------------------>|                                               |
   |                                                 |                                               |
   | 7. Direct media flow (audio/video) <= direct peer-to-peer bridge => 7. Direct media flow
   |                                                                             |
   +-------------------- STUN / TURN ICE network discovery ----------------------+
```

The key point is that the media path is not routed through Firebase. Firebase is only the rendezvous and signaling channel.

---

## 5. How the call establishment works in this app

### 5.1 Room and role assignment

When the user clicks Call, the app validates a room key and evaluates whether the room is:

- new and startable
- already occupied
- already has an offer waiting for a joiner

The app uses Firebase participant slots:

- `participants/caller`
- `participants/callee`

The code uses `runTransaction()` to claim a role slot, ensuring only one active caller and one active callee can exist in a session.

This avoids race conditions and prevents two peers from both assuming the same role.

### 5.2 Caller flow

The caller:

1. claims the `caller` slot
2. cleans up stale room state for that room
3. creates a new `RTCPeerConnection`
4. adds local audio/video tracks with `addTrack()`
5. creates an SDP offer
6. sets it as the local description
7. writes it to `rooms/{room}/offer`
8. starts listening for the callee's answer and ICE candidates

### 5.3 Callee flow

The callee:

1. detects that an offer already exists
2. creates a peer connection
3. listens to the offer and remote ICE candidates
4. sets the remote description from the offer
5. creates an answer
6. publishes the answer to `rooms/{room}/answer`
7. continues to receive and add ICE candidates

### 5.4 ICE candidate exchange

Each browser publishes ICE candidates as they are discovered through `peerConnection.onicecandidate`.

The app writes each candidate into Firebase under the correct role-specific path:

- caller's candidates go into `callerCandidates`
- callee's candidates go into `calleeCandidates`

The peer on the other side listens with `onChildAdded()` and calls `addIceCandidate()` as they arrive.

This is the normal WebRTC trick for NAT traversal: discover networking endpoints, send them to the remote side, and iterate until a viable route is found.

### 5.5 Remote media receipt

When a remote track arrives, `peerConnection.ontrack` runs. The app then:

- creates or reuses a `MediaStream`
- adds the incoming `MediaStreamTrack` to the remote stream
- assigns that stream to `remoteVideo.srcObject`
- triggers the audio graph setup for remote playback and processing

At this point, the actual media data is already flowing between the browsers.

---

## 6. What happens without a server?

The app does not run a dedicated central media server, which means the architecture is intentionally minimal:

- no MCU (multipoint control unit)
- no SFU (selective forwarding unit)
- no relay of audio/video through a custom backend

The system is intentionally designed for 2 participants only.

The only centralized component is the signaling service. In this implementation, that is Firebase.

This is why the application is still called a P2P app even though a real backend exists for signaling. The backend does not carry actual media; it merely orchestrates connection setup.

---

## 7. STUN and TURN in the real world

### 7.1 STUN

STUN is used to discover the public IP and port of each peer behind NAT.

This is highly effective for most consumer networks, especially:

- home Wi-Fi
- mobile carrier networks
- ordinary NAT routers

In such cases, peers often discover a direct route and can connect without a relay.

### 7.2 TURN

TURN is a media relay that is used when a direct P2P connection is blocked or impossible.

Typical cases:

- strict corporate firewall
- symmetric NAT
- network policy blocking UDP or not allowing direct peer-to-peer media
- restrictive public Wi-Fi or enterprise networking

A TURN server accepts media from one peer and forwards it to the other; this allows the call to continue even when direct routing is blocked.

In this app, TURN endpoints are configured in the ICE server list, so the browser is allowed to use a relay if needed. However, the project does not host its own TURN server; it uses public TURN endpoints as a fallback option.

### 7.3 Important nuance: TURN is not implemented as a custom app server

This means two things:

1. The project does not run a dedicated TURN infrastructure of its own.
2. It is nevertheless prepared for the standard TURN fallback approach used in WebRTC.

In other words, TURN is a viable and standard solution, but not the architecture that is currently implemented as the primary data path.

When direct media fails, the call may still succeed if a TURN server is available and reachable. If not, the app can fail even though signaling is working.

---

## 8. Why this architecture is good for a small meeting app

This style of design is ideal when:

- only two people are involved
- you want a lightweight browser solution
- you want to avoid building an expensive media relay infrastructure
- you are comfortable with Firebase or another lightweight signaling service

It keeps the system simple and highly scalable for small meetings because the media plane is direct and there is no central video mixer.

It also reduces cost, since the app does not need to forward all video/audio streams through a backend.

From a data privacy and cybersecurity perspective, the architecture has several advantages:

- media stays between the two browsers whenever direct connectivity is available, reducing exposure of raw audio and video to a central backend
- the app avoids routing live meeting content through a custom media server, which lowers the attack surface and makes the path simpler to reason about
- there is no long-lived media relay in the default case, which reduces the number of places where sensitive call content can be intercepted or retained
- the signaling metadata is minimal and ephemeral, limited mostly to SDP and ICE data needed to establish the call
- the design supports a smaller trust boundary than a fully centralized conferencing system, because the key live data path stays peer-to-peer rather than server-mediated

This is especially valuable in scenarios where privacy expectations are high, such as internal team calls, small confidential meetings, or use-cases where a central media broker is undesirable.

---

## 9. Known limitations

This app is intentionally minimal, and it has real-world constraints:

- It only supports a 2-person direct connection.
- It depends on browser networking and NAT traversal working correctly.
- Firebase is required for signaling, so it is not truly fully decentralized.
- If both peers are behind restrictive NAT/firewall conditions, direct media may fail.
- If TURN is unavailable or unreachable, the call may fail even though the room key and signaling exchange work.

The app handles stale room state, participant roles, and cleanup patterns so that a room does not remain stuck when a peer disconnects or the call fails mid-flight.

---

## 10. Bottom line

This project is a classic WebRTC P2P browser app:

- two browsers establish a direct media session
- Firebase acts as the signaling broker only
- STUN helps navigate NAT
- TURN is a viable fallback relay when direct communication is blocked
- the app is serverless for media but not fully serverless for signaling

In short, the media path is peer-to-peer, while the coordination path is centralized by Firebase. That is the key architectural idea of this application.
