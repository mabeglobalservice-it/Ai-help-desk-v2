import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

// docs/11 §1 : toutes les routes sont prefixees par /api/v1. Centralise le
// prefixe ici plutot que de le repeter dans chaque appel supertest des
// specs e2e.
const API_PREFIX = '/api/v1';

export function apiRequest(app: INestApplication<App>) {
  const server = app.getHttpServer();
  return {
    get: (path: string) => request(server).get(`${API_PREFIX}${path}`),
    post: (path: string) => request(server).post(`${API_PREFIX}${path}`),
    patch: (path: string) => request(server).patch(`${API_PREFIX}${path}`),
    delete: (path: string) => request(server).delete(`${API_PREFIX}${path}`),
  };
}
