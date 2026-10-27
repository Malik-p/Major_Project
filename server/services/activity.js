import { Activity } from '../models/index.js';

/** Records a project event for the dashboard activity feed. Never blocks the main request on failure. */
export async function logActivity(project, type, message, actor = '') {
  try {
    await Activity.create({ project, type, message, actor });
  } catch (error) {
    console.warn('Could not record activity:', error.message);
  }
}
