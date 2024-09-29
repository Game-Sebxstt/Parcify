import WebSocketClient from './websocketClient';
import * as actions from './actions';
import * as eventHandlers from './eventHandlers';

const websocket = new WebSocketClient();

// Registrar todos los manejadores de eventos
Object.entries(eventHandlers).forEach(([eventType, handler]) => {
    websocket.on(eventType, handler);
});

export { websocket as default, actions };