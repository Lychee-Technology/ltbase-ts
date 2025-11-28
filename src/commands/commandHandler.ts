import { readFile } from 'node:fs/promises';
import { ApiClient, ApiResponse, QueryParams } from '../api/client';

export interface CreateActivityOptions {
  id: string;
  type: 'call' | 'line' | 'email' | 'visit' | 'note';
  direction: 'inbound' | 'outbound';
  at: string;
  userId: string;
  summary: string;
  nextFollowUpAt?: string;
  leadId?: string;
}

export interface CreateNoteOptions {
  ownerId: string;
  type: string;
  data?: string;
  filePath?: string;
  role?: string;
}

export interface ListNotesOptions {
  ownerId?: string;
  page?: number;
  itemsPerPage?: number;
  schemaName?: string;
  summary?: string;
}

export interface ListActivitiesOptions {
  userId?: string;
  leadId?: string;
  page?: number;
  itemsPerPage?: number;
}

export class CommandHandler {
  private readonly client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  async createActivity(options: CreateActivityOptions) {
    const response = await this.client.post('/api/v1/activity', options);
    this.assertSuccess(response, 'Failed to create activity');
    return response.json();
  }

  async deepping(echo?: string) {
    const params: QueryParams | undefined = echo ? { echo } : undefined;
    const response = await this.client.get('/api/v1/deepping', params);
    console.log('DeepPing response status:', response.status);
    this.assertSuccess(response, 'DeepPing failed');
    return response.json();
  }

  async createNote(options: CreateNoteOptions) {
    const { ownerId, type, data, filePath, role } = options;

    const noteData = await this.loadNoteData({ type, data, filePath });
    const body = {
      owner_id: ownerId,
      type,
      data: noteData,
      role: role ?? 'real_estate',
    };

    const response = await this.client.post('/api/ai/v1/notes', body);
    this.assertSuccess(response, 'Failed to create note');
    return response.json();
  }

  async getNote(ownerId: string, noteId: string) {
    const response = await this.client.get(`/api/ai/v1/notes/${noteId}`, { owner_id: ownerId });
    this.assertSuccess(response, 'Failed to get note');
    return response.json();
  }

  async listNotes(options: ListNotesOptions = {}) {
    const params: QueryParams = {};
    if (options.page !== undefined) params.page = options.page;
    if (options.itemsPerPage !== undefined) params.items_per_page = options.itemsPerPage;
    if (options.ownerId) params.owner_id = options.ownerId;
    if (options.schemaName) params.schema_name = options.schemaName;
    if (options.summary) params.summary = options.summary;

    const response = await this.client.get('/api/ai/v1/notes', params);
    this.assertSuccess(response, 'Failed to list notes');
    return response.json();
  }

  async updateNote(ownerId: string, noteId: string, summary: string) {
    const body = { owner_id: ownerId, summary };
    const response = await this.client.put(`/api/ai/v1/notes/${noteId}`, body);
    this.assertSuccess(response, 'Failed to update note');
    return response.json();
  }

  async deleteNote(noteId: string) {
    const response = await this.client.delete(`/api/ai/v1/notes/${noteId}`);
    this.assertSuccess(response, 'Failed to delete note');
    return response.json();
  }

  async listActivities(options: ListActivitiesOptions = {}) {
    const params: QueryParams = {};
    if (options.page !== undefined) params.page = options.page;
    if (options.itemsPerPage !== undefined) params.items_per_page = options.itemsPerPage;
    if (options.userId) params.user_id = options.userId;
    if (options.leadId) params.lead_id = options.leadId;

    const response = await this.client.get('/api/v1/activity', params);
    this.assertSuccess(response, 'Failed to list activities');
    return response.json();
  }

  private assertSuccess(response: ApiResponse, context: string) {
    if (!response.isSuccess) {
      throw new Error(`${context}: ${response.status} - ${response.body}`);
    }
  }

  private async loadNoteData({
    type,
    data,
    filePath,
  }: {
    type: string;
    data?: string;
    filePath?: string;
  }): Promise<string> {
    if (filePath) {
      if (type.startsWith('text/')) {
        return readFile(filePath, 'utf8');
      }
      const buffer = await readFile(filePath);
      return buffer.toString('base64');
    }

    if (data) {
      return data;
    }

    throw new Error('Either data or filePath must be provided');
  }
}
