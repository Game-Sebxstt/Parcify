import websocket from './websocketClient';
import * as utils from '../frontend/utilities/globals';

export function groupElements(nodesKonva) {
    websocket.send('groupElements', { elements: nodesKonva, generatedId: utils.generateID() });
}

export function ungroupElements(groupKonva) {
    websocket.send('ungroupElements', { groupKonva: [groupKonva] });
}

export function createElementKonva(elementKonva) {
    websocket.send('createElementKonva', { elementKonva });
}

export function deleteElementKonva(elementKonva) {
    websocket.send('deleteElementKonva', { elementKonva });
}

export function moveUpElementKonva(elementKonva) {
    websocket.send('moveUpElementKonva', { elementKonva });
}

export function moveDownElementKonva(elementKonva) {
    websocket.send('moveDownElementKonva', { elementKonva });
}

export function selectElementKonva(elementKonva) {
    websocket.send('selectElementKonva', { elementKonva });
}

export function deselectElementKonva() {
    websocket.send('deselectElementKonva');
}

export function changeElementKonva(data, posRelativePointer) {
    websocket.send('changeElementKonva', { data, posRelativePointer });
}

export function updatePosElementKonva(data) {
    websocket.send('updatePosElementKonva', { data });
}

export function enterCollaborator(collaborator) {
    websocket.send('enterCollaborator', { collaborator });
}

export function updateMouseCursor(position) {
    websocket.send('mouseCursor', { position });
}

export function sendMessageCollaborators(data) {
    websocket.send('message', { data });
}

export function sendTypingCollaborators(user_id) {
    websocket.send('typing', { data: user_id });
}

export function sendStopTypingCollaborators(user_id) {
    websocket.send('stopTyping', { data: user_id });
}