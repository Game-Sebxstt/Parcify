import * as req from '../backend/requests'
import * as globals from '../frontend/utilities/globals';
import * as GlobalFunctions from '../../konva/js/GlobalFunctions';
import * as Render from '../../konva/js/Render';
import * as chat from '../frontend/utilities/chat';
import * as environments from '../../../../config';
import * as konva from '../../konva/js/KonvaLogic'

let socket = null;
let isReconnecting = false;

function createWebSocket() {
    socket = new WebSocket(environments.DEFAULT_SOCKET_URL);

    socket.onopen = function(event) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'clientId', data: {id: globals.getCookie("ID-USER")} }));
        }
    };

    socket.onmessage = async function(event) {
        const data = JSON.parse(event.data);

        if (data.type === 'createElementKonva') {
            if(data.user_id != globals.getCookie("ID-USER")){
                const elementKonva = JSON.parse(data.elementKonva);
                GlobalFunctions.createElementKonva(elementKonva);
            }
        }

        if (data.type === 'deleteElementKonva') {
            if(data.user_id != globals.getCookie("ID-USER")){
                const elementKonva = JSON.parse(data.elementKonva);
                GlobalFunctions.deleteElementKonva(elementKonva);
            }
        }

        if (data.type === 'moveUpElementKonva') {
            if(data.user_id != globals.getCookie("ID-USER")){
                const elementKonva = JSON.parse(data.elementKonva);
                GlobalFunctions.moveUpElementKonva(elementKonva);
            }
        }

        if (data.type === 'moveDownElementKonva') {
            if(data.user_id != globals.getCookie("ID-USER")){
                const elementKonva = JSON.parse(data.elementKonva);
                GlobalFunctions.moveDownElementKonva(elementKonva);
            }
        }

        if (data.type === 'selectElementKonva') {
            if(data.user_id != globals.getCookie("ID-USER")){
                const elementKonva = JSON.parse(data.elementKonva);
                const layerKonva = konva.stage.children.find(item => item.id() === "layer");
                const elementKonvaOfLayer = layerKonva.children.find(item => item.attrs.id_unique === elementKonva.attrs.id_unique);
                GlobalFunctions.setBorderElement(elementKonvaOfLayer, data.collaborator)
            }
        }

        if(data.type === 'deselectElementKonva'){
            if(data.user_id != globals.getCookie("ID-USER")){
                GlobalFunctions.removeBorderElement()
            }
        }

        if (data.type === 'changeElementKonva') {
            if(data.user_id != globals.getCookie("ID-USER")){
                const layerKonva = konva.stage.children.find(item => item.id() === "layer");
                const elementKonvaOfLayer = layerKonva.children.find(item => item.attrs.id_unique === data.updatedAttrs.id_unique);
                GlobalFunctions.changeElement(elementKonvaOfLayer, data.updatedAttrs, data.user_id, data.posRelativePointer, data.collaborator);
            }
        }

        if (data.type === 'enterCollaborator') {
            const data_change = {
                user_id: data.user_id,
                state: true,
            }

            await req.saveCollaborators(data.collaborator.project_id, data_change)
            
            const project_collaborators = JSON.parse((await req.getProject(data.collaborator.project_id)).data.message.collaborators);
            project_collaborators.forEach(item => {
                if(!item.state) return;

                Render.updateCollaborators(item)
            })

            if(data.user_id != globals.getCookie("ID-USER")){
                GlobalFunctions.createCursorCollaborator(data.collaborator);
            }
        }

        if (data.type === 'exitCollaborator'){
            if(!data.data || !data.data.collaborator || !data.data.collaborator.project_id) {
                console.error('Collaborator data is missing:', data);
                return;
            }

            const data_change = {
                user_id: data.data.id,
                state: false,
            }

            await req.saveCollaborators(data.data.collaborator.project_id, data_change)
            
            const project_collaborators = JSON.parse((await req.getProject(data.data.collaborator.project_id)).data.message.collaborators);
            project_collaborators.forEach(item => {
                if(item.state) return;

                Render.removeCollaborator(item)
            })

            GlobalFunctions.removeCursorCollaborator(data.data.id);
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

export function createElementKonva(elementKonva){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'createElementKonva', elementKonva, user_id: userId }));
}

//Añadir nueva tabla en user con collaborators_project donde estan los id de los proyectos que esta colaborando el usuario

export function deleteElementKonva(elementKonva){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'deleteElementKonva', elementKonva, user_id: userId }));
}

export function moveUpElementKonva(elementKonva){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'moveUpElementKonva', elementKonva, user_id: userId }));
}

export function moveDownElementKonva(elementKonva){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'moveDownElementKonva', elementKonva, user_id: userId }));
}

export function changeElementKonva(updatedAttrs, posRelativePointer){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'changeElementKonva', updatedAttrs, posRelativePointer, user_id: userId }));
}

export function selectElementKonva(elementKonva){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'selectElementKonva', elementKonva, user_id: userId }));
}

export function deselectElementKonva(){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'deselectElementKonva', user_id: userId }));
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
