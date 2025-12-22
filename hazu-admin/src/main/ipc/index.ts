import { ipcMain } from 'electron';
import axios from 'axios';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { query, run, get } from '../database';
import { setApiConfig, getApiConfig, isConfigured, HazuApiConfig } from '../services/hazu-api/config';
import { runFullSync, getSyncProgress } from '../services/sync.service';

export function registerIpcHandlers(): void {
  // ============================================================================
  // DATABASE OPERATIONS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.DB_QUERY, async (_event, sql: string, params?: any[]) => {
    try {
      return query(sql, params);
    } catch (error) {
      console.error('DB Query error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_RUN, async (_event, sql: string, params?: any[]) => {
    try {
      return run(sql, params);
    } catch (error) {
      console.error('DB Run error:', error);
      throw error;
    }
  });

  // ============================================================================
  // ROOMS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.ROOMS_GET_ALL, async (_event, type?: string) => {
    try {
      if (type) {
        return query('SELECT * FROM rooms WHERE room_type = ? ORDER BY title', [type]);
      }
      return query('SELECT * FROM rooms ORDER BY room_type, title');
    } catch (error) {
      console.error('Get rooms error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ROOMS_GET_BY_ID, async (_event, id: string) => {
    try {
      return get('SELECT * FROM rooms WHERE id = ?', [id]);
    } catch (error) {
      console.error('Get room by ID error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ROOMS_SEARCH, async (_event, searchQuery: string) => {
    try {
      const pattern = `%${searchQuery}%`;
      return query(
        'SELECT * FROM rooms WHERE title LIKE ? OR description LIKE ? ORDER BY title',
        [pattern, pattern]
      );
    } catch (error) {
      console.error('Search rooms error:', error);
      throw error;
    }
  });

  // ============================================================================
  // PERSONS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.PERSONS_GET_ALL, async (_event, type?: string) => {
    try {
      if (type) {
        return query('SELECT * FROM persons WHERE person_type = ? ORDER BY display_name', [type]);
      }
      return query('SELECT * FROM persons ORDER BY person_type, display_name');
    } catch (error) {
      console.error('Get persons error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PERSONS_GET_BY_ID, async (_event, id: string) => {
    try {
      return get('SELECT * FROM persons WHERE id = ?', [id]);
    } catch (error) {
      console.error('Get person by ID error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PERSONS_SEARCH, async (_event, searchQuery: string) => {
    try {
      const pattern = `%${searchQuery}%`;
      return query(
        'SELECT * FROM persons WHERE display_name LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ? ORDER BY display_name',
        [pattern, pattern, pattern, pattern]
      );
    } catch (error) {
      console.error('Search persons error:', error);
      throw error;
    }
  });

  // ============================================================================
  // ASSIGNMENTS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.ASSIGNMENTS_GET_ALL, async () => {
    try {
      return query(
        `SELECT person_id, room_id, role FROM person_room_assignments`
      );
    } catch (error) {
      console.error('Get all assignments error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSIGNMENTS_GET_FOR_PERSON, async (_event, personId: string) => {
    try {
      return query(
        `SELECT a.*, r.title as room_title, r.room_type, r.color, r.icon
         FROM person_room_assignments a
         JOIN rooms r ON a.room_id = r.id
         WHERE a.person_id = ?
         ORDER BY r.title`,
        [personId]
      );
    } catch (error) {
      console.error('Get assignments for person error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ASSIGNMENTS_GET_FOR_ROOM, async (_event, roomId: string) => {
    try {
      return query(
        `SELECT a.*, p.display_name, p.person_type, p.email
         FROM person_room_assignments a
         JOIN persons p ON a.person_id = p.id
         WHERE a.room_id = ?
         ORDER BY p.display_name`,
        [roomId]
      );
    } catch (error) {
      console.error('Get assignments for room error:', error);
      throw error;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.ASSIGNMENTS_CREATE,
    async (_event, personId: string, roomId: string, role: string) => {
      try {
        // Insert assignment
        const result = run(
          'INSERT INTO person_room_assignments (person_id, room_id, role) VALUES (?, ?, ?)',
          [personId, roomId, role]
        );

        // Log change
        run(
          `INSERT INTO change_log (entity_type, entity_id, action, new_data)
           VALUES ('assignment', ?, 'assign', ?)`,
          [`${personId}:${roomId}`, JSON.stringify({ personId, roomId, role })]
        );

        return result;
      } catch (error) {
        console.error('Create assignment error:', error);
        throw error;
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ASSIGNMENTS_DELETE,
    async (_event, personId: string, roomId: string) => {
      try {
        // Get current assignment for logging
        const current = get(
          'SELECT * FROM person_room_assignments WHERE person_id = ? AND room_id = ?',
          [personId, roomId]
        );

        // Delete assignment
        const result = run(
          'DELETE FROM person_room_assignments WHERE person_id = ? AND room_id = ?',
          [personId, roomId]
        );

        // Log change
        if (current) {
          run(
            `INSERT INTO change_log (entity_type, entity_id, action, old_data)
             VALUES ('assignment', ?, 'unassign', ?)`,
            [`${personId}:${roomId}`, JSON.stringify(current)]
          );
        }

        return result;
      } catch (error) {
        console.error('Delete assignment error:', error);
        throw error;
      }
    }
  );

  // ============================================================================
  // SYNC
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.SYNC_GET_STATUS, async () => {
    try {
      const roomCount = get<{ count: number }>('SELECT COUNT(*) as count FROM rooms');
      const personCount = get<{ count: number }>('SELECT COUNT(*) as count FROM persons');
      const assignmentCount = get<{ count: number }>(
        'SELECT COUNT(*) as count FROM person_room_assignments'
      );
      const pendingCount = get<{ count: number }>(
        "SELECT COUNT(*) as count FROM change_log WHERE status = 'pending'"
      );
      const lastSync = get<{ value: string }>("SELECT value FROM settings WHERE key = 'last_sync_at'");

      return {
        roomCount: roomCount?.count || 0,
        personCount: personCount?.count || 0,
        assignmentCount: assignmentCount?.count || 0,
        pendingChanges: pendingCount?.count || 0,
        lastSyncAt: lastSync?.value ? parseInt(lastSync.value) : null,
        isRunning: false,
      };
    } catch (error) {
      console.error('Get sync status error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_GET_PENDING_CHANGES, async () => {
    try {
      return query("SELECT * FROM change_log WHERE status = 'pending' ORDER BY created_at DESC");
    } catch (error) {
      console.error('Get pending changes error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_RUN, async () => {
    try {
      return await runFullSync();
    } catch (error) {
      console.error('Sync run error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_GET_PROGRESS, async () => {
    return getSyncProgress();
  });

  // ============================================================================
  // API CONFIG
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.API_SET_CONFIG, async (_event, config: HazuApiConfig) => {
    console.log('API_SET_CONFIG called with:', {
      apiKey: config.apiKey ? '[REDACTED]' : 'empty',
      environment: config.environment,
      rootHazuId: config.rootHazuId,
      userId: config.userId,
      userEmail: config.userEmail,
    });

    try {
      console.log('Setting config in memory...');
      setApiConfig(config);

      console.log('Saving settings to database...');
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['api_key', config.apiKey]);
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['environment', config.environment]);
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['root_hazu_id', config.rootHazuId]);
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['user_id', config.userId || '']);
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['user_email', config.userEmail || '']);
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['user_display_name', config.userDisplayName || '']);

      console.log('All settings saved successfully');
      return { success: true };
    } catch (error) {
      console.error('Set API config error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_GET_CONFIG, async () => {
    try {
      const apiKey = get<{ value: string }>("SELECT value FROM settings WHERE key = 'api_key'");
      const environment = get<{ value: string }>("SELECT value FROM settings WHERE key = 'environment'");
      const rootHazuId = get<{ value: string }>("SELECT value FROM settings WHERE key = 'root_hazu_id'");
      const userId = get<{ value: string }>("SELECT value FROM settings WHERE key = 'user_id'");
      const userEmail = get<{ value: string }>("SELECT value FROM settings WHERE key = 'user_email'");
      const userDisplayName = get<{ value: string }>("SELECT value FROM settings WHERE key = 'user_display_name'");

      const config: HazuApiConfig = {
        apiKey: apiKey?.value || '',
        environment: (environment?.value as 'swiss' | 'io' | 'dev') || 'swiss',
        rootHazuId: rootHazuId?.value || '',
        userId: userId?.value || '',
        userEmail: userEmail?.value || '',
        userDisplayName: userDisplayName?.value || '',
      };

      // Load config into memory
      if (config.apiKey && config.rootHazuId) {
        setApiConfig(config);
      }

      return config;
    } catch (error) {
      console.error('Get API config error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_IS_CONFIGURED, async () => {
    return isConfigured();
  });

  // ============================================================================
  // SETTINGS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (_event, key: string) => {
    try {
      const result = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
      return result?.value || null;
    } catch (error) {
      console.error('Get setting error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, key: string, value: string) => {
    try {
      run(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, strftime('%s', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = strftime('%s', 'now')`,
        [key, value, value]
      );
    } catch (error) {
      console.error('Set setting error:', error);
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_WEBHOOK_CONFIG, async () => {
    try {
      const adminId = query(`SELECT value FROM settings WHERE key = 'admin_id'`)?.[0]?.value || '';
      const templateId = query(`SELECT value FROM settings WHERE key = 'template_id'`)?.[0]?.value || '';
      const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value || '';
      return { adminId, templateId, webhookUrl };
    } catch (error) {
      console.error('Get webhook config error:', error);
      throw error;
    }
  });

  // ============================================================================
  // WEBHOOKS
  // ============================================================================

  ipcMain.handle(
    IPC_CHANNELS.WEBHOOK_UPDATE_USER_ROLE,
    async (
      _event,
      personId: string,
      roomId: string,
      oldRole: string | null,
      newRole: string | null
    ) => {
      try {
        // Get webhook config and user info
        const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
        const templateId = query(`SELECT value FROM settings WHERE key = 'template_id'`)?.[0]?.value;
        const adminId = query(`SELECT value FROM settings WHERE key = 'admin_id'`)?.[0]?.value;
        const userId = query(`SELECT value FROM settings WHERE key = 'user_id'`)?.[0]?.value;
        const userEmail = query(`SELECT value FROM settings WHERE key = 'user_email'`)?.[0]?.value;
        const userDisplayName = query(`SELECT value FROM settings WHERE key = 'user_display_name'`)?.[0]?.value;

        if (!webhookUrl || !templateId) {
          return { success: false, error: 'Webhook not configured. Run sync first.' };
        }

        if (!userId || !userEmail) {
          return { success: false, error: 'User not configured. Go to Settings and enter your user info.' };
        }

        // Build payload
        const payload = {
          hazu: {
            env: '',
            parentId: adminId,
            userId: userId,
            email: userEmail,
            displayName: userDisplayName || userEmail,
          },
          data: { action: 'update-user-roles' },
          dataForCloudFunction: {
            templateId,
            profileId: personId,
            userTypesInfo: [
              {
                classId: roomId,
                // Use '_' to indicate no role (deletion) in webhook payload
                oldUserType: oldRole || '_',
                newUserType: newRole || '_',
              },
            ],
          },
        };

        // Call webhook
        console.log('[WEBHOOK] Sending payload:', JSON.stringify(payload, null, 2));
        const response = await axios.post(webhookUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        });
        console.log('[WEBHOOK] Response:', response.status, response.data);

        // Update local DB on success
        if (newRole && newRole !== '_') {
          query(
            `INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at)
             VALUES (?, ?, ?, ?)`,
            [personId, roomId, newRole, Date.now()]
          );
        } else {
          query(
            `DELETE FROM person_room_assignments WHERE person_id = ? AND room_id = ?`,
            [personId, roomId]
          );
        }

        return { success: true };
      } catch (error) {
        // Webhooks return error objects instead of throwing
        // to allow graceful UI handling of network failures
        console.error('Webhook error:', error);
        let message = 'Unknown error';
        if (axios.isAxiosError(error)) {
          message = error.response?.data?.message || error.message;
        } else if (error instanceof Error) {
          message = error.message;
        }
        return { success: false, error: message };
      }
    }
  );

  console.log('IPC handlers registered');
}
