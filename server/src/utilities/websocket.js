import * as socket_logic from './socket-logic.js'

const clients = new Map();

export function initWebsocket(wss){
    wss.on('connection', function connection(ws) {
        ws.on('message', function incoming(message) {
            const data = JSON.parse(message);
            socket_logic.initSocket(data, ws, clients);
        });
    
        ws.on('close', function () {
            socket_logic.finishSocket(ws, clients);
        });
    });
}

export function getClients(){
    let clientsFind = []

    clients.forEach(client => {
        clientsFind.push(client.data)
    })

    return clientsFind
}
