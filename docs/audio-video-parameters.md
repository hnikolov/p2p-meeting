# WebRTC Media Settings and Transmission Statistics

This guide explains how to distinguish the media settings captured by a local camera or microphone from the audio and video statistics observed during WebRTC transmission. It also describes how degradation preferences can adapt video resolution and frame rate when CPU or network conditions change.

## Degradation Preference

Even if `getSettings()` initially reports **1280×720**, WebRTC may dynamically reduce video quality during a call.

This behavior is controlled by **WebRTC Degradation Preference**:

1. **`maintain-resolution`** — Usually used for screen sharing. Keeps the resolution but may reduce the frame rate significantly when CPU or network resources are constrained.
2. **`maintain-framerate`** — Usually used for webcam video. Keeps motion smooth by lowering the resolution, potentially from **720p to 360p or lower**.
3.	**`balanced`**: WebRTC allows both resolution and frame rate to change when bandwidth or CPU is constrained, rather than strictly preserving one. The browser chooses a compromise between image detail and motion smoothness, and this is the default degradation preference defined by the WebRTC API.

## Checking the Transmitted Resolution

`getSettings()` reports what the local camera captures. To inspect what is actually transmitted to or received from the remote peer, query `RTCPeerConnection.getStats()`.

There are two relevant layers:

* **Local hardware:** Capture settings exposed by `MediaStreamTrack.getSettings()`
* **Network transmission:** Sent and received statistics exposed by `RTCPeerConnection.getStats()`

## Audio Settings

| Attribute                     | Layer          | Stream   | Description                                    |
| ----------------------------- | -------------- | -------- | ---------------------------------------------- |
| `echoCancellation`            | Local hardware | Outgoing | Whether echo cancellation is active            |
| `noiseSuppression`            | Local hardware | Outgoing | Whether background-noise suppression is active |
| `autoGainControl`             | Local hardware | Outgoing | Whether automatic microphone gain is active    |
| `sampleRate`                  | Local hardware | Outgoing | Capture frequency, such as `48000` Hz          |
| `sampleSize`                  | Local hardware | Outgoing | Audio bit depth, typically `16`                |
| `channelCount`                | Local hardware | Outgoing | Number of channels: `1` mono, `2` stereo       |
| `echoCancellationType`        | Local hardware | Outgoing | Chromium-specific processing source            |
| `bytesSent` / `bytesReceived` | Network        | Both     | Cumulative audio data transferred              |
| `audioLevel`                  | Network        | Both     | Real-time level from `0.0` to `1.0`            |
| `totalAudioEnergy`            | Network        | Both     | Cumulative audio energy                        |
| `jitter`                      | Network        | Incoming | Packet-arrival variation in seconds            |
| `packetsLost`                 | Network        | Incoming | Number of lost audio packets                   |

## Video Settings

| Attribute                       | Layer          | Stream   | Description                                             |
| ------------------------------- | -------------- | -------- | ------------------------------------------------------- |
| `width`                         | Local hardware | Outgoing | Captured pixel width                                    |
| `height`                        | Local hardware | Outgoing | Captured pixel height                                   |
| `frameRate`                     | Local hardware | Outgoing | Target capture rate                                     |
| `aspectRatio`                   | Local hardware | Outgoing | Width divided by height                                 |
| `facingMode`                    | Local hardware | Outgoing | Camera orientation, such as `user` or `environment`     |
| `resizeMode`                    | Local hardware | Outgoing | Whether cropping or scaling occurs                      |
| `frameWidth` / `frameHeight`    | Network        | Both     | Actual transmitted or received dimensions               |
| `framesPerSecond`               | Network        | Both     | Actual network frame rate                               |
| `bytesSent` / `bytesReceived`   | Network        | Both     | Cumulative video data transferred                       |
| `framesSent` / `framesReceived` | Network        | Both     | Total delivered frames                                  |
| `framesDropped`                 | Network        | Incoming | Frames discarded during decoding                        |
| `qualityLimitationReason`       | Network        | Outgoing | Limiting factor: `none`, `cpu`, `bandwidth`, or `other` |
