---
applyTo: "**/*.js,**/*.html,**/*.json,**/*.md"
---

# PWA install, cache, and update lifecycle

## Purpose

Use this skill when the task involves the service worker, installability, offline behavior, cache versioning, lifecycle updates, manifest configuration, or home-screen launch behavior of this PWA.

This project is a browser-based peer-to-peer meeting app packaged as a Progressive Web App. The installation and update behavior are controlled by a combination of:

- `manifest.json`
- `sw.js`
- the root HTML entry page (`index.html`)
- secure-origin requirements for installability
- cache invalidation and service-worker activation

## Project-specific context

This repository is designed to work as a standalone installable app on mobile and desktop browsers. The app is served as a static site and uses a service worker to cache its shell assets.

Relevant files:

- `manifest.json`
- `sw.js`
- `index.html`
- `README.md` (PWA install notes)

## Required debugging approach

When debugging a PWA issue, do not assume the app is failing because of the UI or WebRTC alone. The issue may be caused by the install lifecycle or stale cache state.

1. Confirm the installation context
   - Is the app running on `https://` or `http://localhost`?
   - Is it launched from the browser tab or from the installed home-screen app?
   - Does the browser consider the app installable?

2. Inspect the manifest
   - Verify `start_url`, `scope`, `display`, and icon metadata in `manifest.json`.
   - Ensure the app entry page is the root `index.html` rather than a JS module.

3. Inspect the service worker lifecycle
   - Check `install`, `activate`, and `fetch` handlers in `sw.js`.
   - Confirm the cache version is updated when the app changes.
   - Make sure old caches are cleaned up after activation.

4. Check update behavior
   - A new deploy may not appear immediately if the old service worker remains active.
   - Refresh once after deployment to trigger activation.
   - Ensure `self.skipWaiting()` and `clients.claim()` are used appropriately for the desired experience.

5. Look for stale cache symptoms
   - Old HTML, JS, or icons showing after a deploy
   - The app behaving like an older version even though the server is updated
   - Browser still serving cached content after code changes

6. Separate app shell issues from runtime issues
   - A PWA can load the shell correctly but still fail because the underlying WebRTC logic is broken.
   - A WebRTC problem is not automatically a PWA problem, and vice versa.

## Questions to answer before proposing a fix

- Is this an installability issue, a cache issue, or a runtime logic issue?
- Is the app being served from a secure origin or local dev server?
- Is the stale behavior caused by an old service worker still controlling the page?
- Are the cache names and activation flow correctly versioned?
- Is the issue only visible when the app is launched from the home screen?

## Must-check implementation points

The assistant should pay special attention to:

- `CACHE_NAME` and asset versioning in `sw.js`
- the `install` event and `cache.addAll()` behavior
- the `activate` event and old-cache deletion logic
- the `fetch` event and cache-first logic
- `manifest.json` metadata and icon definitions
- root/entry-page install semantics for static HTML apps

## Rules for diagnosis

- Do not assume the app is broken because the browser is showing stale content.
- Do not treat every update problem as a UI bug; it may be a service worker lifecycle issue.
- Do not edit `sw.js` without confirming the cache version and activation semantics.
- Do not ignore secure-origin requirements when discussing installability.
- Do not confuse app-shell caching with the real-time WebRTC connection state.

## Typical issue patterns in this app

The assistant should recognize these patterns:

- app works in browser but does not offer install prompts
- home-screen version of the app is stale after deploy
- old JS or HTML assets continue to load after updating the repo
- service worker keeps serving old cached resources
- app is opened via `file://` and behaves inconsistently
- install behavior differs between Android Chrome and iOS Safari

## Example prompts this skill is designed for

- “Why is the app still showing the old version after deployment?”
- “The service worker is caching stale assets. Trace the lifecycle and fix the correct versioning logic.”
- “Why is the app not installable on mobile?”
- “Check whether the issue is caused by the manifest or by the service worker lifecycle.”
- “The installed PWA behaves differently from the browser tab. What should we check?”
- “What part of the cache strategy could cause stale HTML or JS after a release?”

## Expected output style

When working on a PWA issue under this skill, the assistant should:

- explain whether the issue is install-time, activation-time, or fetch-time
- state the likely cache or secure-origin cause before proposing code changes
- point to the relevant PWA files and lifecycle events
- recommend a minimal, safe update strategy rather than broad caching changes
- keep the distinction clear between app-shell caching and real runtime behavior

## Do not do

- Do not treat install/update issues as a WebRTC bug without verifying the manifest and service worker path.
- Do not change cache logic without checking old version cleanup.
- Do not recommend local-file loading for installable PWA behavior.
- Do not assume a refresh alone is enough; activation may require a service worker update cycle.

This skill is intended to help maintain the correct mental model for this project: a static HTML app with an installable shell, a cache-controlled service worker, and a release lifecycle that must be managed carefully to avoid stale app versions.
