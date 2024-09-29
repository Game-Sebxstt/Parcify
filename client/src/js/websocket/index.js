import * as globals from '../frontend/utilities/globals';
import * as config from '../../config';
import * as utils from '../globals/environment-utils';
import * as eventHandlers from './eventHandlers';

let socket = null;
const eventHandlersMap = new Map();
const messageQueue = [];

export function initSocket() {
    return new Promise((resolve, reject) => {
        socket = new WebSocket(config.getSocketUrl());

        socket.onopen = (event) => {
            console.log('WebSocket connection opened');
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            const collaborator = utils.getCollaboratorOfProject(id, globals.getCookie("ID-USER"));
            send('clientId', { id: globals.getCookie("ID-USER"), collaborator: collaborator });

            while (messageQueue.length > 0) {
                const message = messageQueue.shift();
                if (message) {
                    send(message.type, message.data);
                }
            }

            resolve();
        };

        socket.onmessage = handleMessage;
        socket.onerror = (error) => {
            console.error('WebSocket Error:', error);
            reject(error);
        };
        socket.onclose = (event) => {
            console.log('WebSocket connection closed:', event);
            setTimeout(() => initSocket().then(setupEventHandlers), 5000);
        };
    });
}

function handleMessage(event) {
    const data = JSON.parse(event.data);
    const handler = eventHandlersMap.get(data.type);
    if (handler) {
        handler(data);
    } else {
        console.warn(`No handler for message type: ${data.type}`);
    }
}

export function send(type, data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, ...data, user_id: globals.getCookie("ID-USER") }));
    } else {
        console.warn('WebSocket is not open. Queueing message:', { type, data });
        messageQueue.push({ type, data });
    }
}

export function on(eventType, handler) {
    eventHandlersMap.set(eventType, handler);
}

export function getEventHandlers() {
    return eventHandlersMap;
}

function setupEventHandlers() {
    Object.entries(eventHandlers).forEach(([eventType, handler]) => {
        on(eventType, handler);
    });
}

initSocket()
    .then(setupEventHandlers)
    .catch(error => console.error('Failed to initialize WebSocket:', error));