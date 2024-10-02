import * as utils from '../globals/environment-utils';
import { send } from './index'

export function groupElements(nodesKonva) {
    send('groupElements', { elements: nodesKonva, generatedId: utils.generateID() });
}

export function ungroupElements(groupKonva) {
    send('ungroupElements', { groupKonva: [groupKonva] });
}

export function createElementKonva(elementKonva) {
    send('createElementKonva', { elementKonva });
}

export function deleteElementKonva(elementKonva) {
    send('deleteElementKonva', { elementKonva });
}

export function moveUpElementKonva(elementKonva) {
    send('moveUpElementKonva', { elementKonva });
}

export function moveDownElementKonva(elementKonva) {
    send('moveDownElementKonva', { elementKonva });
}

export function selectElementKonva(elementKonva) {
    send('selectElementKonva', { elementKonva });
}

export function deselectElementKonva() {
    send('deselectElementKonva');
}

export function changeElementKonva(data, posRelativePointer) {
    send('changeElementKonva', { data, posRelativePointer });
}

export function updatePosElementKonva(data) {
    send('updatePosElementKonva', { data });
}

export function enterCollaborator(collaborator) {
    send('enterCollaborator', { collaborator });
}

export function updateMouseCursor(position) {
    send('mouseCursor', { position });
}

export function sendMessageCollaborators(data) {
    send('message', { data });
}

export function createTextInElementKonva(data) {
    send('createTextInElementKonva', { data });
}

export function startEditTextInElementKonva(data) {
    send('startEditTextInElementKonva', { data });
}

export function createHighlightText(data) {
    send('createHighlightText', { data });
}

export function removeHighlightText(data) {
    send('removeHighlightText', { data });
}

export function sendTypingCollaborators(user_id) {
    send('typing', { data: user_id });
}

export function sendStopTypingCollaborators(user_id) {
    send('stopTyping', { data: user_id });
}