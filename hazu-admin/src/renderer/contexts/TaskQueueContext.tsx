import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

// Task type discriminated union
export type TaskType = 'roleUpdate' | 'createRoom' | 'createPerson';

interface BaseTask {
  id: string;
  type: TaskType;
  status: 'queued' | 'processing' | 'success' | 'error';
  error?: string;
}

export interface RoleUpdateTask extends BaseTask {
  type: 'roleUpdate';
  personName: string;
  personId: string;
  roomName: string;
  roomId: string;
  oldRole: string | null;
  newRole: string | null;
  onError?: () => void;
}

export interface CreateRoomTask extends BaseTask {
  type: 'createRoom';
  roomName: string;
  roomId: string;
}

export interface CreatePersonTask extends BaseTask {
  type: 'createPerson';
  personName: string;
  personId: string;
}

export type Task = RoleUpdateTask | CreateRoomTask | CreatePersonTask;

// Notification input types (for addNotification)
type CreateRoomNotification = { type: 'createRoom'; roomName: string; roomId: string };
type CreatePersonNotification = { type: 'createPerson'; personName: string; personId: string };
type NotificationInput = CreateRoomNotification | CreatePersonNotification;

interface TaskQueueContextType {
  tasks: Task[];
  addTask: (task: Omit<RoleUpdateTask, 'id' | 'status' | 'type'>) => string;
  addNotification: (notification: NotificationInput) => string;
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

  // Process queue - only for roleUpdate tasks
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;

    const nextTask = tasks.find((t) => t.type === 'roleUpdate' && t.status === 'queued') as RoleUpdateTask | undefined;
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
              ? { ...t, status: 'success' as const }
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

  // Add role update task (queued)
  const addTask = useCallback((taskData: Omit<RoleUpdateTask, 'id' | 'status' | 'type'>) => {
    const id = `task-${Date.now()}-${++taskIdCounter.current}`;
    const task: RoleUpdateTask = { ...taskData, id, type: 'roleUpdate', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  // Add notification (immediate success)
  const addNotification = useCallback((notification: NotificationInput) => {
    const id = `notif-${Date.now()}-${++taskIdCounter.current}`;

    if (notification.type === 'createRoom') {
      const task: CreateRoomTask = {
        id,
        type: 'createRoom',
        status: 'success',
        roomName: notification.roomName,
        roomId: notification.roomId,
      };
      setTasks((prev) => [...prev, task]);
    } else {
      const task: CreatePersonTask = {
        id,
        type: 'createPerson',
        status: 'success',
        personName: notification.personName,
        personId: notification.personId,
      };
      setTasks((prev) => [...prev, task]);
    }

    return id;
  }, []);

  const dismissTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAllErrors = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'error'));
  }, []);

  return (
    <TaskQueueContext.Provider value={{ tasks, addTask, addNotification, dismissTask, dismissAllErrors }}>
      {children}
    </TaskQueueContext.Provider>
  );
}
