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

1. Browser A creates a local stream and registers itself as a member of `rooms/{room}/members`.
2. Browser B does the same. Both browsers now see each other in the member list.
3. Each browser creates its peer connection; one sends an offer, the other an answer, through per-pair mailboxes under `rooms/{room}/signals`.
4. Both browsers exchange ICE candidates through the same mailboxes.
5. Once ICE succeeds, the browsers create a direct media path and the stream begins flowing peer-to-peer.

The full signaling design (data model, lifecycle and recovery) is in [signaling-design.md](signaling-design.md).

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
- `ref()`, `push()`, `set()`, `get()`, `onValue()`, `onChildAdded()`, `onChildRemoved()`, `remove()`, `runTransaction()`, `onDisconnect()`, `serverTimestamp()`

The browser authenticates anonymously and then uses the Firebase Realtime Database as a lightweight coordination layer.

The app writes signals such as:

- `rooms/{roomName}/members/{peerId}`: presence, removed by the server through `onDisconnect()`
- `rooms/{roomName}/signals/{fromId}/{toId}/{pushId}`: SDP descriptions and ICE candidates for one peer pairing

This is not media streaming. It is only metadata needed to establish the session.

### 3.3 STUN and optional TURN

The app configures ICE servers in `rtcConfig`:

```js
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ],
  iceTransportPolicy: 'all'
};
```

This tells the browser:

- try direct peer-to-peer using public STUN servers to discover address/port mapping
- no TURN relay is configured (the free openrelay.metered.ca service stopped responding); add one to `buildRtcConfig()` if a network blocks direct calls

A relay service would be external, not built into the app itself.

### 3.4 Browser media selection and audio pipeline

The app also manages local device selection and remote audio output tuning:

- microphones and webcams are enumerated via `enumerateDevices()`
- local audio/video tracks are selected with `getUserMedia()`
- the remote audio is run through a Web Audio graph for EQ, mute, and volume control before being routed to the selected output device
- `speakerOutput` uses `setSinkId()` when supported by the browser

This part is independent of the peer-to-peer signaling architecture, but it is part of the end-user experience.

### 3.5 Firebase configuration and security model

Firebase in this project is not the media plane. It is the signaling plane.

The app authenticates anonymously with Firebase and then writes only the metadata required to establish a call:

- member records (presence)
- SDP offers/answers and ICE candidates, each stored under the sending peer's id

This means the database is intentionally small and ephemeral. The app does not store audio or video in Firebase; it only stores handshake and coordination data needed to bring the two browsers together.

The recommended security model is to restrict access to the room tree and require authenticated access only. In practice, that means the browser client authenticates anonymously, and the Firebase Realtime Database rules allow reads/writes only within the `rooms/{roomId}` namespace rather than opening the entire database to public traffic.

This preserves the simple browser-to-browser model while avoiding an insecure global open database.

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
   |-----------------------------> offer ----------->|                                               |
   |                                                 |                                               |
   |                                                 | 3. sees offer / creates answer                |
   |                                                 |<---- answer ----------------------------------|
   | 4. ICE candidates published                     |                                               |
   |-----------------------------> candidates ------>|                                               |
   |                                                 |                                               |
   |                                                 | 5. ICE candidates published                   |
   |                                                 |<---- candidates ------------------------------|
   | 6. ICE connectivity checks                      |                                               |
   |<----------------------------------------------->|                                               |
   |                                                                                                 |
   |                                                                                                 |
   | 7. Direct media flow (audio/video)   <=   direct peer-to-peer bridge   =>  7. Direct media flow |
   |                                                                                                 |
   +------------------------------ STUN / TURN ICE network discovery --------------------------------+
```

The key point is that the media path is not routed through Firebase. Firebase is only the rendezvous and signaling channel.

---

## 5. How the call establishment works in this app

### 5.1 Joining a room

When the user clicks Call, the app validates the room key and adds a fresh `peerId` to `rooms/{room}/members` with `runTransaction()` (at most two members). Server-side `onDisconnect()` handlers remove that record and the peer's signals when the browser goes away. There is no caller/callee role and no "start vs join" decision: both browsers run the same code.

### 5.2 Negotiation

As soon as a browser sees the other member, it creates an `RTCPeerConnection` and adds its local tracks. Negotiation follows the W3C "perfect negotiation" pattern:

1. the impolite side (decided by comparing the two peer ids) creates the offer;
2. the polite side answers;
3. offer collisions during later renegotiation (ICE restarts) are resolved by the pattern.

Descriptions are pushed to `rooms/{room}/signals/{self}/{remote}` and read by the other side with `onChildAdded()`.

### 5.3 ICE candidate exchange

Each browser publishes ICE candidates as they are discovered through `peerConnection.onicecandidate`, into the same per-pair mailbox. The peer on the other side processes all messages from that mailbox strictly in order and calls `addIceCandidate()`.

### 5.4 Recovery

If the connection drops, the app first performs an ICE restart. If the connection is still not established after about 30 seconds, it rejoins the room under a new peer id, and the other side builds a fresh connection. See [signaling-design.md](signaling-design.md).

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

This app currently configures no TURN server: the free public openrelay.metered.ca endpoints it used stopped responding and were removed. Calls therefore need a direct (host or STUN-discovered) path; add a TURN server to `buildRtcConfig()` in app.js if a network requires a relay.

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

The app relies on server-side presence (`onDisconnect()`), per-peer data ownership and a two-step recovery (ICE restart, then rejoin) so that a room does not remain stuck when a peer disconnects or the call fails mid-flight.

---

## 10. Bottom line

This project is a classic WebRTC P2P browser app:

- two browsers establish a direct media session
- Firebase acts as the signaling broker only
- STUN helps navigate NAT
- TURN is a viable fallback relay when direct communication is blocked
- the app is serverless for media but not fully serverless for signaling

In short, the media path is peer-to-peer, while the coordination path is centralized by Firebase. That is the key architectural idea of this application.
