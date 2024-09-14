export function initSocket(data, ws, clients) {
    if (data.type === 'clientId') {
        clients.set(data.id, ws);
        console.log('Identificador de cliente recibido:', data.id);
    }

    if (data.type === 'mouseCursor') {
        const senderId = data.user_id;

        clients.forEach((client, clientId) => {
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

        clients.forEach((client, clientId) => {
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

        clients.forEach((client, clientId) => {
            client.send(JSON.stringify({
                type: 'typing',
                data: data.data,
                user_id: senderId
            }));
        });
    }

    if (data.type === 'stopTyping') {
        const senderId = data.user_id;

        clients.forEach((client, clientId) => {
            client.send(JSON.stringify({
                type: 'stopTyping',
                data: data.data,
                user_id: senderId
            }));
        });
    }
}