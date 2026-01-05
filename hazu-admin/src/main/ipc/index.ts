import { ipcMain, shell, dialog } from 'electron';
import axios from 'axios';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { query, run, get } from '../database';
import { setApiConfig, getApiConfig, isConfigured, HazuApiConfig } from '../services/hazu-api/config';
import { runFullSync, getSyncProgress } from '../services/sync.service';
import { sendApiRequestList } from '../services/hazu-api/api';

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
  // TEMPLATES
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.TEMPLATES_FETCH, async () => {
    try {
      // Check if API is configured
      if (!isConfigured()) {
        return { success: false, error: 'API not configured. Please configure API settings first.' };
      }

      // Get the templateLink (template_id) from settings - this is where templates live
      const templateIdRow = get<{ value: string }>("SELECT value FROM settings WHERE key = 'template_id'");
      const templateId = templateIdRow?.value;

      if (!templateId) {
        return { success: false, error: 'Template ID not configured. Please run sync first to fetch from Admin Hazu.' };
      }

      // Fetch children from Hazu API (templates are children of templateLink)
      console.log('[TEMPLATES_FETCH] Fetching templates from template_id:', templateId);
      const children = await sendApiRequestList(templateId);

      if (!children) {
        return { success: false, error: 'Failed to fetch templates from Hazu API.' };
      }

      // Filter and map to Template interface
      const templates = children
        .filter(child => {
          // Must have snapshot and tags
          if (!child.snapshot || !Array.isArray(child.snapshot.tags)) {
            return false;
          }
          // Must have at least one hz-config-room-* tag
          return child.snapshot.tags.some(tag =>
            typeof tag === 'string' && tag.startsWith('hz-config-room-')
          );
        })
        .map(child => {
          const snapshot = child.snapshot;

          // Extract room type from tag
          const roomTypeTag = snapshot.tags.find((tag: string) =>
            tag.startsWith('hz-config-room-')
          );

          // Extract the type part after 'hz-config-room-'
          let roomType = roomTypeTag?.replace('hz-config-room-', '') || '';

          // Normalize 'entreprise' to 'enterprise'
          if (roomType === 'entreprise') {
            roomType = 'enterprise';
          }

          // Strip HTML tags from title
          const cleanTitle = (snapshot.title || 'Untitled').replace(/<[^>]*>/g, '').trim();

          return {
            id: snapshot.key,
            title: cleanTitle,
            roomType: roomType as 'class' | 'cie' | 'enterprise' | 'state',
            icon: snapshot.icon,
            color: snapshot.color,
          };
        });

      console.log(`[TEMPLATES_FETCH] Found ${templates.length} templates`);
      return { success: true, templates };

    } catch (error) {
      console.error('Fetch templates error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to fetch templates: ${errorMessage}` };
    }
  });

  // ============================================================================
  // PROFILE CATEGORIES
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.PROFILE_CATEGORIES_FETCH, async () => {
    try {
      // Check if API is configured
      if (!isConfigured()) {
        return { success: false, error: 'API not configured. Please configure API settings first.' };
      }

      // Get the root_hazu_id from settings
      const rootHazuIdRow = get<{ value: string }>("SELECT value FROM settings WHERE key = 'root_hazu_id'");
      const rootHazuId = rootHazuIdRow?.value;

      if (!rootHazuId) {
        return { success: false, error: 'Root Hazu ID not configured. Please configure API settings first.' };
      }

      // Fetch first-level children from Hazu API
      console.log('[PROFILE_CATEGORIES_FETCH] Fetching categories from root_hazu_id:', rootHazuId);
      const children = await sendApiRequestList(rootHazuId);

      if (!children) {
        return { success: false, error: 'Failed to fetch profile categories from Hazu API.' };
      }

      // Filter and map to ProfileCategory interface
      const categories = children
        .filter(child => {
          // Must have snapshot and tags
          if (!child.snapshot || !Array.isArray(child.snapshot.tags)) {
            return false;
          }
          // Must have at least one hz-config-profile-* tag
          return child.snapshot.tags.some(tag =>
            typeof tag === 'string' && tag.startsWith('hz-config-profile-')
          );
        })
        .map(child => {
          const snapshot = child.snapshot;

          // Extract profile type from tag
          const profileTypeTag = snapshot.tags.find((tag: string) =>
            tag.startsWith('hz-config-profile-')
          );

          // Extract the type part after 'hz-config-profile-'
          const profileType = profileTypeTag?.replace('hz-config-profile-', '') || '';

          // Strip HTML tags from title
          const cleanTitle = (snapshot.title || 'Untitled').replace(/<[^>]*>/g, '').trim();

          return {
            id: snapshot.key,
            title: cleanTitle,
            profileType: profileType,
          };
        });

      console.log(`[PROFILE_CATEGORIES_FETCH] Found ${categories.length} profile categories`);
      return { success: true, categories };

    } catch (error) {
      console.error('Fetch profile categories error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to fetch profile categories: ${errorMessage}` };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_TEMPLATES_FETCH, async (_event, role: string) => {
    try {
      // Validate role parameter
      if (!role || typeof role !== 'string' || role.trim() === '') {
        return { success: false, error: 'Invalid role parameter. Role must be a non-empty string.' };
      }

      // Check if API is configured
      if (!isConfigured()) {
        return { success: false, error: 'API not configured. Please configure API settings first.' };
      }

      // Get the template_id from settings
      const templateIdRow = get<{ value: string }>("SELECT value FROM settings WHERE key = 'template_id'");
      const templateId = templateIdRow?.value;

      if (!templateId) {
        return { success: false, error: 'Template ID not configured. Please run sync first to fetch from Admin Hazu.' };
      }

      // Fetch children from Hazu API (profile templates are children of template_id)
      console.log('[PROFILE_TEMPLATES_FETCH] Fetching templates from template_id:', templateId, 'for role:', role);
      const children = await sendApiRequestList(templateId);

      if (!children) {
        return { success: false, error: 'Failed to fetch profile templates from Hazu API.' };
      }

      // Construct the tag to look for
      const targetTag = `hz-config-profile-${role}`;

      // Filter and map to ProfileTemplate interface
      const templates = children
        .filter(child => {
          // Must have snapshot and tags
          if (!child.snapshot || !Array.isArray(child.snapshot.tags)) {
            return false;
          }
          // Must have the matching hz-config-profile-{role} tag
          return child.snapshot.tags.some(tag =>
            typeof tag === 'string' && tag === targetTag
          );
        })
        .map(child => {
          const snapshot = child.snapshot;

          // Strip HTML tags from title
          const cleanTitle = (snapshot.title || 'Untitled').replace(/<[^>]*>/g, '').trim();

          return {
            id: snapshot.key,
            title: cleanTitle,
          };
        });

      console.log(`[PROFILE_TEMPLATES_FETCH] Found ${templates.length} profile templates for role "${role}"`);
      return { success: true, templates };

    } catch (error) {
      console.error('Fetch profile templates error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to fetch profile templates: ${errorMessage}` };
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
        // Get webhook config - templateId is actually root_hazu_id
        const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
        const rootHazuId = query(`SELECT value FROM settings WHERE key = 'root_hazu_id'`)?.[0]?.value;

        if (!webhookUrl) {
          return { success: false, error: 'Webhook not configured. Run sync first.' };
        }

        if (!rootHazuId) {
          return { success: false, error: 'Root Hazu ID not configured. Go to Settings.' };
        }

        // Build payload - matches Admin Panel format exactly
        const payload = {
          hazu: {
            env: '',
          },
          data: { action: 'update-user-roles' },
          dataForCloudFunction: {
            templateId: rootHazuId,
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
          timeout: 100000,
        });
        console.log('[WEBHOOK] Response:', response.status, response.data);

        // Update local DB on success
        if (newRole && newRole !== '_') {
          run(
            `INSERT OR REPLACE INTO person_room_assignments (person_id, room_id, role, synced_at)
             VALUES (?, ?, ?, ?)`,
            [personId, roomId, newRole, Date.now()]
          );
        } else {
          run(
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

  ipcMain.handle(
    IPC_CHANNELS.WEBHOOK_CREATE_ROOM,
    async (_event, templateId: string, targetId: string, title: string) => {
      try {
        // Get webhook config
        const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
        const rootHazuId = query(`SELECT value FROM settings WHERE key = 'root_hazu_id'`)?.[0]?.value;

        if (!webhookUrl) {
          return { success: false, error: 'Webhook not configured. Run sync first.' };
        }

        if (!rootHazuId) {
          return { success: false, error: 'Root Hazu ID not configured. Go to Settings.' };
        }

        // Build payload for create-group action
        const payload = {
          data: { action: 'create-group' },
          hazu: { env: '' },
          dataForCloudFunction: {
            sourceId: templateId,     // Template to copy
            templateId: rootHazuId,   // Root template ID
            targetId: targetId,       // Where to create it
            title: title,             // User-entered room name
          },
        };

        // Call webhook
        console.log('[WEBHOOK_CREATE_ROOM] Sending payload:', JSON.stringify(payload, null, 2));
        const response = await axios.post(webhookUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 100000,
        });
        console.log('[WEBHOOK_CREATE_ROOM] Response:', response.status, response.data);

        // Extract room data from response
        const profileSnapshot = response.data?.profileSnapshot?.snapshot;
        if (!profileSnapshot) {
          return { success: false, error: 'Invalid webhook response: missing profileSnapshot' };
        }

        // Extract room type from tags (hz-config-room-*)
        let roomType = 'class'; // default
        if (Array.isArray(profileSnapshot.tags)) {
          const roomTypeTag = profileSnapshot.tags.find((tag: string) =>
            tag.startsWith('hz-config-room-')
          );
          if (roomTypeTag) {
            roomType = roomTypeTag.replace('hz-config-room-', '');
            // Normalize 'entreprise' to 'enterprise'
            if (roomType === 'entreprise') {
              roomType = 'enterprise';
            }
          }
        }

        // Insert into rooms table
        const now = Date.now();
        run(
          `INSERT INTO rooms (id, title, description, color, icon, room_type, parent_id, tags, raw_data, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            profileSnapshot.key,
            profileSnapshot.title || title,
            profileSnapshot.description || null,
            profileSnapshot.color || null,
            profileSnapshot.icon || null,
            roomType,
            profileSnapshot.parentId || targetId,
            JSON.stringify(profileSnapshot.tags || []),
            JSON.stringify(profileSnapshot),
            now,
          ]
        );

        // Build room object to return
        const room = {
          id: profileSnapshot.key,
          title: profileSnapshot.title || title,
          description: profileSnapshot.description || null,
          color: profileSnapshot.color || null,
          icon: profileSnapshot.icon || null,
          room_type: roomType,
          parent_id: profileSnapshot.parentId || targetId,
          tags: profileSnapshot.tags || [],
          raw_data: JSON.stringify(profileSnapshot),
          synced_at: now,
        };

        console.log('[WEBHOOK_CREATE_ROOM] Room created successfully:', room.id);
        return { success: true, room };
      } catch (error) {
        console.error('Webhook create room error:', error);
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

  ipcMain.handle(
    IPC_CHANNELS.WEBHOOK_CREATE_PERSON,
    async (
      _event,
      params: {
        sourceId: string;
        targetId: string;
        firstName: string;
        lastName: string;
        userEmail: string;
        role: string;
        roomIds: string[];
        invitationMail: boolean;
      }
    ) => {
      try {
        // Get webhook config
        const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
        const adminIdRow = query(`SELECT value FROM settings WHERE key = 'admin_id'`)?.[0]?.value;
        const rootHazuId = query(`SELECT value FROM settings WHERE key = 'root_hazu_id'`)?.[0]?.value;

        if (!webhookUrl) {
          return { success: false, error: 'Webhook not configured. Run sync first.' };
        }

        // Use admin_id if available, fall back to root_hazu_id
        const adminId = adminIdRow || rootHazuId;
        if (!adminId) {
          return { success: false, error: 'Admin ID not configured. Go to Settings.' };
        }

        // Build classIds array from roomIds
        const classIds = params.roomIds.map(roomId => ({
          classId: roomId,
          userType: params.role,
        }));

        // Build payload for add-user action
        const payload = {
          data: {
            action: 'add-user',
            invitationMail: params.invitationMail,
          },
          hazu: {
            env: '',
          },
          dataForCloudFunction: {
            sourceId: params.sourceId,           // Template to copy from
            targetId: params.targetId,           // Profile category folder ID
            adminId: adminId,                    // Admin Hazu ID
            firstName: params.firstName,
            lastName: params.lastName,
            userEmail: params.userEmail,
            classIds: classIds,                  // Room assignments
          },
        };

        // Call webhook
        console.log('[WEBHOOK_CREATE_PERSON] Sending payload:', JSON.stringify(payload, null, 2));
        const response = await axios.post(webhookUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 100000,
        });
        console.log('[WEBHOOK_CREATE_PERSON] Response:', response.status, response.data);

        // Extract person data from response
        const profileSnapshot = response.data?.profileSnapshot?.snapshot;
        if (!profileSnapshot) {
          return { success: false, error: 'Invalid webhook response: missing profileSnapshot' };
        }

        // Insert into persons table
        const now = Date.now();
        run(
          `INSERT INTO persons (id, email, first_name, last_name, display_name, person_type, tags, raw_data, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            profileSnapshot.key,
            params.userEmail,
            params.firstName,
            params.lastName,
            `${params.firstName} ${params.lastName}`,
            params.role,
            JSON.stringify(profileSnapshot.tags || []),
            JSON.stringify(profileSnapshot),
            now,
          ]
        );

        // Insert room assignments
        for (const roomId of params.roomIds) {
          run(
            `INSERT INTO person_room_assignments (person_id, room_id, role, synced_at)
             VALUES (?, ?, ?, ?)`,
            [profileSnapshot.key, roomId, params.role, now]
          );
        }

        // Build person object to return
        const person = {
          id: profileSnapshot.key,
          email: params.userEmail,
          first_name: params.firstName,
          last_name: params.lastName,
          display_name: `${params.firstName} ${params.lastName}`,
          person_type: params.role,
          tags: profileSnapshot.tags || [],
          raw_data: JSON.stringify(profileSnapshot),
          synced_at: now,
        };

        console.log('[WEBHOOK_CREATE_PERSON] Person created successfully:', person.id);
        return { success: true, person };
      } catch (error) {
        console.error('Webhook create person error:', error);
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

  ipcMain.handle(IPC_CHANNELS.WEBHOOK_DELETE_ROOM, async (_event, roomId: string) => {
    try {
      // Get webhook config - templateId is actually root_hazu_id
      const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
      const rootHazuId = query(`SELECT value FROM settings WHERE key = 'root_hazu_id'`)?.[0]?.value;

      if (!webhookUrl) {
        return { success: false, error: 'Webhook not configured. Run sync first.' };
      }

      if (!rootHazuId) {
        return { success: false, error: 'Root Hazu ID not configured. Run sync first.' };
      }

      // Build payload for remove-group action
      const payload = {
        hazu: {
          env: '',
        },
        data: {
          action: 'remove-group',
        },
        dataForCloudFunction: {
          templateId: rootHazuId,
          groupId: roomId,
        },
      };

      // Call webhook
      console.log('[WEBHOOK_DELETE_ROOM] Sending payload:', JSON.stringify(payload, null, 2));
      const response = await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 100000,
      });
      console.log('[WEBHOOK_DELETE_ROOM] Response:', response.status, response.data);

      // Delete from local database on success
      run('DELETE FROM rooms WHERE id = ?', [roomId]);
      console.log('[WEBHOOK_DELETE_ROOM] Room deleted successfully:', roomId);

      return { success: true };
    } catch (error) {
      console.error('Webhook delete room error:', error);
      let message = 'Unknown error';
      if (axios.isAxiosError(error)) {
        message = error.response?.data?.message || error.message;
      } else if (error instanceof Error) {
        message = error.message;
      }
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WEBHOOK_DELETE_PERSON, async (_event, personId: string) => {
    try {
      // Get webhook config - templateId is actually root_hazu_id
      const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
      const rootHazuId = query(`SELECT value FROM settings WHERE key = 'root_hazu_id'`)?.[0]?.value;

      if (!webhookUrl) {
        return { success: false, error: 'Webhook not configured. Run sync first.' };
      }

      if (!rootHazuId) {
        return { success: false, error: 'Root Hazu ID not configured. Run sync first.' };
      }

      // Build payload for remove-user action
      const payload = {
        hazu: {
          env: '',
        },
        data: {
          action: 'remove-user',
        },
        dataForCloudFunction: {
          templateId: rootHazuId,
          profileId: personId,
        },
      };

      // Call webhook
      console.log('[WEBHOOK_DELETE_PERSON] Sending payload:', JSON.stringify(payload, null, 2));
      const response = await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 100000,
      });
      console.log('[WEBHOOK_DELETE_PERSON] Response:', response.status, response.data);

      // Delete from local database on success
      run('DELETE FROM persons WHERE id = ?', [personId]);
      console.log('[WEBHOOK_DELETE_PERSON] Person deleted successfully:', personId);

      return { success: true };
    } catch (error) {
      console.error('Webhook delete person error:', error);
      let message = 'Unknown error';
      if (axios.isAxiosError(error)) {
        message = error.response?.data?.message || error.message;
      } else if (error instanceof Error) {
        message = error.message;
      }
      return { success: false, error: message };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.WEBHOOK_RENAME_ROOM,
    async (_event, roomId: string, newTitle: string) => {
      try {
        // Get webhook config - templateId is actually root_hazu_id
        const webhookUrl = query(`SELECT value FROM settings WHERE key = 'webhook_url'`)?.[0]?.value;
        const rootHazuId = query(`SELECT value FROM settings WHERE key = 'root_hazu_id'`)?.[0]?.value;

        if (!webhookUrl) {
          return { success: false, error: 'Webhook not configured. Run sync first.' };
        }

        if (!rootHazuId) {
          return { success: false, error: 'Root Hazu ID not configured. Run sync first.' };
        }

        // Build payload for rename-group action
        const payload = {
          hazu: {
            env: '',
          },
          data: {
            action: 'rename-group',
          },
          dataForCloudFunction: {
            templateId: rootHazuId,
            groupId: roomId,
            newName: newTitle,
          },
        };

        // Call webhook
        console.log('[WEBHOOK_RENAME_ROOM] Sending payload:', JSON.stringify(payload, null, 2));
        const response = await axios.post(webhookUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 100000,
        });
        console.log('[WEBHOOK_RENAME_ROOM] Response:', response.status, response.data);

        // Update local database on success
        run('UPDATE rooms SET title = ? WHERE id = ?', [newTitle, roomId]);
        console.log('[WEBHOOK_RENAME_ROOM] Room renamed successfully:', roomId, '->', newTitle);

        return { success: true };
      } catch (error) {
        console.error('Webhook rename room error:', error);
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

  // ============================================================================
  // SHELL
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // ============================================================================
  // FILE SELECT DIALOG
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.FILE_SELECT_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return { canceled: false, filePath: result.filePaths[0] };
  });

  // ============================================================================
  // FILE PARSING
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.FILE_PARSE, async (_event, filePath: string, hasHeaders: boolean) => {
    try {
      console.log('[FILE_PARSE] Parsing file:', filePath, 'hasHeaders:', hasHeaders);

      // Lazy require to avoid issues with Electron sandbox
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const XLSX = require('xlsx');

      // Read file
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convert to JSON
      const rawData: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
        header: hasHeaders ? undefined : 1,
        defval: '',
      });

      if (rawData.length === 0) {
        return { success: false, error: 'File is empty or contains no data' };
      }

      // Extract headers
      let headers: string[];
      let rows: Record<string, string>[];

      if (hasHeaders) {
        headers = Object.keys(rawData[0]);
        rows = rawData.map((row: Record<string, any>) => {
          const normalized: Record<string, string> = {};
          for (const key of headers) {
            normalized[key] = String(row[key] ?? '');
          }
          return normalized;
        });
      } else {
        const firstRow = rawData[0];
        const numCols = Object.keys(firstRow).length;
        headers = Array.from({ length: numCols }, (_, i) => {
          const letter = String.fromCharCode(65 + (i % 26));
          const prefix = i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '';
          return `Column ${prefix}${letter}`;
        });

        rows = rawData.map((row: Record<string, any>) => {
          const normalized: Record<string, string> = {};
          const values = Object.values(row);
          headers.forEach((header, i) => {
            normalized[header] = String(values[i] ?? '');
          });
          return normalized;
        });
      }

      console.log('[FILE_PARSE] Parsed', rows.length, 'rows with', headers.length, 'columns');
      return { success: true, data: { headers, rows } };
    } catch (error) {
      console.error('File parse error:', error);
      const message = error instanceof Error ? error.message : 'Failed to parse file';
      return { success: false, error: message };
    }
  });

  console.log('IPC handlers registered');
}
