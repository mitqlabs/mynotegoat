"use client";

import { useState } from "react";
import { formatUsDateInput } from "@/components/us-date-input";
import type { TaskPriority } from "@/lib/tasks";

/** One row of the existing To-Do list. A case label is only shown when the task is tied to a case. */
export type PatientTodoItem = {
  id: string;
  title: string;
  done: boolean;
  priority: string;
  dueDate: string;
  caseLabel?: string;
};

export type PatientTodoDraft = {
  title: string;
  priority: TaskPriority;
  dueDate: string;
};

function toIsoDateFromUsDate(value: string): string {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`;
}

/**
 * The case-page To-Do list and its Quick Add fields (Task, Priority, Due Date, Add To Do).
 * Callers pass the existing task rows. A patient-level add leaves the case id empty.
 */
export function PatientTodoList({
  items,
  onToggle,
  onAdd,
}: {
  items: PatientTodoItem[];
  onToggle: (id: string) => void;
  onAdd?: (draft: PatientTodoDraft) => string;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("Medium");
  const [dueDate, setDueDate] = useState("");
  const [message, setMessage] = useState("");

  const submit = () => {
    if (!onAdd) return;
    const dueDateIso = dueDate.trim() ? toIsoDateFromUsDate(dueDate) : "";
    if (dueDate.trim() && !dueDateIso) {
      setMessage("Enter due date as MM/DD/YYYY.");
      return;
    }
    const reason = onAdd({ title, priority, dueDate: dueDateIso });
    if (reason) {
      setMessage(reason);
      return;
    }
    setTitle("");
    setPriority("Medium");
    setDueDate("");
    setMessage("");
  };

  return (
    <div>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--text-muted)]">No to-do items for this patient.</p>
      ) : (
        <ul className="mt-1 grid gap-2">
          {items.map((task) => (
            <li
              className="flex items-start gap-2 rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2 text-sm"
              key={task.id}
            >
              <input checked={task.done} className="mt-1" onChange={() => onToggle(task.id)} type="checkbox" />
              <div className="flex-1">
                <div className={task.done ? "line-through text-[var(--text-muted)]" : "font-semibold"}>{task.title}</div>
                {(task.dueDate || task.priority || task.caseLabel) && (
                  <div className="text-xs text-[var(--text-muted)]">
                    {task.priority}
                    {task.dueDate ? ` • Due ${task.dueDate}` : ""}
                    {task.caseLabel ? ` • ${task.caseLabel}` : ""}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {onAdd && (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 md:col-span-2">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Task</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Task title"
                value={title}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Priority</span>
              <select
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                value={priority}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-[var(--text-muted)]">Due Date (optional)</span>
              <input
                className="rounded-xl border border-[var(--line-soft)] bg-white px-3 py-2"
                inputMode="numeric"
                maxLength={10}
                onChange={(event) => setDueDate(formatUsDateInput(event.target.value))}
                placeholder="MM/DD/YYYY"
                value={dueDate}
              />
            </label>
          </div>
          {message && <p className="mt-3 text-sm font-semibold text-[#b43b34]">{message}</p>}
          <div className="mt-4 flex justify-end">
            <button className="btn btn-primary btn-sm" type="submit">
              Add To Do
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
