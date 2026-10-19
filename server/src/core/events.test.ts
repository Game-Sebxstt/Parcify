import { describe, expect, it, vi } from 'vitest';
import { EVENT_PATTERNS, orgChannel, parseEvent, projectChannel, publishOrgEvent, publishProjectEvent } from './events.js';

describe('events', () => {
  it('publica en los canales de proyecto y espacio', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    await publishProjectEvent({ publish } as never, 'p1', { type: 'project.deleted' });
    await publishOrgEvent({ publish } as never, 'o1', { type: 'access.changed', userId: 'u1' });
    expect(publish).toHaveBeenNthCalledWith(1, 'parcify:evt:project:p1', '{"type":"project.deleted"}');
    expect(publish).toHaveBeenNthCalledWith(2, 'parcify:evt:org:o1', '{"type":"access.changed","userId":"u1"}');
    expect(EVENT_PATTERNS).toEqual(['parcify:evt:project:*', 'parcify:evt:org:*']);
  });

  it('rechaza publicar un evento mal formado', async () => {
    const publish = vi.fn();
    await expect(publishProjectEvent({ publish } as never, 'p1', { type: 'asset.ready', assetId: 'x' })).rejects.toThrow();
    expect(publish).not.toHaveBeenCalled();
  });

  it('interpreta los mensajes recibidos y descarta los inválidos', () => {
    expect(parseEvent(projectChannel('p1'), '{"type":"doc.readonly","reason":"size"}')).toEqual({
      scope: 'project',
      projectId: 'p1',
      event: { type: 'doc.readonly', reason: 'size' },
    });
    expect(parseEvent(orgChannel('o1'), '{"type":"workspace.deleted"}')).toEqual({
      scope: 'org',
      organizationId: 'o1',
      event: { type: 'workspace.deleted' },
    });
    expect(parseEvent(orgChannel('o1'), '{"type":"project.deleted"}')).toBeNull();
    expect(parseEvent(projectChannel('p1'), 'no es json')).toBeNull();
    expect(parseEvent('otro:canal', '{"type":"project.deleted"}')).toBeNull();
  });
});
