"use client";

import { logActivity } from "@/lib/activity-log";
import { useCallback, useState } from "react";
import {
  createTaskId,
  loadTasks,
  saveTasks,
  type TaskPriority,
  type TaskRecord,
} from "@/lib/tasks";

type AddTaskDraft = {
  title: string;
  priority: TaskPriority;
  dueDate?: string;
  patientId?: string;
  patientName?: string;
  assignee?: string;
};

type AddTaskResult =
  | { added: true; task: TaskRecord }
  | { added: false; reason: string };

type UpdateTaskDraft = {
  title?: string;
  priority?: TaskPriority;
  dueDate?: string;
  done?: boolean;
  patientId?: string;
  patientName?: string;
  /** Team member label the task is assigned to ("" = unassigned). */
  assignee?: string;
};

function compareByUpdatedAtDesc(left: TaskRecord, right: TaskRecord) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function useTasks() {
  const [tasks, setTasks] = useState<TaskRecord[]>(() => loadTasks());
  const logTask = (action: string, summary: string, task: TaskRecord, details?: Record<string, unknown>) =>
    logActivity({
      category: "tasks",
      action,
      summary,
      patientId: task.patientId,
      patientName: task.patientName,
      details: { taskId: task.id, ...details },
    });

  const updateTasks = useCallback((updater: (current: TaskRecord[]) => TaskRecord[]) => {
    setTasks((current) => {
      const next = updater(current).sort(compareByUpdatedAtDesc);
      saveTasks(next);
      return next;
    });
  }, []);

  const addTask = useCallback(
    (draft: AddTaskDraft): AddTaskResult => {
      const title = draft.title.trim();
      if (!title) {
        return { added: false, reason: "Task name is required." };
      }
      const now = new Date().toISOString();
      const patientId = draft.patientId?.trim() || undefined;
      const patientName = draft.patientName?.trim() || undefined;
      const assignee = draft.assignee?.trim() || undefined;
      const next: TaskRecord = {
        id: createTaskId(),
        title,
        priority: draft.priority,
        dueDate: draft.dueDate?.trim() ?? "",
        done: false,
        createdAt: now,
        updatedAt: now,
        patientId,
        patientName,
        assignee,
      };
      updateTasks((current) => [next, ...current]);
      logTask("task.created", `Created task "${title}"${assignee ? ` for ${assignee}` : ""}`, next);
      return { added: true, task: next };
    },
    [updateTasks],
  );

  const updateTask = useCallback(
    (id: string, patch: UpdateTaskDraft) => {
      const before = tasks.find((entry) => entry.id === id);
      if (before && patch.assignee !== undefined && (patch.assignee || "") !== (before.assignee || "")) {
        logTask(
          "task.assigned",
          `Assigned "${before.title}" to ${patch.assignee || "nobody"}`,
          before,
          { from: before.assignee ?? "", to: patch.assignee ?? "" },
        );
      }
      let changed = false;
      updateTasks((current) =>
        current.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }
          changed = true;
          return {
            ...entry,
            ...patch,
            title: typeof patch.title === "string" ? patch.title.trim() || entry.title : entry.title,
            dueDate: typeof patch.dueDate === "string" ? patch.dueDate.trim() : entry.dueDate,
            updatedAt: new Date().toISOString(),
          };
        }),
      );
      return changed;
    },
    [updateTasks, tasks],
  );

  const toggleTaskDone = useCallback(
    (id: string) => {
      const before = tasks.find((entry) => entry.id === id);
      if (before) {
        logTask(before.done ? "task.reopened" : "task.completed", `${before.done ? "Reopened" : "Completed"} task "${before.title}"`, before);
      }
      updateTasks((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                done: !entry.done,
                updatedAt: new Date().toISOString(),
              }
            : entry,
        ),
      );
    },
    [updateTasks, tasks],
  );

  const removeTask = useCallback(
    (id: string) => {
      const before = tasks.find((entry) => entry.id === id);
      if (before) logTask("task.deleted", `Deleted task "${before.title}"`, before);
      updateTasks((current) => current.filter((entry) => entry.id !== id));
    },
    [updateTasks, tasks],
  );

  const clearCompleted = useCallback(() => {
    const cleared = tasks.filter((entry) => entry.done);
    if (cleared.length) {
      logActivity({
        category: "tasks",
        action: "task.cleared_completed",
        summary: `Cleared ${cleared.length} completed task${cleared.length === 1 ? "" : "s"}`,
        details: { titles: cleared.map((t) => t.title) },
      });
    }
    updateTasks((current) => current.filter((entry) => !entry.done));
  }, [updateTasks, tasks]);

  return {
    tasks,
    addTask,
    updateTask,
    toggleTaskDone,
    removeTask,
    clearCompleted,
  };
}
