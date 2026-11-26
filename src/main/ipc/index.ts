import { ipcMain, shell, dialog } from 'electron';
import axios from 'axios';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { query, run, get } from '../database';
import { setApiConfig, getApiConfig, isConfigured, HazuApiConfig } from '../services/hazu-api/config';
import { runFullSync, getSyncProgress } from '../services/sync.service';
import { sendApiRequestList } from '../services/hazu-api/api';
import {
  startFormationSync, getFormationSyncStatus, getFormationOverview, getFormationDetail, getFormationStudent,
} from '../services/formation-sync.service';
import type { FormationDetailFilters, LevelCode } from '../../shared/formation-types';
import { getDiscrepancies } from '../services/discrepancy.service';
import { getTagHealPlan, healPersonTag } from '../services/tag-healing.service';
import { reliableUpdateUserRole } from '../services/role-write.service';
import { planOrphanRemoval, revokeOrphanAccess } from '../services/orphan-removal.service';
import { planTagPrune, pruneDeadTags } from '../services/tag-prune.service';
import { PruneItem } from '../services/tag-prune';
import {
  listArchivableRooms,
  planArchive,
  listArchivedRooms,
  archiveRoom,
  planRestore,
  restoreRoom,
} from '../services/room-archive.service';
import {
  planPersonArchive,
  listArchivedPersons,
  archivePerson,
  restorePerson,
} from '../services/person-archive.service';
import {
  executeLevelChange,
  levelChangeCandidates,
  listLevelChangeStudents,
  planLevelChange,
} from '../services/level-change.service';
import type { Level } from '../../shared/level-change-types';
import { validateApiConfig } from '../services/config-probe.service';
import { completeAndStoreNewRoom } from '../services/room-completion.service';
import { describeError } from '../services/hazu-api/describe-error';

export function registerIpcHandlers(): void {
  // ============================================================================
  // DATABASE OPERATIONS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.DB_QUERY, async (_event, sql: string, params?: any[]) => {
    try {
      return query(sql, params);
    } catch (error) {
      console.error('DB Query error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.DB_RUN, async (_event, sql: string, params?: any[]) => {
    try {
      return run(sql, params);
    } catch (error) {
      console.error('DB Run error:', describeError(error));
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
      console.error('Get rooms error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ROOMS_GET_BY_ID, async (_event, id: string) => {
    try {
      return get('SELECT * FROM rooms WHERE id = ?', [id]);
    } catch (error) {
      console.error('Get room by ID error:', describeError(error));
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
      console.error('Search rooms error:', describeError(error));
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
      console.error('Get persons error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.PERSONS_GET_BY_ID, async (_event, id: string) => {
    try {
      return get('SELECT * FROM persons WHERE id = ?', [id]);
    } catch (error) {
      console.error('Get person by ID error:', describeError(error));
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
      console.error('Search persons error:', describeError(error));
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
      console.error('Get all assignments error:', describeError(error));
      throw error;
    }
  });

  // ============================================================================
  // DISCREPANCIES (S2 report)
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.DISCREPANCIES_GET, async () => {
    try {
      return getDiscrepancies();
    } catch (error) {
      console.error('Get discrepancies error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.TAG_HEAL_PLAN_GET, async () => {
    try {
      return getTagHealPlan();
    } catch (error) {
      console.error('Get tag heal plan error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.TAG_HEAL, async (_event, personId: string, tag: string) => {
    try {
      return await healPersonTag(personId, tag);
    } catch (error) {
      console.error('Tag heal error:', describeError(error));
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.ORPHAN_ACCESS_PLAN,
    async (_event, accountId: string, groupId: string, roomId: string) => {
      try {
        return await planOrphanRemoval(accountId, groupId, roomId);
      } catch (error) {
        console.error('Orphan access plan error:', describeError(error));
        throw error;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.ORPHAN_ACCESS_REVOKE,
    async (_event, accountId: string, groupId: string, roomId: string) => {
      try {
        return await revokeOrphanAccess(accountId, groupId, roomId);
      } catch (error) {
        console.error('Orphan access revoke error:', describeError(error));
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  // Plan rethrows: a failure to build the plan must reach the page's error banner rather
  // than opening a confirmation modal over an empty plan.
  ipcMain.handle(IPC_CHANNELS.TAG_PRUNE_PLAN, async () => {
    try {
      return await planTagPrune();
    } catch (error) {
      console.error('Tag prune plan error:', describeError(error));
      throw error;
    }
  });

  // Room archive. List/plan handlers rethrow so the Archive page shows the error;
  // execute handlers return the outcome (the service never rejects) so the Task Queue
  // can render failure and offer a retry.
  ipcMain.handle(IPC_CHANNELS.ARCHIVE_LIST_ROOMS, async () => {
    try {
      return listArchivableRooms();
    } catch (error) {
      console.error('Archive list rooms error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_LIST_ARCHIVED, async () => {
    try {
      return await listArchivedRooms();
    } catch (error) {
      console.error('Archive list archived error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_PLAN, async (_event, roomId: string) => {
    try {
      return planArchive(roomId);
    } catch (error) {
      console.error('Archive plan error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_EXECUTE, async (_event, roomId: string) => {
    return archiveRoom(roomId);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_RESTORE_PLAN, async (_event, folderId: string) => {
    try {
      return await planRestore(folderId);
    } catch (error) {
      console.error('Archive restore plan error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_RESTORE_EXECUTE, async (_event, folderId: string) => {
    return restoreRoom(folderId);
  });

  // Person archive: same contract as the room archive handlers above.
  ipcMain.handle(IPC_CHANNELS.ARCHIVE_PERSON_PLAN, async (_event, personId: string) => {
    try {
      return planPersonArchive(personId);
    } catch (error) {
      console.error('Person archive plan error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_PERSON_LIST_ARCHIVED, async () => {
    try {
      return await listArchivedPersons();
    } catch (error) {
      console.error('Person archive list error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_PERSON_EXECUTE, async (_event, personId: string) => {
    return archivePerson(personId);
  });

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_PERSON_RESTORE_EXECUTE, async (_event, folderId: string) => {
    return restorePerson(folderId);
  });

  // Level change: students / candidates / plan rethrow so the page shows the error;
  // execute returns its outcome (it runs inside the page's confirm flow and reports `error`).
  ipcMain.handle(IPC_CHANNELS.LEVEL_CHANGE_STUDENTS, async () => {
    try {
      return listLevelChangeStudents();
    } catch (error) {
      console.error('Level change students error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.LEVEL_CHANGE_CANDIDATES, async (_event, personId: string) => {
    try {
      return await levelChangeCandidates(personId);
    } catch (error) {
      console.error('Level change candidates error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.LEVEL_CHANGE_PLAN,
    async (_event, personId: string, toLevel: Level, targetTemplateId: string) => {
      try {
        return await planLevelChange(personId, toLevel, targetTemplateId);
      } catch (error) {
        console.error('Level change plan error:', describeError(error));
        throw error;
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LEVEL_CHANGE_EXECUTE,
    async (_event, personId: string, toLevel: Level, targetTemplateId: string) => {
      return executeLevelChange(personId, toLevel, targetTemplateId);
    },
  );

  // Execute returns its failure: this runs inside a Task Queue task, which renders the
  // error on the task row and offers a retry.
  ipcMain.handle(
    IPC_CHANNELS.TAG_PRUNE_EXECUTE,
    async (_event, personId: string, items: PruneItem[]) => {
      try {
        return await pruneDeadTags(personId, items);
      } catch (error) {
        console.error('Tag prune execute error:', describeError(error));
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          deletedTags: [],
          skippedClassIds: [],
        };
      }
    },
  );

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
      console.error('Get assignments for person error:', describeError(error));
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
      console.error('Get assignments for room error:', describeError(error));
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
        console.error('Create assignment error:', describeError(error));
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
        console.error('Delete assignment error:', describeError(error));
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
      console.error('Get sync status error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_GET_PENDING_CHANGES, async () => {
    try {
      return query("SELECT * FROM change_log WHERE status = 'pending' ORDER BY created_at DESC");
    } catch (error) {
      console.error('Get pending changes error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SYNC_RUN, async () => {
    try {
      return await runFullSync();
    } catch (error) {
      console.error('Sync run error:', describeError(error));
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
      console.error('Set API config error:', describeError(error));
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
      console.error('Get API config error:', describeError(error));
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.API_IS_CONFIGURED, async () => {
    return isConfigured();
  });

  // Read-only. Never writes settings and never touches the in-memory config, so a failed
  // probe leaves a working configuration untouched.
  ipcMain.handle(
    IPC_CHANNELS.API_VALIDATE_CONFIG,
    async (_event, config: { apiKey: string; environment: string; rootHazuId: string }) => {
      return validateApiConfig(config);
    }
  );

  // ============================================================================
  // SETTINGS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async (_event, key: string) => {
    try {
      const result = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
      return result?.value || null;
    } catch (error) {
      console.error('Get setting error:', describeError(error));
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
      console.error('Set setting error:', describeError(error));
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
      console.error('Get webhook config error:', describeError(error));
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
      console.error('Fetch templates error:', describeError(error));
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
      console.error('Fetch profile categories error:', describeError(error));
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
      console.error('Fetch profile templates error:', describeError(error));
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: `Failed to fetch profile templates: ${errorMessage}` };
    }
  });

  // ============================================================================
  // USER TYPES
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.USER_TYPES_GET_ALL, async () => {
    try {
      return query('SELECT id, name, title FROM user_types ORDER BY title');
    } catch (error) {
      console.error('Get user types error:', describeError(error));
      throw error;
    }
  });

  // ============================================================================
  // DISTRIBUTION GROUPS
  // ============================================================================

  ipcMain.handle(
    IPC_CHANNELS.DISTRIBUTION_GROUPS_GET,
    async (_event, roomId: string, role: string) => {
      try {
        return get(
          'SELECT id FROM distribution_groups WHERE room_id = ? AND role = ?',
          [roomId, role]
        );
      } catch (error) {
        console.error('Get distribution group error:', describeError(error));
        throw error;
      }
    }
  );

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
        // S4: retry + verify against role-group truth + reconcile local from truth.
        // Returns success:false when the write can't be confirmed (no more false successes).
        const result = await reliableUpdateUserRole(personId, roomId, oldRole, newRole);
        return { success: result.success, error: result.error };
      } catch (error) {
        console.error('Update user role error:', describeError(error));
        return { success: false, error: error instanceof Error ? error.message : String(error) };
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

        // Give the new row its class id and role groups now, instead of at the next sync, so
        // assignments to this room work and are verified against group truth right away.
        // Never throws; a gap is logged and the next sync fills it.
        const completion = await completeAndStoreNewRoom(profileSnapshot.key, profileSnapshot.tags || []);

        // Build room object to return
        const room = {
          id: profileSnapshot.key,
          class_id: completion.classId,
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
        console.error('Webhook create room error:', describeError(error));
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
        const { getApiEndpoint, getApiKey } = await import('../services/hazu-api/config');
        const token = getApiKey();
        const headers = token.length <= 20 ? { token } : { 'x-api-key': token };

        // Get adminId from settings (hz-config-admin hazu)
        const adminIdRow = get<{ value: string }>("SELECT value FROM settings WHERE key = 'admin_id'");
        const adminId = adminIdRow?.value;
        if (!adminId) {
          return { success: false, error: 'Admin ID not found. Please run sync first.' };
        }

        // Step 1: Create person via add-users (no classIds — room assignment done separately)
        const apiPayload = {
          users: [
            {
              sourceId: params.sourceId,           // Profile template ID
              adminId: adminId,                    // Admin Hazu ID (hz-config-admin)
              targetId: params.targetId,           // Parent container ID (where profiles are stored)
              firstName: params.firstName,
              lastName: params.lastName,
              userEmail: params.userEmail,
            },
          ],
        };

        console.log('[CREATE_PERSON] Calling API:', JSON.stringify(apiPayload, null, 2));
        const response = await axios.post(
          `https://${getApiEndpoint()}/api-v2-admin/add-users`,
          apiPayload,
          { headers, timeout: 120000 }
        );
        console.log('[CREATE_PERSON] Response:', response.status, response.data);

        // Parse { totalUsers, successful, failed, results, errors } response format
        const data = response.data;
        if (!data?.successful || data.successful < 1 || !data.results?.length) {
          const apiError = data?.errors?.[0]?.error || 'Unknown API error';
          return { success: false, error: `Failed to create person: ${apiError}` };
        }

        // Extract the new profile id from results[0].
        // add-users returns a thin result: { index, profileId, firstName, lastName, userEmail, success }.
        // Fall back to snapshot shapes in case another endpoint/version returns a full profile object.
        const result = data.results[0];
        const profileSnapshot = result?.profileSnapshot?.snapshot
          || result?.profileSnapshot
          || result?.snapshot
          || null;
        const profileId = result?.profileId || profileSnapshot?.key;

        if (!profileId) {
          return { success: false, error: `Invalid API response: cannot extract profile. Raw result: ${JSON.stringify(result)}` };
        }

        // Insert into persons table. add-users does not return tags/icon/color —
        // the next Dashboard sync (INSERT OR REPLACE by id) enriches this record.
        const now = Date.now();
        const tags = profileSnapshot?.tags || [];
        run(
          `INSERT OR REPLACE INTO persons (id, email, first_name, last_name, display_name, person_type, tags, raw_data, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            profileId,
            params.userEmail,
            params.firstName,
            params.lastName,
            `${params.firstName} ${params.lastName}`,
            params.role,
            JSON.stringify(tags),
            JSON.stringify(profileSnapshot || result),
            now,
          ]
        );

        // Step 2: Assign rooms via the hardened write (retry + verify + reconcile local).
        for (const roomId of params.roomIds) {
          try {
            const assignResult = await reliableUpdateUserRole(profileId, roomId, '_', params.role);
            if (!assignResult.success) {
              console.error('[CREATE_PERSON] Room assignment failed for', roomId, assignResult.error);
            }
          } catch (err) {
            console.error('[CREATE_PERSON] Room assignment threw for', roomId, describeError(err));
          }
        }

        // Build person object to return
        const person = {
          id: profileId,
          email: params.userEmail,
          first_name: params.firstName,
          last_name: params.lastName,
          display_name: `${params.firstName} ${params.lastName}`,
          person_type: params.role,
          tags: tags,
          raw_data: JSON.stringify(profileSnapshot || result),
          synced_at: now,
        };

        console.log('[CREATE_PERSON] Person created successfully:', person.id);
        return { success: true, person };
      } catch (error) {
        console.error('Create person error:', describeError(error));
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
      console.error('Webhook delete room error:', describeError(error));
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
      console.error('Webhook delete person error:', describeError(error));
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
        console.error('Webhook rename room error:', describeError(error));
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
  // MISSIONS — FORMATION OVERVIEW (read-only against Hazu; see formation-sync.service.ts)
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.FORMATION_SYNC_START, async () => startFormationSync());

  ipcMain.handle(IPC_CHANNELS.FORMATION_SYNC_STATUS, async () => getFormationSyncStatus());

  ipcMain.handle(IPC_CHANNELS.FORMATION_OVERVIEW, async () => getFormationOverview());

  ipcMain.handle(
    IPC_CHANNELS.FORMATION_DETAIL,
    async (_event, key: string, level: LevelCode | 'both', filters: FormationDetailFilters) => getFormationDetail(key, level, filters),
  );

  ipcMain.handle(IPC_CHANNELS.FORMATION_STUDENT, async (_event, personId: string) => getFormationStudent(personId));

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
      console.error('File parse error:', describeError(error));
      const message = error instanceof Error ? error.message : 'Failed to parse file';
      return { success: false, error: message };
    }
  });

  console.log('IPC handlers registered');
}
