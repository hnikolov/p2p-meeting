# Remote Audio Output: Device Selection, Mute, EQ & Volume

This document describes how the receive-side audio pipeline works for the remote
participant's stream (`#remoteVideo`), why it's built this way, and the dead ends
that were ruled out along the way. Read this before touching
`ensureRemoteAudioGraph`, `applySpeakerMuteState`, `syncRemoteSpeakerVolume`,
`syncRemoteAudioEqUi`, or the speaker output picker in `app.js`.

## Architecture overview

```
RTCRtpReceiver audio track
        |
        v
new MediaStream([audioTrack])
        |
        v
audioContext.createMediaStreamSource()
        |
        v
  Bass shelf (lowshelf, 250 Hz)
        |
        v
  Mid peak (peaking, 1000 Hz, Q=1)
        |
        v
  Treble shelf (highshelf, 4000 Hz)
        |
        v
      Gain node  <-- volume slider / mute
        |
        v
audioContext.createMediaStreamDestination()
        |
        v
  hidden <audio> "sink" element  <-- setSinkId() targets THIS element
        |
        v
   actual speaker/headphone output
```

`remoteVideo` itself only ever renders the **video** track. Its own audio
(`remoteVideo.volume = 0` once the graph exists) is silenced so the only
audible path is the processed one through the hidden sink element.

Key objects, all created lazily in `ensureRemoteAudioGraph()` and cached in the
module-level `remoteAudioGraph`:

- `audioContext` — shared `AudioContext`, see "AudioContext lifecycle" below.
- `mediaSource` — `MediaStreamAudioSourceNode` built from a **fresh
  `MediaStream` wrapping only the inbound audio track**, not from
  `remoteVideo` itself (see "Why not `createMediaElementSource`" below).
- `bass` / `mid` / `treble` — `BiquadFilterNode`s implementing the 3-band EQ.
- `gainNode` — drives both the volume slider and mute.
- `mediaStreamDestination` — `MediaStreamAudioDestinationNode`; its `.stream`
  is what actually gets played.
- `sinkEl` — a hidden `<audio autoplay>` element appended to `document.body`,
  playing `mediaStreamDestination.stream`. This is the **only** element whose
  `setSinkId()` call has any audible effect.

## Output device selection

- `populateSpeakerOutputs()` enumerates `audiooutput` devices and adds them to
  the `#speakerOutput` `<select>`, alongside a manually-added `"System
  Default"` option (`value = ''`).
- **Duplicate filtering**: Chrome on Windows exposes synthetic `'default'` and
  `'communications'` `deviceId` aliases that point at the same physical device
  as its real entry. Since we already provide our own "System Default" option,
  these aliases are filtered out:

  ```js
  devices.filter(device => device.kind === 'audiooutput'
    && device.deviceId !== 'default'
    && device.deviceId !== 'communications');
  ```

  Without this filter, 2 physical output devices show up as 5 entries.

  The same dedupe applies to `audioinput` devices in `discoverDevices()` (the
  microphone picker) for the same reason.

- `applySpeakerOutputSelection()` calls `sinkTarget.setSinkId(speakerOutput.value)`
  where `sinkTarget` is `remoteAudioGraph.sinkEl` if the graph exists, else
  `remoteVideo` (fallback for before the call/audio track exists). An empty
  value (`''`) means "System Default", and `setSinkId('')` correctly restores it.
- Because a freshly created `sinkEl` always starts on the default output,
  `tryPlayRemoteVideo()` re-applies whatever device was already selected in
  the picker after (re)creating the graph.

## Mute

`applySpeakerMuteState(isMuted)` updates the button UI, then:
- If the graph exists: sets `gainNode.gain.value` to `0` (muted) or the
  current slider volume (unmuted). Also calls `resumeRemoteAudioContext()`
  since a button click is a user gesture — a good place to nudge the
  `AudioContext` out of `suspended` if it ever got stuck there.
- If the graph doesn't exist yet (no call / no audio track): falls back to
  setting `remoteVideo.muted` **and** `remoteVideo.volume` directly (both, for
  robustness — see "Chrome quirks" below).

Clicking the speaker mute button must not close the EQ & volume panel if it's
open: the global `document` click listener that closes device-selector panels
explicitly ignores clicks on `#speakerBtn` (it lives outside the panel DOM,
as a sibling of the toggle chevron that opens it).

## EQ & Volume

- `syncRemoteAudioEqUi()` reads the 3 EQ sliders and writes their values
  straight to `bass.gain.value` / `mid.gain.value` / `treble.gain.value`
  (range ±12 dB). Presets (`applyRemoteEqPreset`) just set the slider values
  and call this function.
- `syncRemoteSpeakerVolume()` reads the volume slider (range 0–2, i.e. up to
  +6 dB of boost) and writes it to `gainNode.gain.value`, delegating to
  `applySpeakerMuteState` for the muted-via-zero-volume case.

## RX audio level meter (debug HUD)

`getStats()` `inbound-rtp.audioLevel` turned out to be unreliable once the
track is consumed via Web Audio (`createMediaStreamSource`) instead of an
`HTMLMediaElement` — it stays flat at `0` even while audio is audibly
working. Instead, `ensureRemoteAudioGraph()` taps an `AnalyserNode` directly
off `mediaSource` (a parallel branch, doesn't affect the main EQ/gain chain)
and hands it to `WebRTCDebugger` via `setRemoteAudioAnalyser(analyserNode)`.
`WebRTCDebugger`'s `startMeterLoop()` (a single shared `requestAnimationFrame`
loop, also driving the local mic VU bar) computes RMS from it every frame and
writes it to the `[AUDIO NETWORK RECEIVE]` `Audio Lvl` field, replacing the
old `report.audioLevel`-based read. `tryPlayRemoteVideo()` re-attaches the
analyser to the debugger every time it runs, so it survives call reconnects.

## AudioContext lifecycle

A **shared** `AudioContext` (`sharedAudioContext`, via `getOrCreateAudioContext()`)
is created and `resume()`d inside the **Call button's click handler** — a
guaranteed user gesture — before the call even connects:

```js
callBtn.addEventListener('click', async () => {
  getOrCreateAudioContext();
  resumeSharedAudioContext();
  ...
```

`ensureRemoteAudioGraph()` reuses this same context instead of creating a new
one. This matters because if the context is only ever created/resumed
reactively (e.g. only when the user touches an EQ slider), it can get stuck in
the `suspended` state under browser autoplay policies if the user never
happens to interact with those controls — resulting in total silence with no
obvious cause.

## Why not `createMediaElementSource(remoteVideo)`

The first working implementation tapped `remoteVideo` directly via
`audioContext.createMediaElementSource(remoteVideo)`. This was abandoned after
real (non-localhost) network testing repeatedly broke in ways that didn't
reproduce locally:

1. **Muting `remoteVideo` stops RTP decoding.** Once `createMediaElementSource`
   is attached, setting `remoteVideo.muted = true` causes Chrome to stop
   actively decoding/rendering the inbound RTP audio track entirely — this
   zeroes out `getStats()` `inbound-rtp.audioLevel` *and* starves the whole
   downstream Web Audio graph (total silence), even though a separate,
   unmuted sink element was connected further down the chain.
   **Diagnostic tell**: the in-app WebRTC debug HUD (press `d`) showed
   `[AUDIO NETWORK TRANSMIT]` levels moving normally while
   `[AUDIO NETWORK RECEIVE]` stayed flat at `0`.
2. **Un-muting it doesn't fully fix it either.** Leaving `remoteVideo` fully
   audible (or just `volume = 0`) caused Chrome to keep playing the source
   element's own **raw, unprocessed** audio through its own default output
   device *in parallel* with whatever the Web Audio graph produced. Symptoms:
   output device switching appeared to do nothing (raw audio always came out
   the OS default device), and EQ/volume/mute had no perceptible effect (the
   raw bypass drowned out the processed signal).
3. Even with `remoteVideo.volume = 0` (no `.muted`), a real two-device
   (laptop + phone) test over LAN still produced total silence with
   `[AUDIO NETWORK RECEIVE]` stuck at `0` — suggesting the `AudioContext` was
   simply never resumed (see "AudioContext lifecycle" above), since this
   specific real-world session never happened to touch an EQ/volume control
   before checking for sound.

**The fix**: source the graph from `audioContext.createMediaStreamSource(new
MediaStream([audioTrack]))` — the raw `RTCRtpReceiver` track — instead of from
`remoteVideo`. This fully decouples RTP decoding (and its stats) from
`remoteVideo`'s own playback/mute/volume state. `remoteVideo.volume = 0` is
still set once the graph exists, but only to avoid the double/raw-audio
bypass — it is no longer load-bearing for whether audio decodes at all.

## Staged rollout (for context / git history)

This feature was rebuilt in 3 verified stages after the above regressions,
each confirmed on real devices before moving to the next:

1. **Output device selection only** — plain `remoteVideo.setSinkId()`, no
   `AudioContext` at all.
2. **+ Mute** — `remoteVideo.muted`/`.volume` directly, still no graph.
3. **+ EQ & Volume** — the full Web Audio graph described above, sourced from
   the raw audio track, with the `AudioContext` primed on the Call button
   gesture.

If regressions reappear, consider bisecting back to stage 1 or 2 (plain
`remoteVideo` control, no Web Audio) to confirm whether the graph itself is at
fault before debugging further.

## Quick reference: files & functions

| Concern | Function(s) | File |
|---|---|---|
| Device enumeration + dedupe (output) | `populateSpeakerOutputs`, `getSpeakerOutputSupportState` | `app.js` |
| Device enumeration + dedupe (input) | `discoverDevices` | `app.js` |
| Device selection | `applySpeakerOutputSelection` | `app.js` |
| Audio graph construction | `ensureRemoteAudioGraph`, `getOrCreateAudioContext`, `resumeSharedAudioContext`, `resumeRemoteAudioContext` | `app.js` |
| Mute | `applySpeakerMuteState` | `app.js` |
| Volume | `syncRemoteSpeakerVolume`, `normalizeSpeakerVolume` | `app.js` |
| EQ | `syncRemoteAudioEqUi`, `applyRemoteEqPreset`, `formatEqValue` | `app.js` |
| Wiring into playback start | `tryPlayRemoteVideo` | `app.js` |
| Device-selector panel close behavior | `document` click listener, `closeDeviceSelectors` | `app.js` |
| Diagnostics (RX audio level meter) | `startMeterLoop`, `setRemoteAudioAnalyser` | `WebRTCDebugger.js` |
| Diagnostics HUD toggle | `WebRTCDebugger`, press `d` to toggle | `WebRTCDebugger.js` |
