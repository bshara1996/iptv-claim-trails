/**
 * In-memory task store.
 *
 * Each task holds its EventEmitter, AbortController, status, and results.
 *
 * Exports:
 *   tasks                 – the underlying Map (used by runner.js)
 *   createTask()          – registers a new task, returns { taskId, emitter }
 *   getTask(taskId)       – retrieves a task by id, or null
 *   cancelTask(taskId)    – aborts a running/pending task
 */
import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";
import { forceCloseAllContexts } from "../../browser.js";

export const tasks = new Map();

export function createTask() {
  const taskId = uuidv4();
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);

  tasks.set(taskId, {
    emitter,
    abortController: new AbortController(),
    status: "pending",
    results: [],
  });

  return { taskId, emitter };
}

export function getTask(taskId) {
  return tasks.get(taskId) ?? null;
}

export async function cancelTask(taskId) {
  const task = tasks.get(taskId);
  if (!task || !["running", "pending"].includes(task.status)) return;
  task.abortController.abort();
  task.status = "cancelling";
  await forceCloseAllContexts();
}
