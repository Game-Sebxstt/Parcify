import type { z } from 'zod';
import { ProjectMemberSchema, ProjectMembersResponseSchema } from '../shared/api/projects.js';
import {
  CreatedShareLinkSchema,
  ProjectInvitationResponseSchema,
  ShareLinkAcceptResponseSchema,
  ShareLinkInspectSchema,
  ShareLinkListResponseSchema,
  type ShareLink,
} from '../shared/api/share-links.js';
import {
  AcceptInvitationResponseSchema,
  ReceivedInvitationSchema,
  WorkspaceInvitationListResponseSchema,
  WorkspaceInvitationSchema,
} from '../shared/api/workspaces.js';
import type { ProjectRole } from '../shared/permissions.js';
import { apiFetch } from './api.ts';

export type ProjectMember = z.infer<typeof ProjectMemberSchema>;
export type ShareLinkRole = ShareLink['role'];
export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;
export type WorkspaceInviteRole = WorkspaceInvitation['role'];
export type ReceivedInvitation = z.infer<typeof ReceivedInvitationSchema>;
export type ShareLinkInspect = z.infer<typeof ShareLinkInspectSchema>;
export type { ShareLink };

const project = (id: string) => `/v1/projects/${encodeURIComponent(id)}`;
const workspace = (slug: string) => `/v1/workspaces/${encodeURIComponent(slug)}`;
const received = (id: string) => `/v1/workspace-invitations/${encodeURIComponent(id)}`;

export function listProjectMembers(projectId: string) {
  return apiFetch(`${project(projectId)}/members`, { schema: ProjectMembersResponseSchema });
}

export function setProjectMemberRole(projectId: string, userId: string, role: ProjectRole) {
  return apiFetch(`${project(projectId)}/members/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: { role },
    schema: ProjectMemberSchema,
  });
}

export function removeProjectMember(projectId: string, userId: string) {
  return apiFetch(`${project(projectId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export function inviteToProject(projectId: string, email: string, role: ShareLinkRole) {
  return apiFetch(`${project(projectId)}/invitations`, {
    method: 'POST',
    body: { email, role },
    schema: ProjectInvitationResponseSchema,
  });
}

export function listShareLinks(projectId: string) {
  return apiFetch(`${project(projectId)}/share-links`, { schema: ShareLinkListResponseSchema });
}

export function createShareLink(projectId: string, input: { role: ShareLinkRole; expiresInDays: number; maxUses?: number }) {
  return apiFetch(`${project(projectId)}/share-links`, { method: 'POST', body: input, schema: CreatedShareLinkSchema });
}

export function revokeShareLink(projectId: string, linkId: string) {
  return apiFetch(`${project(projectId)}/share-links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });
}

// En /invitacion un 401 no redirige: la página abre el overlay de acceso por su cuenta.
export function inspectShareLink(token: string) {
  return apiFetch('/v1/share-links/inspect', {
    method: 'POST',
    body: { token },
    schema: ShareLinkInspectSchema,
    redirectOn401: false,
  });
}

export function acceptShareLink(token: string) {
  return apiFetch('/v1/share-links/accept', {
    method: 'POST',
    body: { token },
    schema: ShareLinkAcceptResponseSchema,
    redirectOn401: false,
  });
}

export function listWorkspaceInvitations(slug: string) {
  return apiFetch(`${workspace(slug)}/invitations`, { schema: WorkspaceInvitationListResponseSchema });
}

export function createWorkspaceInvitation(slug: string, email: string, role: WorkspaceInviteRole) {
  return apiFetch(`${workspace(slug)}/invitations`, {
    method: 'POST',
    body: { email, role },
    schema: WorkspaceInvitationSchema,
  });
}

export function cancelWorkspaceInvitation(slug: string, invitationId: string) {
  return apiFetch(`${workspace(slug)}/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' });
}

export function getReceivedInvitation(invitationId: string) {
  return apiFetch(received(invitationId), { schema: ReceivedInvitationSchema, redirectOn401: false });
}

export function acceptReceivedInvitation(invitationId: string) {
  return apiFetch(`${received(invitationId)}/accept`, {
    method: 'POST',
    schema: AcceptInvitationResponseSchema,
    redirectOn401: false,
  });
}

export function rejectReceivedInvitation(invitationId: string) {
  return apiFetch(`${received(invitationId)}/reject`, { method: 'POST', redirectOn401: false });
}
