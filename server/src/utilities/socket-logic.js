export function initSocket(data, ws, clients) {
    if (data.type === 'clientId') {
        clients.set(data.id, { ws: ws, data: data });

        const senderId = data.id;
        const clientData = clients.get(senderId);
    
        if (!clientData) return;
    
        clientData.collaborator = data.collaborator;
        clients.set(senderId, clientData);
    
        clients.forEach((client) => {
            client.ws.send(JSON.stringify({
                type: 'enterCollaborator',
                collaborator: data.collaborator,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'groupElements') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            client.ws.send(JSON.stringify({
                type: 'groupElements',
                user_id: senderId,
                elements: data.elements,
                generatedId: data.generatedId,
            }));
        });
    }

    if (data.type === 'createTextInElementKonva') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            client.ws.send(JSON.stringify({
                type: 'createTextInElementKonva',
                user_id: senderId,
                data: data.data
            }))
        })
    }

    if (data.type === 'startEditTextInElementKonva') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'startEditTextInElementKonva',
                user_id: senderId,
                data: data.data
            }))
        })
    }

    if (data.type === 'selectionText') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'selectionText',
                user_id: senderId,
                data: data.data
            }))
        })
    }

    if (data.type === 'ungroupElements') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            client.ws.send(JSON.stringify({
                type: 'ungroupElements',
                user_id: senderId,
                groupKonva: data.groupKonva
            }));
        });
    }

    if (data.type === 'createElementKonva') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.user_id === senderId) return;
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
            if(client.user_id === senderId) return;
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
            if(client.user_id === senderId) return;
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
            if(client.user_id === senderId) return;
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
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'selectElementKonva',
                elementKonva: data.elementKonva,
                collaborator: client.collaborator,
                user_id: senderId
            }));
        });
    }

    if(data.type === "deselectElementKonva"){
        const senderId = data.user_id;
    
        clients.forEach((client) => {
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'deselectElementKonva',
                user_id: senderId
            }));
        });
    }

    if(data.type === "changeElementKonva"){
        const senderId = data.user_id;
    
        clients.forEach((client) => {
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'changeElementKonva',
                data: data,
                posRelativePointer: data.posRelativePointer,
                collaborator: client.collaborator,
                user_id: senderId
            }));
        });
    }

    if(data.type === "updatePosElementKonva"){
        const senderId = data.user_id;
    
        clients.forEach((client) => {
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'updatePosElementKonva',
                data: data,
                collaborator: client.collaborator,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'enterCollaborator') {
        const senderId = data.user_id;
        const clientData = clients.get(senderId);
    
        if (!clientData) return;
    
        clientData.collaborator = data.collaborator;
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
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: data.type,
                position: data.position,
                user_id: senderId,
                collaborators: data.collaborators
            }));
        });
    }

    if (data.type === 'message') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'message',
                data: data,
                user_id: senderId,
                collaborators: data.collaborators
            }));
        });
    }

    if (data.type === 'typing') {
        const senderId = data.user_id;

        clients.forEach((client) => {
        if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'typing',
                data: data,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'stopTyping') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            if(client.user_id === senderId) return;
            client.ws.send(JSON.stringify({
                type: 'stopTyping',
                data: data,
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
                data: client,
            }));
        })
    });
}
