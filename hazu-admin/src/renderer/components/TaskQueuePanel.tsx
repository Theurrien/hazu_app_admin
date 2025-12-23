import React, { useMemo } from 'react';
import { useTaskQueue, Task } from '../contexts/TaskQueueContext';

const TaskItem = React.memo(function TaskItem({ task, onDismiss }: { task: Task; onDismiss: () => void }) {
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
    }
  };

  const getLink = (): string | null => {
    if (task.status !== 'success') return null;
    if (task.type === 'createRoom') return `https://hazu.swiss/${task.roomId}`;
    if (task.type === 'createPerson') return `https://hazu.swiss/${task.personId}`;
    return null; // roleUpdate has no link
  };

  const link = getLink();

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
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:text-blue-800 hover:underline flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          Open ↗
        </a>
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
  const { tasks, dismissTask } = useTaskQueue();

  if (tasks.length === 0) return null;

  const { processing, queued, success, errors } = useMemo(() => ({
    processing: tasks.filter((t) => t.status === 'processing'),
    queued: tasks.filter((t) => t.status === 'queued'),
    success: tasks.filter((t) => t.status === 'success'),
    errors: tasks.filter((t) => t.status === 'error'),
  }), [tasks]);

  return (
    <div className="fixed top-4 right-4 w-72 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
      <div className="bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 border-b">
        Task Queue ({tasks.length})
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
        {processing.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
        {queued.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
        {success.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
        {errors.map((task) => (
          <TaskItem key={task.id} task={task} onDismiss={() => dismissTask(task.id)} />
        ))}
      </div>
    </div>
  );
}
