import config from '../../config';
import * as utils from '../frontend/utilities/globals';

class WebSocketClient {
    constructor() {
        this.socket = null;
        this.eventHandlers = new Map();
        this.initSocket();
    }

    initSocket() {
        this.socket = new WebSocket(config.getSocketUrl());
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.socket.onopen = this.handleOpen.bind(this);
        this.socket.onmessage = this.handleMessage.bind(this);
        this.socket.onerror = this.handleError.bind(this);
        this.socket.onclose = this.handleClose.bind(this);
    }

    handleOpen(event) {
        if (this.socket.readyState === WebSocket.OPEN) {
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            const collaborator = utils.getCollaboratorOfProject(id, utils.getCookie("ID-USER"));
            this.send('clientId', {id: utils.getCookie("ID-USER"), collaborator: collaborator});
        }
    }

    handleMessage(event) {
        const data = JSON.parse(event.data);
        const handler = this.eventHandlers.get(data.type);
        if (handler) {
            handler(data);
        } else {
            console.warn(`No handler for message type: ${data.type}`);
        }
    }

    handleError(error) {
        console.error('WebSocket Error:', error);
    }

    handleClose(event) {
        console.log('WebSocket connection closed:', event);
        // Implement reconnection logic here if needed
    }

    send(type, data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type, ...data, user_id: utils.getCookie("ID-USER") }));
        } else {
            console.warn('WebSocket is not open. Message not sent:', { type, data });
        }
    }

    on(eventType, handler) {
        this.eventHandlers.set(eventType, handler);
    }
}

export default WebSocketClient;