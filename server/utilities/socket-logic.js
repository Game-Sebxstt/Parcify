export function initSocket(data, ws, clients) {
    if (data.type === 'clientId') {
        clients.set(data.id, ws);
        console.log('Identificador de cliente recibido:', data.id);
    }

    if (data.type === 'enterCollaborator'){
        const senderId = data.user_id;

        clients.forEach((client) => {
            client.send(JSON.stringify({
                type: 'enterCollaborator',
                collaborator: data.collaborator,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'mouseCursor') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            client.send(JSON.stringify({
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
            client.send(JSON.stringify({
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
            client.send(JSON.stringify({
                type: 'typing',
                data: data.data,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'stopTyping') {
        const senderId = data.user_id;

        clients.forEach((client) => {
            client.send(JSON.stringify({
                type: 'stopTyping',
                data: data.data,
                user_id: senderId
            }));
        });
    }
}

export function finishSocket(ws, clients) {
    clients.forEach((client, clientId) => {
        if (client !== ws) {
            return;
        }

        clients.forEach((clientDifferent) => {
            clientDifferent.send(JSON.stringify({
                type: 'exitCollaborator',
                user_id: clientId
            }));
        })
    });
}
