import React, { useMemo } from 'react';
import { useTaskQueue, Task } from '../contexts/TaskQueueContext';

interface TaskItemProps {
  task: Task;
  onDismiss: () => void;
  onRetry: () => void;
  onOpen: (id: string) => void;
}

const TaskItem = React.memo(function TaskItem({ task, onDismiss, onRetry, onOpen }: TaskItemProps) {
  const getIcon = () => {
    switch (task.status) {
      case 'processing':
        return <span className="animate-spin">⏳</span>;
      case 'queued':
        return <span>🕐</span>;
      case 'success':
        return <span className="text-green-600">✓</span>;
      case 'error':
        return <span className="text-red-600">✗</span>;
    }
  };

  const getLabel = () => {
    switch (task.type) {
      case 'roleUpdate':
        return `${task.personName} → ${task.roomName}`;
      case 'createRoom':
        return `+ ${task.roomName}`;
      case 'createPerson':
        return `+ ${task.personName}`;
      case 'healTag':
        return `Tag: ${task.displayName || task.personId}`;
      case 'revokeOrphanAccess':
        return `Revoke: ${task.displayName || task.accountId} → ${task.roomName}`;
      case 'pruneDeadTags':
        return `Prune ${task.tagCount} tag(s): ${task.displayName || task.personId}`;
    }
  };

  const getEntityId = (): string | null => {
    if (task.status !== 'success') return null;
    if (task.type === 'createRoom') return (task as any).roomId || null;
    if (task.type === 'createPerson') return (task as any).personId || null;
    return null;
  };

  const entityId = getEntityId();

  return (
    <div
      className={`flex items-start gap-2 p-2 text-sm ${
        task.status === 'error' ? 'bg-red-50' : task.status === 'success' ? 'bg-green-50' : ''
      }`}
    >
      <span className="flex-shrink-0 w-5">{getIcon()}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate">{getLabel()}</div>
        {task.status === 'error' && task.error && (
          <div className="text-xs text-red-600 truncate">{task.error}</div>
        )}
      </div>
      {task.status === 'error' && (
        <button
          className="text-xs text-orange-600 hover:text-orange-800 hover:underline flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          Retry
        </button>
      )}
      {entityId && (
        <button
          className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(entityId);
          }}
        >
          Open ↗
        </button>
      )}
      <button
        onClick={onDismiss}
        className="text-gray-400 hover:text-gray-600 flex-shrink-0"
        title="Dismiss"
        aria-label="Dismiss task"
      >
        ×
      </button>
    </div>
  );
});

export function TaskQueuePanel() {
  const { tasks, dismissTask, retryTask, dismissAllCompleted, dismissAllErrors } = useTaskQueue();

  if (tasks.length === 0) return null;

  const { processing, queued, success, errors } = useMemo(() => ({
    processing: tasks.filter((t) => t.status === 'processing'),
    queued: tasks.filter((t) => t.status === 'queued'),
    success: tasks.filter((t) => t.status === 'success'),
    errors: tasks.filter((t) => t.status === 'error'),
  }), [tasks]);

  const handleOpen = async (entityId: string) => {
    const config = await window.electronAPI.getApiConfig();
    const env = config.environment || 'swiss';
    const baseUrl = env === 'swiss' ? 'https://hazu.swiss' : env === 'io' ? 'https://hazu.io' : 'https://dev.hazu.swiss';
    const url = `${baseUrl}/${entityId}`;
    window.electronAPI.openExternal(url);
  };

  return (
    <div className="fixed top-4 right-4 w-80 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
      <div className="bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 border-b flex items-center justify-between">
        <span>Task Queue ({tasks.length})</span>
        <div className="flex gap-2">
          {success.length > 0 && (
            <button
              onClick={dismissAllCompleted}
              className="text-xs text-gray-500 hover:text-gray-700"
              title="Clear completed"
            >
              Clear done
            </button>
          )}
          {errors.length > 0 && (
            <button
              onClick={dismissAllErrors}
              className="text-xs text-red-500 hover:text-red-700"
              title="Clear errors"
            >
              Clear errors
            </button>
          )}
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
        {processing.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onDismiss={() => dismissTask(task.id)}
            onRetry={() => retryTask(task.id)}
            onOpen={handleOpen}
          />
        ))}
        {queued.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onDismiss={() => dismissTask(task.id)}
            onRetry={() => retryTask(task.id)}
            onOpen={handleOpen}
          />
        ))}
        {success.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onDismiss={() => dismissTask(task.id)}
            onRetry={() => retryTask(task.id)}
            onOpen={handleOpen}
          />
        ))}
        {errors.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onDismiss={() => dismissTask(task.id)}
            onRetry={() => retryTask(task.id)}
            onOpen={handleOpen}
          />
        ))}
      </div>
    </div>
  );
}
