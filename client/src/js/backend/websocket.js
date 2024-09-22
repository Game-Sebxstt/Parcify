import Konva from 'konva';
import * as req from '../backend/requests'
import * as globals from '../frontend/utilities/globals';
import * as GlobalFunctions from '../../konva/js/GlobalFunctions';
import * as Render from '../../konva/js/Render';
import * as chat from '../frontend/utilities/chat';
import * as config from '../../config.ts';
import * as environments_utils from '../globals/environment-utils';
import * as konva from '../../konva/js/KonvaLogic'

let socket = null;
let isReconnecting = false;
let collaborator = null;

function createWebSocket() {
    socket = new WebSocket(config.getSocketUrl());

    socket.onopen = function(event) {
        if (socket.readyState === WebSocket.OPEN) {
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            const collaborator = environments_utils.getCollaboratorOfProject(id, globals.getCookie("ID-USER"));
            socket.send(JSON.stringify({ type: 'clientId', data: {id: globals.getCookie("ID-USER"), collaborator: collaborator} }));
        }
    };

    socket.onmessage = async function(event) {
        const data = JSON.parse(event.data);

        if (data.type === "groupElements"){
            const stringifyElements = data.elements
            const nodesList = []

            stringifyElements.forEach(item => {
                const element = JSON.parse(item);
                const elementInKonva = konva.stage.children.find(child => child.attrs.id == "layer").children.find(child => child.attrs.id_unique == element.attrs.id_unique);
                nodesList.push(elementInKonva);
            })

            konva.groupElements(nodesList, data.generatedId, data.user_id);
        }

        if (data.type === "ungroupElements"){
            if(!data.groupKonva) return;
            const groupKonva = JSON.parse(data.groupKonva[0]);
            konva.ungroupElements(groupKonva);
        }

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
            if (data.user_id != globals.getCookie("ID-USER")) {
                const elementKonva = JSON.parse(data.elementKonva);
                const layerKonva = konva.stage.children.find(item => item.id() === "layer");
            
                let elementKonvaOfLayer = GlobalFunctions.findElementByIdUnique(layerKonva, elementKonva.attrs.id_unique);

                if(elementKonvaOfLayer instanceof Konva.Group){
                    const boxGroup = elementKonvaOfLayer.children.find(item => item.attrs.id === "boxGroup");

                    if(boxGroup){
                        elementKonvaOfLayer = boxGroup;
                    }
                }

                if (elementKonvaOfLayer) {
                    GlobalFunctions.setBorderElement(elementKonvaOfLayer, data.collaborator);
                }
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

            const collaboratorFind = environments_utils.getCollaboratorOfProject(data.collaborator.project_id, data.user_id);

            if(!collaboratorFind){
                await req.saveCollaborators(data.collaborator.project_id, data_change)
            }
            
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

            const collaboratorFind = environments_utils.getCollaboratorOfProject(data.data.collaborator.project_id, data.user_id);

            if(!collaboratorFind){
                await req.saveCollaborators(data.data.collaborator.project_id, data_change)
            }
            
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
    };
}

function sendIfOpen(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(message);
    } else {
        console.warn('WebSocket is not open. Message not sent:', message);
    }
}

export function groupElements(nodesKonva){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'groupElements', elements: nodesKonva, generatedId: globals.generateID(), user_id: userId }));
}

export function ungroupElements(groupKonva) {
    console.log('groupKonva:', groupKonva);
    if (!Array.isArray(groupKonva)) {
        groupKonva = [groupKonva];
    }

    if (groupKonva.length < 1) {
        console.error("No group elements provided for ungrouping");
        return;
    }

    let group = groupKonva[0];

    if (!(group instanceof Konva.Group)) {
        group = group.parent instanceof Konva.Group ? group.parent : group;
    }

    if (!(group instanceof Konva.Group)) {
        console.error("Invalid group for ungrouping");
        return;
    }

    group.setAttrs({
        posCustom: group.position(),
        scaleCustom: {x: group.scaleX(), y: group.scaleY()},
        rotationCustom: group.rotation(),
    });

    if (!group.children || group.children.length === 0) {
        console.warn("Group has no children to ungroup");
        return;
    }

    group.children.forEach(item => {
        item.setAttrs({
            rotationCustom: item.rotation(),
            scaleCustom: {x: item.scaleX(), y: item.scaleY()},
        });
    });

    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'ungroupElements', groupKonva: [group], user_id: userId }));
}

export function createElementKonva(elementKonva){
    const userId = globals.getCookie("ID-USER");
    sendIfOpen(JSON.stringify({ type: 'createElementKonva', elementKonva, user_id: userId }));
}

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
    collaborator = collaborator;
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
