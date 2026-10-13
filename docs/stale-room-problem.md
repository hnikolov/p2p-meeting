# Stale room problem and resolution

## Summary

The stale room problem is a signaling-state bug in the Firebase room model. It occurs when the app decides that a room is empty or expired even though the original peer is still present, and therefore creates a second room or treats the same room as a fresh one.

The underlying issue is that the app used a timestamp-based cleanup rule as if it were proof that a peer had left. That is not reliable. A timestamp can only show that a record has not been refreshed recently; it does not prove that the browser is gone or that the peer has disconnected.

## Why the problem happens

The app stores room state in Firebase under paths such as:

- `rooms/{roomName}/offer`
- `rooms/{roomName}/answer`
- `rooms/{roomName}/participants/caller`
- `rooms/{roomName}/participants/callee`
- `rooms/{roomName}/callerCandidates`
- `rooms/{roomName}/calleeCandidates`

The cleanup logic interprets old `updatedAt` values as stale room state and removes them. That works well for crash recovery, but it is too aggressive in normal operation because a peer may remain alive and simply not have refreshed the room state recently enough.

The core mistake is this:

- old timestamp != peer is gone
- old timestamp is only a hint that the record has not been renewed recently

Because of that, a room can be silently cleaned up while the other participant is still in it. Later, the next user who joins sees the room as empty or newly created and starts a fresh session, which matches the observed behavior.

## Why a heartbeat is required

The app cannot reliably tell the difference between:

- a browser that is still alive but idle,
- a browser that has crashed,
- and a browser that is intentionally leaving,

without a lease or heartbeat.

The browser can stop executing code abruptly, and it may not have time to run `onDisconnect()` or write a final clean state. Therefore the room must have a way to prove that a participant is still alive.

## The correct approach

The solution is to treat participant presence as a lease instead of a one-time write.

### Lease-based participant model

Each active participant slot should be refreshed periodically while the room is active. The participant data should include at least:

- `sessionId`
- `role`
- `updatedAt`
- `leaseUntil`

The lease must be renewed while the peer is still connected. If the lease expires, the app may conclude that the session is no longer active and can safely clean up that piece of room state.

### Stale cleanup policy

Cleanup should be conservative and session-aware:

- do not remove room state merely because a timestamp is old
- only remove stale state when the lease has expired
- only remove it when the expired session is not the current valid session
- keep explicit user-driven disconnect/reset cleanup immediate

This preserves crash recovery while preventing false room deletion for an active session.

## What the fix achieves

The fix makes these invariants true:

- a room is not deleted while a valid participant lease is still active
- crash cleanup still works after a lease expires
- repeated join attempts do not recreate a room that is still in use
- explicit disconnect and leave flows still remove state immediately

## Why this is the right long-term model

This is the simplest maintainable solution because it keeps the current room structure and adds one clear rule: a room is valid only while its participant lease is still active.

It avoids broad redesign and keeps the fix focused on the actual root cause: timestamp-only cleanup was treated as a proof of absence, but it is only a proof of inactivity.
