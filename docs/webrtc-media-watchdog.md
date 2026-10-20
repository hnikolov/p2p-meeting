# WebRTC media watchdog and NAT/ICE recovery

## Problem statement

The app was occasionally showing a false-positive successful connection:

- the room and signaling metadata stayed alive
- the browser reported the peer connection as connected
- the UI showed the session as connected
- but no remote audio or video track ever arrived

This is a classic WebRTC signaling-vs-media mismatch. The app can exchange SDP and ICE candidates successfully while still failing to establish a usable direct media route. This often happens when one or both peers are behind a restrictive NAT, VPN, or enterprise firewall, or when the browser/OS network stack has stale NAT mappings after a long idle period.

## Why the issue looks like a room bug

The heartbeat/lease logic solves stale Firebase room state. It does not guarantee that the actual WebRTC media path is healthy.

The room can be valid and still the media path can fail because the real audio/video traffic is carried peer-to-peer over ICE and RTP, not over Firebase.

That means these are separate states:

- room liveness: the room is still present and refreshed
- signaling success: SDP and ICE data were exchanged
- media success: the remote `ontrack` event fired and actual audio/video data is flowing

A false-positive connected state is caused when the app treats the first two as proof of the third.

## Observed failure pattern

The failure pattern we saw was:

1. A friend creates the room and leaves it idle for several minutes.
2. A peer joins and the app reports a connected state.
3. No audio or video is transmitted.
4. The call is eventually reset and the room becomes joinable again.
5. On the next attempt, the session succeeds normally.

This matches stale NAT/ICE path behavior more than it matches a stale room issue.

## Root cause

The likely root cause is not the room heartbeat itself. It is a combination of:

- idle NAT UDP mappings expiring
- stale or unusable ICE candidate pairs
- restrictive network conditions (company firewall, VPN, or strict NAT)
- browser or OS network behavior that leaves a path looking connected but not actually usable

A fresh retry often works because a newer WebRTC negotiation creates a new candidate set and a new NAT binding or relay path.

## Recovery principle

The app must treat a connected peer connection as incomplete until it verifies the remote media path is real.

The logic should do the following:

- start a short watchdog once the peer connection reaches `connected`
- if no remote media is detected within the watchdog window, assume the path is stalled
- trigger `restartIce()` to refresh candidate pairs and NAT mappings
- if the media still does not arrive, reset the session and make the user retry

## Why this is the right compromise

The watchdog is intended to protect the user experience without creating unstable auto-reconnect loops.

The timeout values are deliberately short so the user does not sit idle for a long time waiting on a dead connection. But they are also long enough to allow the normal peer connection and ICE negotiation to complete before concluding that the path is actually stalled.

The current recommended cadence is:

- start watchdog after `connected`: 8 seconds
- after ICE refresh: 5 seconds

This gives a total recovery window of roughly 13 seconds before the call is considered failed and reset, which is fast enough to keep UX responsive while still allowing a reasonable ICE recovery attempt.

This is the current sweet spot for this app (or even 6 + 4): it is short enough that a dead connection does not feel stuck, but it is still long enough to avoid false resets on healthy calls that are merely negotiating slowly. For a more aggressive UX, 5 seconds + 3 seconds is feasible, but it increases the risk of resetting a valid call during slower or more restrictive network conditions. The 8 + 5 split is the safer default that still keeps the user experience responsive.

## Implementation notes

The recovery loop is implemented in the app as a watchdog that:

- watches the peer connection state
- checks whether `remoteStream` has any tracks
- triggers `peerConnection.restartIce()` if the connection is connected but the media is still absent
- resets the session if the media never arrives after the follow-up refresh window

This behavior is intentionally conservative: it makes the failure visible and recoverable without attempting a risky silent reconnect inside an already unstable negotiation.

## Recommended next improvements

The current recovery layer is the minimum safe mitigation. The next useful step would be:

- prefer relay (TURN) when direct media path is unreliable
- attempt a fresh renegotiation after the watchdog triggers
- keep this logic behind a small, bounded retry budget

These follow-up steps would make the app more resilient in enterprise and VPN-heavy environments while preserving the current safety model.

## Conclusion

The issue is real and is best explained as a WebRTC NAT/ICE/media-path problem, not as a stale room problem alone.

The app now includes a media watchdog so it no longer treats a signaling-connected state as proof of a working call. That is the right direction for the project and gives a safer user experience when the browser shows a misleading “Connected” status.
