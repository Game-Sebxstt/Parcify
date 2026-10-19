import { expect, type APIRequestContext } from '@playwright/test';

const API = 'http://localhost:3000';
const ORIGIN = { origin: 'http://localhost:4321' };

// Atajos para preparar datos por la API. Para unir personas se usan invitaciones reales (invite.ts).
export async function setProjectMember(request: APIRequestContext, projectId: string, userId: string, role: 'admin' | 'editor' | 'viewer') {
  const response = await request.put(`${API}/v1/projects/${projectId}/members/${userId}`, { headers: ORIGIN, data: { role } });
  expect(response.ok(), await response.text()).toBe(true);
}

export async function setOrgAccess(request: APIRequestContext, projectId: string, orgAccess: 'none' | 'viewer' | 'editor') {
  const response = await request.patch(`${API}/v1/projects/${projectId}`, { headers: ORIGIN, data: { orgAccess } });
  expect(response.ok(), await response.text()).toBe(true);
}
