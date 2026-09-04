---
applyTo: "**/*.js,**/*.html,**/*.md"
---

# Large single-file state reset and UI lifecycle

## Purpose

Use this skill when the task involves UI state transitions, reset flows, lifecycle cleanup, connection/disconnect handlers, and large single-file state machines in this app.

This project keeps much of its behavior in a single large JavaScript file (`app.js`). That means the app is highly stateful and event-driven, with many branches that update the same UI elements, connection state, timers, and media handling. Bugs in this area are often caused by stale variables, missed cleanup, duplicated listeners, or reset logic that is not symmetrical across all paths.

## Project-specific context

This repository is a browser app with:

- room state transitions (idle, connecting, connected, disconnecting)
- media lifecycle changes (local stream, remote stream, mute, camera, speakers)
- UI layout adaptation (portrait vs landscape, PiP resizing and moving)
- timers and elapsed-time tracking
- device selectors and UI dropdown state
- cleanup code that must run on disconnect, reset, and browser close

The main high-risk file is `app.js`, where large state changes and event wiring are concentrated.

## Required debugging approach

When debugging a UI or lifecycle bug in this app, do not treat it as a simple DOM issue. First verify whether the app is leaving a stale state behind.

1. Identify the state machine boundary
   - Which mode, room state, or connection phase is active?
   - Is the bug triggered by connect, disconnect, reset, or browser lifecycle events?

2. Check for mode-scoped variables that are reused incorrectly
   - A local variable used in one branch may no longer be valid after a reset or reconnect.
   - Verify that handlers do not capture stale values from a previous mode or role.

3. Check reset symmetry
   - If one branch closes or clears state, ensure the same cleanup happens for all other branches.
   - Repeatedly compare connect, disconnect, and retry flows for missing cleanup.

4. Check shared UI state and event listeners
   - Large state machines often attach listeners in one path and forget to remove or guard them in another.
   - Verify that toggles, resize handlers, keyboard shortcuts, and popover states are not duplicating behavior.

5. Check timers, RAF loops, and elapsed tracking
   - Timers, animation frames, and elapsed-time counters must be reset or cancelled consistently.
   - Watch for stale intervals or repeated callbacks after a reset.

6. Check scroll, layout, and DOM reparenting
   - Some UI changes move elements between containers.
   - If capture/restore logic is duplicated in multiple branches, they may drift apart in subtle ways.

## Questions to answer before proposing a fix

- Is the bug caused by stale mode or role state?
- Does the app reset one state bucket but not another?
- Are we reusing a handler or DOM element after a mode transition?
- Are timers, listeners, or layout references left behind after disconnect?
- Is a reset path missing a cleanup step that the other paths have?

## Must-check implementation points

The assistant should pay special attention to:

- large mode/state variables used across event handlers
- connection close and disconnect handlers
- browser `beforeunload` or visibility-related cleanup
- reparenting of DOM elements for PiP/layout changes
- repeated logic blocks for connect/disconnect/reset flows
- timer and RAF lifecycle management

## Rules for diagnosis

- Do not assume a “UI bug” is a CSS bug when it may be stale state.
- Do not reuse variables across lifecycle boundaries without verifying they are still valid.
- Do not trust a reset function unless it clears every branch-specific resource.
- Do not ignore duplicate event listeners or duplicated cleanup logic in a single-file app.
- Do not fix only the visible symptom; check the underlying lifecycle state to prevent recurrence.

## Typical issue patterns in this app

The assistant should recognize these patterns:

- the app appears connected but a handler references a stale mode or variable
- closing or resetting one state path leaves another part still active
- duplicate listener logic causes repeated or conflicting UI behavior
- layout/scroll or PiP position logic diverges between connect and reconnect paths
- elapsed timers or RAF loops keep running after disconnect
- a reset handler clears the main state but misses a secondary UI object or state bucket

## Example prompts this skill is designed for

- “Why does the close/reset path fail when the app is in a specific mode?”
- “Check whether this reset handler is using stale mode-scoped variables.”
- “Find the missing cleanup in the disconnect flow that leaves UI state inconsistent.”
- “The app re-enters a state incorrectly after reconnect. Trace the reset logic and compare all branches.”
- “This resize/layout change works in one path but not the other; inspect duplicated restore logic.”
- “The UI appears stuck after close; identify whether listeners or timers are not being cleaned up.”

## Expected output style

When working on a lifecycle or reset bug under this skill, the assistant should:

- map the state boundaries clearly before changing code
- explain which variables or handlers are shared across branches
- identify missing cleanup and stale references
- compare connect/disconnect/reset paths for symmetry
- propose the smallest reset/cleanup fix instead of a broad rewrite

## Do not do

- Do not add ad hoc state variables without checking whether the reset path owns them.
- Do not treat duplicate code blocks as harmless if they update related state.
- Do not propose a rewrite before proving the bug is caused by lifecycle drift or stale state.
- Do not assume UI-only symptoms mean no state cleanup issue exists.

This skill is intended to preserve a disciplined approach in a big single-file UI app: always verify the lifecycle, always compare reset paths, and always treat stale state as a likely root cause before editing the interface.
