import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

export interface Task {
  id: string;
  personName: string;
  roomName: string;
  personId: string;
  roomId: string;
  oldRole: string | null;
  newRole: string | null;
  status: 'queued' | 'processing' | 'success' | 'error';
  error?: string;
  dismissAt?: number; // Timestamp when to auto-dismiss
  onError?: () => void; // Callback to revert UI
}

interface TaskQueueContextType {
  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'status'>) => string;
  dismissTask: (id: string) => void;
  dismissAllErrors: () => void;
}

const TaskQueueContext = createContext<TaskQueueContextType | null>(null);

export function useTaskQueue() {
  const context = useContext(TaskQueueContext);
  if (!context) {
    throw new Error('useTaskQueue must be used within TaskQueueProvider');
  }
  return context;
}

export function TaskQueueProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const processingRef = useRef(false);
  const taskIdCounter = useRef(0);

  // Process queue
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;

    const nextTask = tasks.find((t) => t.status === 'queued');
    if (!nextTask) return;

    processingRef.current = true;

    // Mark as processing
    setTasks((prev) =>
      prev.map((t) => (t.id === nextTask.id ? { ...t, status: 'processing' as const } : t))
    );

    try {
      const result = await window.electronAPI.updateUserRole(
        nextTask.personId,
        nextTask.roomId,
        nextTask.oldRole,
        nextTask.newRole
      );

      if (result.success) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === nextTask.id
              ? { ...t, status: 'success' as const, dismissAt: Date.now() + 5000 }
              : t
          )
        );
      } else {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === nextTask.id ? { ...t, status: 'error' as const, error: result.error } : t
          )
        );
        nextTask.onError?.();
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTasks((prev) =>
        prev.map((t) =>
          t.id === nextTask.id
            ? { ...t, status: 'error' as const, error: errorMessage }
            : t
        )
      );
      nextTask.onError?.();
    }

    processingRef.current = false;
  }, [tasks]);

  // Trigger processing when tasks change
  useEffect(() => {
    processQueue();
  }, [tasks, processQueue]);

  // Auto-dismiss successful tasks
  useEffect(() => {
    const hasDismissableTasks = tasks.some((t) => t.dismissAt);
    if (!hasDismissableTasks) return;

    const interval = setInterval(() => {
      const now = Date.now();
      setTasks((prev) => prev.filter((t) => !t.dismissAt || t.dismissAt > now));
    }, 1000);
    return () => clearInterval(interval);
  }, [tasks]);

  const addTask = useCallback((taskData: Omit<Task, 'id' | 'status'>) => {
    const id = `task-${Date.now()}-${++taskIdCounter.current}`;
    const task: Task = { ...taskData, id, status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  const dismissTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAllErrors = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'error'));
  }, []);

  return (
    <TaskQueueContext.Provider value={{ tasks, addTask, dismissTask, dismissAllErrors }}>
      {children}
    </TaskQueueContext.Provider>
  );
}
