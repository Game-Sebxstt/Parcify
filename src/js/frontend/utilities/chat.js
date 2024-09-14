import * as globals from '../utilities/globals';
import * as front from '../front';
import * as req from '../../backend/requests'
import * as KonvaLogic from '../../../konva/js/KonvaLogic'
import * as environment_utils from '../../globals/environment-utils'

// Obtener referencias iniciales de elementos
const content_all_chat = document.querySelector("#content-all-chat");
const chat_message_form = document.querySelector("#chat-message-form");
const chat_message_input = document.querySelector("#chat-message-input");
const render_container_chat = document.querySelector("#render-container-chat");
const chat_container = document.querySelector("#chat-container");
const scroll_chat = document.querySelector("#scroll-chat");
const drag_chat = document.querySelector("#drag-chat");
const header_konva = document.querySelector("#header-konva");
const cancel_resend = document.querySelector("#cancel-resend");

let isFocus = false;
let isResend = false;
let isDragging = false;

// Establecer límites de arrastre
let minY = parseFloat(window.getComputedStyle(header_konva).height);
let minX = 0;
let maxY = window.innerHeight;
let maxX = window.innerWidth;
let position = { x: 0, y: 0 };

// Obtener rectángulos de los elementos iniciales
let content_all_chat_rect = getElementRect(content_all_chat);
let chat_container_rect = getElementRect(chat_container);
scroll_chat.style.display = "flex";
let scroll_chat_rect = getElementRect(scroll_chat);
scroll_chat.style.display = "none";
let drag_chat_rect = getElementRect(drag_chat);
let header_konva_rect = getElementRect(header_konva);

// Inicializar posición de scroll_chat
setScrollChatPosition();

// Agregar eventos
initializeEvents();

// Función para inicializar todos los eventos
function initializeEvents() {
    // Evento para desplazamiento suave al fondo del chat
    scroll_chat?.addEventListener("click", scrollToBottom);
    
    content_all_chat?.addEventListener("focus", () => isFocus = true);
    content_all_chat?.addEventListener("blur", () => isFocus = false);
    
    chat_container.addEventListener("scroll", handleScrollVisibility);
    
    document.addEventListener("DOMContentLoaded", scrollToBottom);
    
    drag_chat.addEventListener("mousedown", startDragging);
    document.addEventListener("mouseup", stopDragging);
    document.addEventListener("mousemove", updatePosChat);

    chat_message_form?.addEventListener("submit", handleSendMessage);
    chat_message_input?.addEventListener("input", isTyping); 
    cancel_resend?.addEventListener("click", hideResendContainer);
}

// Obtener las posiciones de los rectángulos
function getElementRect(element) {
    return element?.getBoundingClientRect() || {};
}

// Establecer la posición de `scroll_chat`
function setScrollChatPosition() {
    scroll_chat.style.left = `${content_all_chat_rect.left + chat_container_rect.width / 2 - scroll_chat_rect.width / 2}px`;
    scroll_chat.style.top = `${content_all_chat_rect.top + chat_container_rect.height}px`;
}

// Función para hacer scroll al final del chat
function scrollToBottom() {
    chat_container.scrollTo({
        top: chat_container.scrollHeight,
        behavior: "smooth"
    });
}

// Manejar la visibilidad del botón de scroll
function handleScrollVisibility() {
    const atBottom = chat_container.scrollHeight - chat_container.scrollTop === chat_container.clientHeight;
    scroll_chat.style.display = atBottom ? "none" : "flex";
}

// Iniciar arrastre del chat
function startDragging(e) {
    isDragging = true;
    updatePosChat(e);
}

// Detener arrastre del chat
function stopDragging() {
    if (isDragging) isDragging = false;
}

// Actualizar la posición del chat arrastrado
function updatePosChat(e) {
    if (isDragging) {
        content_all_chat.style.position = "fixed";
        updateRects();

        position = {
            x: Math.max(minX, Math.min(e.clientX - drag_chat_rect.width / 2, maxX - content_all_chat_rect.width)),
            y: Math.max(minY - drag_chat_rect.height, Math.min(e.clientY - drag_chat_rect.height * 1.5, maxY - content_all_chat_rect.height))
        };

        content_all_chat.style.top = `${position.y}px`;
        content_all_chat.style.left = `${position.x}px`;
        setScrollChatPosition();
    }
}

// Actualizar los rectángulos de los elementos
function updateRects() {
    drag_chat_rect = getElementRect(drag_chat);
    content_all_chat_rect = getElementRect(content_all_chat);
    chat_container_rect = getElementRect(chat_container);
}

// Manejar el envío de mensajes
async function handleSendMessage(e) {
    e.preventDefault();

    let chat_message_input_value = chat_message_input.value.trim();

    if (chat_message_input_value) {
        const type = chat_message_form.getAttribute("data-type");
        const id_response = chat_message_form.getAttribute("data-id");

        const data = {
            id: globals.generateID(),
            id_user: globals.getCookie("ID-USER"),
            name: environment_utils.getDataUser().users.username,
            message: chat_message_input_value,
            time: globals.formatLocalTimeString(new Date().toLocaleTimeString()),
            type: type,
            response: await findChat(id_response)
        }

        createMessage(type, data.message, data.time, data.name, data.id, data.response);
        scrollToBottom();
        chat_message_input.value = "";
        chat_message_form.setAttribute("data-id", "right");

        await req.sendMessageChat(data, KonvaLogic.id_stage)

        if (isResend) {
            hideResendContainer();
        }
    }
}

// Detectar cuando se este escribiendo
function isTyping(e) {
    console.log("Escribiendo...", e.target.value);
}

// Ocultar el contenedor de reenviar mensaje
function hideResendContainer() {
    document.querySelector("#resend-container-input").style.display = "none";
    chat_message_form.setAttribute("data-type", "right");
    isResend = false;
}

// Crear un mensaje y agregarlo al chat
function createMessage(type, message, time, user, id, response) {
    let chat_bubble = findChatBubble(type);

    if (!chat_bubble) {
        front.utils.handleError("Failed to create chat bubble");
        return;
    }

    const node_chat_bubble = chat_bubble.cloneNode(true);
    node_chat_bubble.style.display = "flex";
    node_chat_bubble.setAttribute("data-id", id);
    
    if(response != undefined){
        node_chat_bubble.querySelector("#response-message").setAttribute("data-id-response", response.id);
    }

    user = type.includes("right") ? "Tu" : user;
    updateMessageDetails(node_chat_bubble, time, user, message, response);

    render_container_chat.appendChild(node_chat_bubble);
    attachResendListener(node_chat_bubble);
}

// Buscar un chat bubble según el tipo
function findChatBubble(type) {
    let list_chat_bubble = document.querySelector("#templates-chat").querySelectorAll("#chat-bubble");
    return Array.from(list_chat_bubble).find(item => item.getAttribute("data-type") === type);
}

// Actualizar los detalles del mensaje (hora, usuario)
function updateMessageDetails(node_chat_bubble, time, user, message, response) {
    node_chat_bubble.querySelector("#message").textContent = message;
    node_chat_bubble.querySelector("#date").textContent = time;
    node_chat_bubble.querySelector("#user").textContent = user;

    if(response){
        const info_message = node_chat_bubble.querySelector("#info-message");
        info_message.querySelector("#user-response").textContent = response.type.includes("right") ? "Tu" : response.name;
        info_message.querySelector("#message-response").textContent = response.message;
    }
}

// Agregar el listener de reenviar mensaje al chat bubble
function attachResendListener(chat_bubble) {
    const type = chat_bubble.getAttribute("data-type")
    const resend = chat_bubble.querySelector("#resend");
    
    resend?.addEventListener("click", async () => {
        const type = chat_bubble.getAttribute("data-type").includes("-response")
            ? chat_bubble.getAttribute("data-type")
            : `${chat_bubble.getAttribute("data-type")}-response`;
        const id = chat_bubble.getAttribute("data-id");

        const chat_response = await findChat(id);
        updateResponseInput(chat_response);
        chat_message_form.setAttribute("data-type", type);
        chat_message_form.setAttribute("data-id", id);
        chat_message_input.focus();
        isResend = true;
    });

    if (type.includes("-response")) {
        const response_message = chat_bubble.querySelector("#response-message");
    
        response_message.addEventListener("click", () => {
            const id_response = response_message.getAttribute("data-id-response");
            const list_chat_bubble = document.querySelectorAll("#chat-bubble");
    
            list_chat_bubble.forEach(chat => {
                if (chat.getAttribute("data-id") == id_response) {
                    chat.scrollIntoView({ behavior: "smooth", block: "end" });
    
                    const offsetBottom = chat.getBoundingClientRect().bottom;
                    const containerHeight = chat_container.clientHeight;
    
                    if (offsetBottom > containerHeight) {
                        chat_container.scrollTop += offsetBottom - containerHeight;
                    }
    
                    highlightMessage(chat);
                }
            });
        });
    }
    
    function highlightMessage(chat) {
        chat.style.transition = "background-color 0.5s ease-in-out";
        chat.style.backgroundColor = "rgba(0, 123, 255, 0.3)";
        setTimeout(() => {
            chat.style.backgroundColor = "transparent";
        }, 1000);
    }
}

async function findChat(id_chat){
    const project_response = await req.getProject(KonvaLogic.id_stage);

    if(!project_response.state){
        front.utils.handleError(project_response);
        return;
    }

    const chat = JSON.parse(project_response.data.message.chat_message || "[]");
    return chat.find(message => message.id == id_chat);
}

function updateResponseInput(chat){
    const resend_container_input = document.querySelector("#resend-container-input");
    resend_container_input.style.display = "flex";

    resend_container_input.querySelector("#user").textContent = chat.type.includes("right") ? "Tu" : chat.name;
    resend_container_input.querySelector("#message").textContent = chat.message;
}

async function loadChat(){
    const project_response = await req.getProject(KonvaLogic.id_stage);

    if(!project_response.state){
        front.utils.handleError(project_response);
        return;
    }

    const chat = JSON.parse(project_response.data.message.chat_message || "[]");
    console.log(chat)

    chat.forEach(message => {
        createMessage(message.type, message.message, message.time, message.name, message.id, message.response);
    })
}

await loadChat();
scrollToBottom();