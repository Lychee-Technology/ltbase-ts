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
  models: unknown[];
}

export interface ListObjectsOptions {
  page?: number;
  itemsPerPage?: number;
}


export interface ListNotesOptions extends ListObjectsOptions {
  ownerId?: string;
  schemaName?: string;
  summary?: string;
}

export interface ListActivitiesOptions extends ListObjectsOptions {
  userId?: string;
  leadId?: string;
}

export interface ListLeadsOptions extends ListObjectsOptions {
  leadId?: string;
  orderBy?: string;
}

export interface UpdateLeadOptions {
  leadId: string;
  filePath: string;
}

export interface CreateLeadOptions {
  id?: string;
  tenantId: string;
  ownerUserId: string;
  pipeline: 'buy' | 'rent' | 'sell' | 'landlord';
  stage?: 'new' | 'contacted' | 'need_defined' | 'viewing' | 'offer' | 'contract' | 'closed';
  status?: 'open' | 'won' | 'lost' | 'junk';
  temperature?: 'Hot' | 'Warm' | 'New' | 'Qualified';
  name: string;
  email?: string;
  phone?: string;
  sourceChannel?: 'portal' | 'walk_in' | 'referral' | 'phone' | 'web_form' | 'event' | 'other';
  sourceName?: string;
  tags?: string[];
  filePath?: string;
}

export interface CreateVisitOptions {
  id?: string;
  leadId: string;
  userId: string;
  propertyId: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  status?: 'scheduled' | 'visited' | 'no_show' | 'canceled' | 'rescheduled';
  feedback?: string;
  attendees?: string[];
  nextFollowUpAt?: string;
  filePath?: string;
}

export interface ListVisitsOptions extends ListObjectsOptions {
  leadId?: string;
  userId?: string;
  propertyId?: string;
}

export interface ListLogsOptions extends ListObjectsOptions {
  logId?: string;
  leadId?: string;
  visitId?: string;
  ownerId?: string;
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
      models: options.models,
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
    if (options.schemaName) params.schema_name = options.schemaName;
    if (options.summary) params.summary = options.summary;
    params.owner_id = options.ownerId;

    const response = await this.client.get('/api/ai/v1/notes', params);
    this.assertSuccess(response, 'Failed to list notes');
    return response.json();
  }

  async listLeads(options: ListLeadsOptions = {}) {
    const params: QueryParams = {};
    if (options.page !== undefined) params.page = options.page;
    if (options.itemsPerPage !== undefined) params.items_per_page = options.itemsPerPage;
    if (options.orderBy) params.order_by = options.orderBy;
    if (options.leadId) params.id = `equals:${options.leadId}`;

    const response = await this.client.get('/api/v1/lead', params);
    this.assertSuccess(response, 'Failed to list lead');
    return response.json();
  }

  async getLead(leadId: string) {
    const response = await this.client.get(`/api/v1/lead?id=${leadId}`);
    this.assertSuccess(response, 'Failed to get lead');
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
    if (options.userId) params.userId = options.userId;
    if (options.leadId) params.leadId = options.leadId;

    const response = await this.client.get('/api/v1/activity', params);
    this.assertSuccess(response, 'Failed to list activities');
    return response.json();
  }

  async createLead(options: CreateLeadOptions) {
    const now = new Date().toISOString();

    // If filePath is provided, read and use that as base
    let payload: Record<string, unknown>;
    if (options.filePath) {
      const fileContent = await readFile(options.filePath, 'utf8').catch((err) => {
        throw new Error(`Failed to read JSON file "${options.filePath}": ${(err as Error).message}`);
      });
      try {
        payload = JSON.parse(fileContent) as Record<string, unknown>;
      } catch (err) {
        throw new Error(`Invalid JSON in file "${options.filePath}": ${(err as Error).message}`);
      }
    } else {
      payload = {};
    }

    // Auto-generate and fill required fields
    const { randomUUID } = await import('node:crypto');

    payload.id = options.id ?? payload.id ?? randomUUID();
    payload.tenantId = options.tenantId ?? payload.tenantId;
    payload.ownerUserId = options.ownerUserId ?? payload.ownerUserId;
    payload.pipeline = options.pipeline ?? payload.pipeline;
    payload.stage = options.stage ?? payload.stage ?? 'new';
    payload.status = options.status ?? payload.status ?? 'open';
    payload.temperature = options.temperature ?? payload.temperature ?? 'New';
    payload.createdAt = payload.createdAt ?? now;
    payload.updatedAt = now;
    payload.firstTouchAt = payload.firstTouchAt ?? now;

    // Build contact object
    const existingContact = (payload.contact as Record<string, unknown>) ?? {};
    payload.contact = {
      ...existingContact,
      name: options.name ?? existingContact.name,
      ...(options.email && { email: options.email }),
      ...(options.phone && { primaryPhone: options.phone, phones: [options.phone] }),
    };

    // Build source object if channel provided
    if (options.sourceChannel) {
      const existingSource = (payload.source as Record<string, unknown>) ?? {};
      payload.source = {
        ...existingSource,
        channel: options.sourceChannel,
        ...(options.sourceName && { name: options.sourceName }),
      };
    }

    // Add tags if provided
    if (options.tags && options.tags.length > 0) {
      payload.tags = options.tags;
    }

    const response = await this.client.post('/api/v1/lead', payload);
    this.assertSuccess(response, 'Failed to create lead');
    return response.json();
  }

  async listVisits(options: ListVisitsOptions = {}) {
    const params: QueryParams = {};
    if (options.page !== undefined) params.page = options.page;
    if (options.itemsPerPage !== undefined) params.items_per_page = options.itemsPerPage;
    if (options.leadId) params.leadId = options.leadId;
    if (options.userId) params.userId = options.userId;
    if (options.propertyId) params.property_id = options.propertyId;

    const response = await this.client.get('/api/v1/visit', params);
    this.assertSuccess(response, 'Failed to list visits');
    return response.json();
  }

  async listLogs(options: ListLogsOptions = {}) {
    const params: QueryParams = {};
    if (options.page !== undefined) params.page = options.page;
    if (options.itemsPerPage !== undefined) params.items_per_page = options.itemsPerPage;
    if (options.logId) params.id = options.logId;
    if (options.leadId) params.leadId = options.leadId;
    if (options.visitId) params.visitId = options.visitId;
    if (options.ownerId) params.ownerId = options.ownerId;
    
    params.order_by = 'updatedAt:desc';

    const response = await this.client.get('/api/v1/log', params);
    this.assertSuccess(response, 'Failed to list logs');
    return response.json();
  }

  async createVisit(options: CreateVisitOptions) {
    const now = new Date().toISOString();

    // If filePath is provided, read and use that as base
    let payload: Record<string, unknown>;
    if (options.filePath) {
      const fileContent = await readFile(options.filePath, 'utf8').catch((err) => {
        throw new Error(`Failed to read JSON file "${options.filePath}": ${(err as Error).message}`);
      });
      try {
        payload = JSON.parse(fileContent) as Record<string, unknown>;
      } catch (err) {
        throw new Error(`Invalid JSON in file "${options.filePath}": ${(err as Error).message}`);
      }
    } else {
      payload = {};
    }

    // Auto-generate and fill required fields
    const { randomUUID } = await import('node:crypto');

    payload.id = options.id ?? payload.id ?? randomUUID();
    payload.leadId = options.leadId ?? payload.leadId;
    payload.userId = options.userId ?? payload.userId;
    payload.propertyId = options.propertyId ?? payload.propertyId;
    payload.scheduledStartAt = options.scheduledStartAt ?? payload.scheduledStartAt ?? now;
    payload.status = options.status ?? payload.status ?? 'scheduled';
    payload.createdAt = payload.createdAt ?? now;
    payload.updatedAt = now;

    // Optional fields
    if (options.scheduledEndAt) {
      payload.scheduledEndAt = options.scheduledEndAt;
    }
    if (options.feedback) {
      payload.feedback = options.feedback;
    }
    if (options.attendees && options.attendees.length > 0) {
      payload.attendees = options.attendees;
    }
    if (options.nextFollowUpAt) {
      payload.nextFollowUpAt = options.nextFollowUpAt;
    }

    const response = await this.client.post('/api/v1/visit', payload);
    this.assertSuccess(response, 'Failed to create visit');
    return response.json();
  }

  async deleteVisit(rowId: string) {
    const response = await this.client.delete(`/api/v1/visit/${rowId}`);
    this.assertSuccess(response, 'Failed to delete visit');
    return response.json();
  }

  async updateLead(options: UpdateLeadOptions) {
    const { leadId, filePath } = options;

    const fileContent = await readFile(filePath, 'utf8').catch((err) => {
      throw new Error(`Failed to read JSON file "${filePath}": ${(err as Error).message}`);
    });

    let payload: unknown;
    try {
      payload = JSON.parse(fileContent);
    } catch (err) {
      throw new Error(`Invalid JSON in file "${filePath}": ${(err as Error).message}`);
    }

    const response = await this.client.put(`/api/v1/lead/${leadId}`, payload);
    this.assertSuccess(response, 'Failed to update lead');
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
