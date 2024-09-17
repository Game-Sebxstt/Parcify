import * as websocket from './websocket.js'

export function initSocket(data, ws, clients) {
    if (data.type === 'clientId') {
        clients.set(data.data.id, { ws: ws, data: data.data });
        console.log('Identificador de cliente recibido:', data.data);
    }
    
    if (data.type === 'createElementKonva') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'createElementKonva',
                elementKonva: data.elementKonva,
                user_id: senderId
            }));
        });
    }

    if(data.type === 'deleteElementKonva'){
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'deleteElementKonva',
                elementKonva: data.elementKonva,
                user_id: senderId
            }));
        });
    }

    if(data.type === 'moveUpElementKonva'){
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'moveUpElementKonva',
                elementKonva: data.elementKonva,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'moveDownElementKonva') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'moveDownElementKonva',
                elementKonva: data.elementKonva,
                user_id: senderId
            }));
        });
    }

    if(data.type === "selectElementKonva"){
        const senderId = data.user_id;
    
        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'selectElementKonva',
                elementKonva: data.elementKonva,
                collaborator: client.data.collaborator,
                user_id: senderId
            }));
        });
    }

    if(data.type === "deselectElementKonva"){
        const senderId = data.user_id;
    
        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'deselectElementKonva',
                user_id: senderId
            }));
        });
    }

    if(data.type === "changeElementKonva"){
        const senderId = data.user_id;
    
        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'changeElementKonva',
                updatedAttrs: data.updatedAttrs,
                posRelativePointer: data.posRelativePointer,
                collaborator: client.data.collaborator,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'enterCollaborator') {
        const senderId = data.user_id;
    
        const clientData = clients.get(senderId);
    
        if (!clientData) return;
    
        clientData.data.collaborator = data.collaborator;
        clients.set(senderId, clientData);
    
        clients.forEach((client) => {
            client.ws.send(JSON.stringify({
                type: 'enterCollaborator',
                collaborator: data.collaborator,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'mouseCursor') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'mouseCursor',
                position: data.position,
                user_id: senderId,
                collaborators: data.collaborators
            }));
        });
    }

    if (data.type === 'message') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'message',
                data: data.data,
                user_id: senderId,
                collaborators: data.collaborators
            }));
        });
    }

    if (data.type === 'typing') {
        const senderId = data.user_id;

        clients.forEach((client) => {
        if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'typing',
                data: data.data,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'stopTyping') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.data.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'stopTyping',
                data: data.data,
                user_id: senderId
            }));
        });
    }
}

export function finishSocket(ws, clients) {
    clients.forEach((client) => {
        if (client.ws !== ws) {
            return;
        }

        clients.forEach((clientDifferent) => {
            clientDifferent.ws.send(JSON.stringify({
                type: 'exitCollaborator',
                data: client.data,
            }));
        })
    });
}
