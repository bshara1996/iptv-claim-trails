/**
 * Automation engine — public entry point.
 *
 * Re-exports everything from the engine sub-modules so callers import
 * from one place and the internal split stays invisible to the rest of
 * the codebase.
 *
 * Internal layout:
 *   engine/taskStore.js – task state (createTask, getTask, cancelTask)
 *   engine/helpers.js   – emit, log, makeApiPageStub, buildRecord, logPlaylists
 *   engine/legacy.js    – backward-compatible register() execution path
 *   engine/runner.js    – runTask (main automation loop)
 */
export { createTask, getTask, cancelTask } from "./taskStore.js";
export { runTask } from "./runner.js";
