---
applyTo: "**/*.js,**/*.html,**/*.md"
---

# Device and audio/video pipeline tuning and safety

## Purpose

Use this skill when the task involves microphone and camera selection, speaker output, media constraints, browser device enumeration, audio graph tuning, remote playback safety, or mobile-specific differences in how browser media APIs behave.

This app contains a substantive browser media pipeline beyond the signaling layer. It enumerates devices, chooses audio/video inputs, tunes the remote audio output, and configures speaker behavior in ways that differ across browsers and operating systems. The app is therefore vulnerable to issues that are not “syntax” problems but “browser capability and media pipeline” problems.

## Project-specific context

This repository includes:

- microphone/camera selection
- speaker output selection with `setSinkId()` when supported
- volume and EQ adjustments for remote audio
- media constraints and stream configuration for WebRTC
- different behavior across desktop browsers and mobile browsers
- known Android limitations in output switching

The relevant logic is in `app.js`, and the expected device/media limitations are discussed in the project docs.

## Required debugging approach

When debugging a device or media pipeline issue, do not jump to a UI-only fix. First determine whether the problem is caused by browser capability, stream configuration, or a bad media routing assumption.

1. Confirm device selection behavior
   - Are the correct devices enumerated?
   - Are we selecting the right microphone or camera from the device list?
   - Are stale device selections remaining after a reconnect or device switch?

2. Check stream creation and constraints
   - Look at `getUserMedia()` calls and the exact constraints used.
   - Make sure the app is not requesting an incompatible configuration.
   - Validate that the correct track is attached to the correct stream.

3. Inspect the remote audio chain
   - Verify the app creates or reuses the correct audio graph.
   - Check the gain, EQ, and sink routing logic for remote playback.
   - Ensure that volume or mute changes are not inadvertently affecting the wrong stream.

4. Consider browser limitations
   - Some browser APIs are supported on desktop but not on mobile.
   - Speaker routing via `setSinkId()` is not universally available.
   - Android and iOS may behave differently even when the code is identical.

5. Separate pipeline safety from network failure
   - A broken call can be caused by either network/ICE failure or a media pipeline problem.
   - Do not assume that “no audio” means the peer connection failed if the tracks and route may be wrong.

6. Validate the route end-to-end
   - Check local capture, remote track receipt, and final output to the browser device.
   - Confirm the media path is not being interrupted by a device switch, muted state, or wrong sink target.

## Questions to answer before proposing a fix

- Is the problem in device enumeration, constraints, or output routing?
- Are we selecting the expected device or incorrectly reusing the last device state?
- Is the browser actually supporting the output API in this environment?
- Did the local stream or remote track arrive correctly before output routing?
- Are browser- or mobile-specific restrictions causing the problem?

## Must-check implementation points

The assistant should pay special attention to:

- `navigator.mediaDevices.enumerateDevices()` and device selection logic
- `getUserMedia()` constraints and track selection
- `MediaStreamTrack` creation and replacement flows
- speaker output selector and `setSinkId()` use
- remote audio graph, volume, and EQ adjustments
- mobile browser limitations for audio output routing

## Rules for diagnosis

- Do not assume every device or output bug is a WebRTC bug.
- Do not assume a browser supports a media API simply because the API exists in the spec.
- Do not ignore browser-specific fallback behavior on Android and iOS.
- Do not change mixer or output code without verifying the stream and track state first.
- Do not treat audio device switching as a guaranteed capability across all browsers.

## Typical issue patterns in this app

The assistant should recognize these patterns:

- microphone or camera device selection resets unexpectedly after reconnect
- remote audio is present but not audible because the wrong sink or route was selected
- browser shows device options that do not work in practice on mobile
- speaker output selection appears available but no device change happens
- audio output works on desktop but fails on Android due to browser API limitations
- track state changes after device switch but no new stream is attached to the expected output node

## Example prompts this skill is designed for

- “Why is the selected speaker not changing even though the UI shows a device selection?”
- “The browser reports devices but the audio output is not switching. Diagnose the likely media capability issue.”
- “Check whether this microphone/camera change is safe and whether the stream is being replaced correctly.”
- “Why is remote audio not playing after a device switch?”
- “The app works on desktop but not on Android — identify the likely browser limitation in the output pipeline.”
- “Inspect the remote audio graph and confirm the routing logic is not mutating the wrong stream.”

## Expected output style

When working on a media device or audio pipeline issue under this skill, the assistant should:

- separate device selection from actual stream behavior
- explain browser capability differences clearly
- inspect the full audio route from capture to output
- note when the issue is a browser limitation rather than a project bug
- suggest the smallest safe fix, including fallback behavior where needed

## Do not do

- Do not assume every browser supports the same output API.
- Do not blame the WebRTC connection when the problem is the audio route or device selection.
- Do not change device or stream logic without confirming current track state.
- Do not ignore mobile-specific limitations when designing a fix.

This skill is intended to keep the project grounded in real browser behavior: media selection is powerful, but not universal, and safe code must respect browser capability differences and track lifecycles.
