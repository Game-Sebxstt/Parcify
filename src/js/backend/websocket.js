import * as globals from '../frontend/utilities/globals';
import * as chat from '../frontend/utilities/chat'

const socket = new WebSocket('ws://localhost:4000');

socket.onopen = async function(event) {
    socket.send(JSON.stringify({ type: 'clientId', id: globals.getCookie("ID-USER") }));
};

export function updateMouseCursor(position, collaborators) {
    const userId = globals.getCookie("ID-USER");
    socket.send(JSON.stringify({ type: 'mouseCursor', position, collaborators, user_id: userId }));
}

export function sendMessageCollaborators(data, collaborators) {
    const userId = globals.getCookie("ID-USER");
    socket.send(JSON.stringify({ type: 'message', data, collaborators, user_id: userId }));    
}

export function sendTypingCollaborators(user_id) {
    const userId = globals.getCookie("ID-USER");
    socket.send(JSON.stringify({ type: 'typing', data: user_id, user_id: userId }));
}

export function sendStopTypingCollaborators(user_id) {
    const userId = globals.getCookie("ID-USER");
    socket.send(JSON.stringify({ type: 'stopTyping', data: user_id, user_id: userId }));
}

socket.onmessage = function(event) {
    const data = JSON.parse(event.data);

    if (data.type === 'mouseCursor') {
        document.querySelectorAll("#mouseCursor").forEach(cursor => {
            if(cursor.getAttribute("data-id-user") == data.user_id && data.user_id != globals.getCookie("ID-USER")){
                const collaborator = data.collaborators.find(c => c.user_id == data.user_id);
                cursor.style.display = "flex";
                cursor.style.backgroundColor = collaborator.color.hex;
                cursor.style.top = `${data.position.y}px`;
                cursor.style.left = `${data.position.x}px`;
            }
        })
    }

    if (data.type === 'message') {
        if(data.user_id != globals.getCookie("ID-USER")){
            chat.createMessageExternal(data.data)
        }
    }

    if (data.type === 'typing') {
        if(data.user_id != globals.getCookie("ID-USER")){
            chat.createTypingExternal(data.data)
        }
    }

    if (data.type === 'stopTyping') {
        if(data.user_id != globals.getCookie("ID-USER")){
            chat.removeTypingExternal(data.data)
        }
    }
};

socket.onerror = function(error) {
    console.error('WebSocket Error:', error);
};

socket.onclose = function(event) {
    console.log('WebSocket connection closed:', event);
};
