# Parameter Tuning for Live WebRTC Calls

This note captures the operational rules for changing media and network tuning during an active peer-to-peer call. It documents why some controls must be applied through a track rebuild flow while others are updated in place on the active sender.

Read this before changing any code that touches audio/video capture constraints, sender encoding parameters, or device reconfiguration during a live session.

## Architecture overview

The important distinction is that there are two different layers being changed:

1. The physical capture layer (microphone/camera hardware and capture constraints)
2. The network transmission layer (how RTP is encoded and sent over the socket)

These layers are not interchangeable, and browser engines treat them differently.

```text
Local microphone / webcam
        |
        v
MediaStreamTrack / getUserMedia()
        |
        +-----------------------------+
        |                             |
        v                             v
Capture constraints            RTCRtpSender parameters
  - sample rate                 - maxBitrate
  - channel count              - maxFramerate
  - bit depth                  - degradationPreference
  - filters / echo cancellation
  - device switching
        |                             |
        v                             v
Track replacement / rebuild     setParameters()
  - stop/remove track            - live sender update
  - getUserMedia() again         - no renegotiation
  - replaceTrack(newTrack)
```

The correct mechanism depends on the type of change being made, not on the UI label alone.

## Why a split is required

Modern browser engines, especially Chromium, do not reliably allow direct mutation of active capture constraints on a live track. The underlying hardware drivers and media pipeline can hold locks for the operating system audio stack while the track is active.

This leads to a set of real-world failure modes:

- toggling `echoCancellation`, sample rate, channel layout, or similar audio constraints on a running track can fail silently
- the browser may reject updates or leave the old configuration in place
- the OS audio device can remain locked while a new stream is being created
- the app can appear to update the UI while the actual capture path is still using the old track

By contrast, network transmission parameters are not constrained by the same hardware locks. These can usually be changed live on the active sender without renegotiating the connection.

This is why the code paths must be split into two operational pipelines:

- Hardware capture path: teardown + rebuild + replaceTrack
- Network encoding path: mutate sender parameters in place via `setParameters()`

## I. Hardware capture layer: rebuild the track, then swap it in

This path is used when the change affects how media is physically acquired from the real world.

### Examples

- microphone sample rate
- channel count
- bit depth
- echo cancellation / audio filters
- other active capture constraints that are attached to the track itself
- microphone or webcam device swap while a call is live

### The required flow

The app must follow a strict sequential replacement pipeline:

1. Set a guard flag such as `isMediaChanging = true` to block overlapping state checks and prevent race-condition snapbacks in the UI.
2. Detach the active audio track from the local stream and stop it to release the OS device lock.
3. Remove the old track from the stream container with `removeTrack()`.
4. Wait briefly so the OS driver and browser-side device handles fully clear.
5. Recreate the media using `navigator.mediaDevices.getUserMedia()` with flexible constraints wrapped in `ideal` blocks.
6. Append the fresh track back to the local stream.
7. Locate the active sender and swap the track using `await audioSender.replaceTrack(newTrack)`.
8. Clear the guard flag once the rebuild completes.

A typical pattern looks like this:

```js
isMediaChanging = true;

const oldTrack = localStream.getAudioTracks()[0];
if (oldTrack) {
  oldTrack.stop();
  localStream.removeTrack(oldTrack);
}

await new Promise(resolve => setTimeout(resolve, 50));

const freshStream = await navigator.mediaDevices.getUserMedia({
  audio: {
    sampleRate: { ideal: 48000 },
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: true }
  }
});

const newTrack = freshStream.getAudioTracks()[0];
localStream.addTrack(newTrack);

const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
if (sender) {
  await sender.replaceTrack(newTrack);
}

isMediaChanging = false;
```

### Why the 50ms delay matters

The short pause is important. Even if the browser API call returns quickly, the underlying OS driver lock may still be in the process of releasing the capture handle. Without this breathing room, the next `getUserMedia()` call can reuse a stale audio device state or fail with a locked-resource condition.

### Why `ideal` constraints matter

Constraints should be expressed with flexible definitions such as:

```js
sampleRate: { ideal: 48000 }
```

rather than hard-fixing a single exact value when the device or driver may only support a nearby format. This helps avoid browser/driver rejection when the hardware is locked to a different capture profile, such as 44.1kHz on a system default device.

### Why the guard flag is necessary

During teardown and replacement, the UI may still be polling or re-reading the device state. Without a guard, diagnostic checks or checkbox state recovery can race against the swap and restore stale values back onto the UI. The guard keeps the state machine coherent while the track is being rebuilt.

## II. Network transmission layer: update sender parameters in place

This path is used when the change affects how media is transmitted over the network, without altering the physical microphone/webcam source.

### Examples

- video max frame rate
- video max bitrate
- audio max bitrate
- degradation preference
- any sender-side transport tuning that should preserve the call connection

### Required pattern

Target the active `RTCRtpSender` directly and adjust the current parameter dictionary, then push it back with `setParameters()`.

```js
const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
const params = sender.getParameters();

params.encodings[0].maxFramerate = 30;
params.encodings[0].maxBitrate = 400000;

await sender.setParameters(params);
```

For audio:

```js
const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
const params = sender.getParameters();

params.encodings[0].maxBitrate = 64000;

await sender.setParameters(params);
```

This is the correct place for live network tuning because it changes the RTP encoding profile without renegotiating the peer connection or dropping the call.

## Core rule of thumb

Use this decision rule:

- If it changes the hardware capture path or device source, rebuild the track and swap it in.
- If it changes how the call is transmitted, update the sender parameters in place.

Do not apply hardware capture updates directly to a live track by calling `applyConstraints()` on an active track and expecting Chromium to honor it consistently.

## The "Nuclear Teardown" workflow

The audio track rebuild strategy is effectively a controlled teardown and replacement workflow. In practice, it is a safer and more reliable method than attempting to mutate the active track in place.

The sequence is intentionally strict:

1. freeze UI state
2. isolate and stop the active track
3. remove it from the stream
4. wait for OS lock release
5. request a fresh stream with flexible constraints
6. reattach new track
7. swap it into the active sender
8. resume normal diagnostics and UI updates

This avoids the lockups that can happen when the browser tries to mutate the live audio path while the OS driver and browser engine still hold hardware handles open.

## Common pitfalls

### Direct mutation on active tracks

This is the main anti-pattern. Mutating `applyConstraints()` on a live microphone track is not a safe universal mechanism for all audio tuning, especially when the browser and driver are already in a locked operational state.

### Trying to renegotiate for simple bitrate or FPS changes

When the goal is only to change the transport profile, renegotiation is unnecessary overhead and can cause disruption. Use `setParameters()` instead.

### Mixing capture changes and sender changes into one path

If a code path tries to do both in one step, it can conflict with the browser's safety model. Event ordering matters: do not update UI state while the media is being rebuilt, and do not force a sender parameter change while the track swap is mid-flight.

### UI polling during track swaps

This is easy to miss. If a diagnostics loop or a device selector refresh runs while `isMediaChanging` is true, it can restore the old hardware state or unread values and create race-condition bugs that are difficult to diagnose.

## Practical design guidance

- Keep capture-level changes and network-level changes in separate functions.
- Use explicit guard flags when track replacement is in progress.
- Prefer flexible `ideal` constraints over exact, brittle values.
- Allow a short delay after stopping an audio track before building a replacement stream.
- Use `replaceTrack()` to preserve the call while replacing the source.
- Use `setParameters()` to preserve the call when only changing transmission behavior.
- Prefer the sender-level parameter path for bitrate and framerate updates.

## Quick reference

| Concern | Correct mechanism | Why |
|---|---|---|
| Microphone sample rate | Track teardown + `getUserMedia()` + `replaceTrack()` | Avoids live hardware lock issues |
| Audio filter / echo cancellation changes | Track teardown + rebuild | Browser/OS lock on active track |
| Device switching while connected | Replace audio track cleanly | Preserves live call while re-binding source |
| Video resolution / camera tuning | `applyConstraints()` when safe or track replacement if needed | Capture-level change |
| Video max FPS | `RTCRtpSender.setParameters()` | Live transport tuning, no renegotiation |
| Video max bitrate | `RTCRtpSender.setParameters()` | Dynamic encoding adjustment |
| Audio max bitrate | `RTCRtpSender.setParameters()` | Live sender parameter update |

## Summary

The safest rule in this project is simple:

- Capture behavior is rebuilt.
- Network behavior is mutated.

That split is not an optimization; it is a requirement for reliability across Chromium, the OS media stack, and real-world peer connections.
