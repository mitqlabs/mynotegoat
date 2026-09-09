"use client";

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
};

function compareByUpdatedAtDesc(left: TaskRecord, right: TaskRecord) {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function useTasks() {
  const [tasks, setTasks] = useState<TaskRecord[]>(() => loadTasks());

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
      return { added: true, task: next };
    },
    [updateTasks],
  );

  const updateTask = useCallback(
    (id: string, patch: UpdateTaskDraft) => {
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
    [updateTasks],
  );

  const toggleTaskDone = useCallback(
    (id: string) => {
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
    [updateTasks],
  );

  const removeTask = useCallback(
    (id: string) => {
      updateTasks((current) => current.filter((entry) => entry.id !== id));
    },
    [updateTasks],
  );

  const clearCompleted = useCallback(() => {
    updateTasks((current) => current.filter((entry) => !entry.done));
  }, [updateTasks]);

  return {
    tasks,
    addTask,
    updateTask,
    toggleTaskDone,
    removeTask,
    clearCompleted,
  };
}
