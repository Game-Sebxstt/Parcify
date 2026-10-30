import { expect, type APIRequestContext } from '@playwright/test';
import { solidPng } from './image.ts';

const API = 'http://localhost:3000';
const ORIGIN = { origin: 'http://localhost:4321' };

// Sube una miniatura de proyecto por la API, como hace el editor al volver al inicio, y la fija en el proyecto.
export async function setProjectPreview(request: APIRequestContext, projectId: string, rgb: [number, number, number] = [36, 67, 85]) {
  const body = solidPng(64, rgb);
  const created = await request.post(`${API}/v1/assets/uploads`, {
    headers: ORIGIN,
    data: { purpose: 'preview', projectId, fileName: 'vista-previa.png', contentType: 'image/png', size: body.length },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { assetId, upload } = (await created.json()) as { assetId: string; upload: { url: string; headers: Record<string, string> } };
  const put = await request.put(new URL(upload.url, API).toString(), { headers: { ...ORIGIN, ...upload.headers }, data: body });
  expect(put.ok(), await put.text()).toBe(true);
  const complete = await request.post(`${API}/v1/assets/uploads/${assetId}/complete`, { headers: ORIGIN });
  expect(complete.ok(), await complete.text()).toBe(true);
  const fixed = await request.post(`${API}/v1/projects/${projectId}/preview`, { headers: ORIGIN, data: { assetId } });
  expect(fixed.ok(), await fixed.text()).toBe(true);
}
