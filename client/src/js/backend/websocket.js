import * as globals from '../frontend/utilities/globals';
import * as GlobalFunctions from '../../konva/js/GlobalFunctions';
import * as Render from '../../konva/js/Render';
import * as chat from '../frontend/utilities/chat';
import * as environments from '../../../../config';

let socket = null;
let isReconnecting = false;

function createWebSocket() {
    socket = new WebSocket(environments.DEFAULT_SOCKET_URL);

    socket.onopen = function(event) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'clientId', id: globals.getCookie("ID-USER") }));
        }
    };

    socket.onmessage = function(event) {
        const data = JSON.parse(event.data);

        if (data.type === 'enterCollaborator') {
            if(data.user_id == globals.getCookie("ID-USER")) return;
            GlobalFunctions.createCursorCollaborator(data.collaborator);
        }

        if (data.type === 'exitCollaborator'){
            GlobalFunctions.removeCursorCollaborator(data.user_id);
        }

        if (data.type === 'mouseCursor') {
            if(data.user_id == globals.getCookie("ID-USER")) return;
            GlobalFunctions.updateCursorCollaborator(data.position, data.user_id);
        }

        if (data.type === 'message') {
            if (data.user_id != globals.getCookie("ID-USER")) {
                chat.createMessageExternal(data.data);
            }
        }

        if (data.type === 'typing') {
            if (data.user_id != globals.getCookie("ID-USER")) {
                chat.createTypingExternal(data.data);
            }
        }

        if (data.type === 'stopTyping') {
            if (data.user_id != globals.getCookie("ID-USER")) {
                chat.removeTypingExternal(data.data);
            }
        }
    };

    socket.onerror = function(error) {
        console.error('WebSocket Error:', error);
    };

    socket.onclose = function(event) {
        console.log('WebSocket connection closed:', event);
        if (event.code !== 1000 && !isReconnecting) {
            isReconnecting = true;
            setTimeout(() => {
                createWebSocket();
                isReconnecting = false;
            }, 5000);
        }
    };
}

function sendIfOpen(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(message);
    } else {
        console.warn('WebSocket is not open. Message not sent:', message);
    }
}

export function enterCollaborator(collaborator){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'enterCollaborator', collaborator, user_id: userId }));
}

export function updateMouseCursor(position, collaborators) {
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'mouseCursor', position, collaborators, user_id: userId }));
}

export function sendMessageCollaborators(data, collaborators) {
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'message', data, collaborators, user_id: userId }));
}

export function sendTypingCollaborators(user_id) {
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'typing', data: user_id, user_id: userId }));
}

export function sendStopTypingCollaborators(user_id) {
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'stopTyping', data: user_id, user_id: userId }));
}

// Initialize WebSocket connection
createWebSocket();
