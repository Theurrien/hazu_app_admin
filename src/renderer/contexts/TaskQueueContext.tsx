import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

// Task type discriminated union
export type TaskType = 'roleUpdate' | 'createRoom' | 'createPerson' | 'healTag' | 'revokeOrphanAccess' | 'pruneDeadTags';

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
  roomId?: string; // Set after creation
  templateId: string;
  targetId: string;
  onSuccess?: (roomId: string) => void;
  onError?: () => void;
}

export interface CreatePersonTask extends BaseTask {
  type: 'createPerson';
  personName: string;
  personId?: string; // Set after creation
  params: {
    sourceId: string;
    targetId: string;
    firstName: string;
    lastName: string;
    userEmail: string;
    role: string;
    roomIds: string[];
    invitationMail: boolean;
  };
  onSuccess?: (personId: string) => void;
  onError?: () => void;
}

export interface HealTagTask extends BaseTask {
  type: 'healTag';
  personId: string;
  tag: string;
  displayName: string | null;
}

export interface RevokeOrphanAccessTask extends BaseTask {
  type: 'revokeOrphanAccess';
  accountId: string;
  groupId: string;
  roomId: string;
  roomName: string;
  displayName: string | null;
}

export interface PruneDeadTagsTask extends BaseTask {
  type: 'pruneDeadTags';
  personId: string;
  items: Array<{ classId: string; tags: string[] }>;
  displayName: string | null;
  tagCount: number;
}

export type Task = RoleUpdateTask | CreateRoomTask | CreatePersonTask | HealTagTask | RevokeOrphanAccessTask | PruneDeadTagsTask;

// Input types for adding tasks to queue
type AddRoleUpdateInput = Omit<RoleUpdateTask, 'id' | 'status' | 'type'>;
type AddCreateRoomInput = Omit<CreateRoomTask, 'id' | 'status' | 'type' | 'roomId'>;
type AddCreatePersonInput = Omit<CreatePersonTask, 'id' | 'status' | 'type' | 'personId'>;
type AddHealTagInput = Omit<HealTagTask, 'id' | 'status' | 'type'>;
type AddRevokeAccessInput = Omit<RevokeOrphanAccessTask, 'id' | 'status' | 'type'>;
type AddPruneTagsInput = Omit<PruneDeadTagsTask, 'id' | 'status' | 'type'>;

// Notification types (for already-completed operations like modal creates)
type CreateRoomNotification = { type: 'createRoom'; roomName: string; roomId: string };
type CreatePersonNotification = { type: 'createPerson'; personName: string; personId: string };
type NotificationInput = CreateRoomNotification | CreatePersonNotification;

interface TaskQueueContextType {
  tasks: Task[];
  // Queue a task for processing
  addRoleUpdateTask: (task: AddRoleUpdateInput) => string;
  addCreateRoomTask: (task: AddCreateRoomInput) => string;
  addCreatePersonTask: (task: AddCreatePersonInput) => string;
  addHealTagTask: (task: AddHealTagInput) => string;
  addRevokeAccessTask: (task: AddRevokeAccessInput) => string;
  addPruneTagsTask: (task: AddPruneTagsInput) => string;
  // Add already-completed notification (for modals that call API directly)
  addNotification: (notification: NotificationInput) => string;
  dismissTask: (id: string) => void;
  dismissAllCompleted: () => void;
  dismissAllErrors: () => void;
  retryTask: (id: string) => void;
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

  // Process next queued task (sequential for now, designed for parallel later)
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
      if (nextTask.type === 'roleUpdate') {
        const task = nextTask as RoleUpdateTask;
        const result = await window.electronAPI.updateUserRole(
          task.personId,
          task.roomId,
          task.oldRole,
          task.newRole
        );

        if (result.success) {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'success' as const } : t))
          );
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
          task.onError?.();
        }
      } else if (nextTask.type === 'createRoom') {
        const task = nextTask as CreateRoomTask;
        const result = await window.electronAPI.createRoom(
          task.templateId,
          task.targetId,
          task.roomName
        );

        if (result.success && result.room) {
          const newRoomId = result.room.id;
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, status: 'success' as const, roomId: newRoomId } : t
            )
          );
          task.onSuccess?.(newRoomId);
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
          task.onError?.();
        }
      } else if (nextTask.type === 'createPerson') {
        const task = nextTask as CreatePersonTask;
        const result = await window.electronAPI.createPerson(task.params);

        if (result.success && result.person) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, status: 'success' as const, personId: result.person.id } : t
            )
          );
          task.onSuccess?.(result.person.id);
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
          task.onError?.();
        }
      } else if (nextTask.type === 'healTag') {
        const task = nextTask as HealTagTask;
        const result = await window.electronAPI.healTag(task.personId, task.tag);

        if (result.success) {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'success' as const } : t))
          );
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
        }
      } else if (nextTask.type === 'revokeOrphanAccess') {
        const task = nextTask as RevokeOrphanAccessTask;
        const result = await window.electronAPI.revokeOrphanAccess(
          task.accountId,
          task.groupId,
          task.roomId,
        );

        if (result.success) {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'success' as const } : t))
          );
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
        }
      } else if (nextTask.type === 'pruneDeadTags') {
        const task = nextTask as PruneDeadTagsTask;
        const result = await window.electronAPI.pruneDeadTags(task.personId, task.items);

        if (result.success) {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'success' as const } : t))
          );
        } else {
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error' as const, error: result.error } : t))
          );
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setTasks((prev) =>
        prev.map((t) => (t.id === nextTask.id ? { ...t, status: 'error' as const, error: errorMessage } : t))
      );
      if (nextTask.type === 'roleUpdate') (nextTask as RoleUpdateTask).onError?.();
      if (nextTask.type === 'createRoom') (nextTask as CreateRoomTask).onError?.();
      if (nextTask.type === 'createPerson') (nextTask as CreatePersonTask).onError?.();
    }

    processingRef.current = false;
  }, [tasks]);

  // Trigger processing when tasks change
  useEffect(() => {
    processQueue();
  }, [tasks, processQueue]);

  // Add role update task
  const addRoleUpdateTask = useCallback((taskData: AddRoleUpdateInput) => {
    const id = `role-${Date.now()}-${++taskIdCounter.current}`;
    const task: RoleUpdateTask = { ...taskData, id, type: 'roleUpdate', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  // Add create room task
  const addCreateRoomTask = useCallback((taskData: AddCreateRoomInput) => {
    const id = `room-${Date.now()}-${++taskIdCounter.current}`;
    const task: CreateRoomTask = { ...taskData, id, type: 'createRoom', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  // Add create person task
  const addCreatePersonTask = useCallback((taskData: AddCreatePersonInput) => {
    const id = `person-${Date.now()}-${++taskIdCounter.current}`;
    const task: CreatePersonTask = { ...taskData, id, type: 'createPerson', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  // Add heal-tag task (S3)
  const addHealTagTask = useCallback((taskData: AddHealTagInput) => {
    const id = `heal-${Date.now()}-${++taskIdCounter.current}`;
    const task: HealTagTask = { ...taskData, id, type: 'healTag', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  // Add revoke-orphan-access task (S6)
  const addRevokeAccessTask = useCallback((taskData: AddRevokeAccessInput) => {
    const id = `revoke-${Date.now()}-${++taskIdCounter.current}`;
    const task: RevokeOrphanAccessTask = { ...taskData, id, type: 'revokeOrphanAccess', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  // Add prune-dead-tags task (S7)
  const addPruneTagsTask = useCallback((taskData: AddPruneTagsInput) => {
    const id = `prune-${Date.now()}-${++taskIdCounter.current}`;
    const task: PruneDeadTagsTask = { ...taskData, id, type: 'pruneDeadTags', status: 'queued' };
    setTasks((prev) => [...prev, task]);
    return id;
  }, []);

  // Add notification for already-completed operations (modals call API directly)
  const addNotification = useCallback((notification: NotificationInput) => {
    const id = `notif-${Date.now()}-${++taskIdCounter.current}`;

    if (notification.type === 'createRoom') {
      const task: CreateRoomTask = {
        id,
        type: 'createRoom',
        status: 'success',
        roomName: notification.roomName,
        roomId: notification.roomId,
        templateId: '', // Not needed for notifications
        targetId: '',   // Not needed for notifications
      };
      setTasks((prev) => [...prev, task]);
    } else {
      const task: CreatePersonTask = {
        id,
        type: 'createPerson',
        status: 'success',
        personName: notification.personName,
        personId: notification.personId,
        params: {} as any, // Not needed for notifications
      };
      setTasks((prev) => [...prev, task]);
    }

    return id;
  }, []);

  const dismissTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAllCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'success'));
  }, []);

  const dismissAllErrors = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== 'error'));
  }, []);

  // Retry a failed task
  const retryTask = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id && t.status === 'error' ? { ...t, status: 'queued' as const, error: undefined } : t))
    );
  }, []);

  return (
    <TaskQueueContext.Provider
      value={{
        tasks,
        addRoleUpdateTask,
        addCreateRoomTask,
        addCreatePersonTask,
        addHealTagTask,
        addRevokeAccessTask,
        addPruneTagsTask,
        addNotification,
        dismissTask,
        dismissAllCompleted,
        dismissAllErrors,
        retryTask,
      }}
    >
      {children}
    </TaskQueueContext.Provider>
  );
}
