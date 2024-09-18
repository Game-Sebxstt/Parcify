import * as globals from '../utilities/globals';
import * as templates from '../utilities/templates';
import * as websocket from '../../backend/websocket';
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
const message_action = document.querySelector("#message-action");
const close_button = document.querySelector("#close-button");
const header_konva = document.querySelector("#header-konva");
const cancel_resend = document.querySelector("#cancel-resend");

let isResend = false;

// Temporizador para detectar cuando se está escribiendo
let typingTimeout;
const TYPING_DELAY = 1500;

// Obtener rectángulos de los elementos iniciales
content_all_chat.style.display = "flex";
let content_all_chat_rect = getElementRect(content_all_chat);
let chat_container_rect = getElementRect(chat_container);
let scroll_chat_rect = getElementRect(scroll_chat);
content_all_chat.style.display = "none";

// Inicializar posición de scroll_chat
setScrollChatPosition();

// Agregar eventos
initializeEvents();

// Función para inicializar todos los eventos
function initializeEvents() {
    // Evento para desplazamiento suave al fondo del chat
    scroll_chat?.addEventListener("click", scrollToBottom);

    message_action?.addEventListener("click", () => {
        const display = window.getComputedStyle(content_all_chat).display;

        if (display === "flex") {
            content_all_chat.style.display = "none";
            return
        }

        content_all_chat.style.display = "flex";
        setScrollChatPosition();
        chat_message_input.focus();
        scrollToBottom();
    })

    close_button?.addEventListener("click", (event) => {
        event.stopPropagation();
        content_all_chat.style.display = "none";
    })
    
    chat_container.addEventListener("scroll", throttle(handleScrollVisibility, 200));
    
    document.addEventListener("DOMContentLoaded", scrollToBottom);
    
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
export function scrollToBottom() {
    chat_container.scrollTo({
        top: chat_container.scrollHeight,
        behavior: "smooth"
    });
}

function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return function(...args) {
        const context = this;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(() => {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}

// Manejar la visibilidad del botón de scroll
function handleScrollVisibility() {
    const atBottom = chat_container.scrollHeight - chat_container.scrollTop === chat_container.clientHeight;
    scroll_chat.style.display = atBottom ? "none" : "flex";
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

        createMessage(data);
        scrollToBottom();
        chat_message_input.value = "";
        chat_message_form.setAttribute("data-id", "right");
        websocket.sendStopTypingCollaborators(globals.getCookie("ID-USER"));

        let project = environment_utils.getProject(KonvaLogic.id_stage);
        
        if(project){
            const collaborators = JSON.parse(project.collaborators || "[]");
            websocket.sendMessageCollaborators(data, collaborators);
        }

        await req.sendMessageChat(data, KonvaLogic.id_stage)

        if (isResend) {
            hideResendContainer();
        }
    }
}

export function createMessageExternal(data){
    createMessage(data);
    scrollToBottom();
}

export function createTypingExternal(data){
    const typing_chat_list = document.querySelectorAll("#typing-chat");
    const typing_chat = Array.from(typing_chat_list).find(item => item.getAttribute("data-id-user") == data);
    if(!typing_chat) return;

    const parent_typing_chat = typing_chat?.parentNode;
    const typing_chat_clone = typing_chat.cloneNode(true);
    typing_chat_clone.style.display = "flex";
    parent_typing_chat.appendChild(typing_chat_clone);
    typing_chat.remove();
    scrollToBottom();
}

export function removeTypingExternal(data){
    const typing_chat_list = document.querySelectorAll("#typing-chat");
    const typing_chat = Array.from(typing_chat_list).find(item => item.getAttribute("data-id-user") == data);
    if(!typing_chat) return;

    typing_chat.style.display = "none";
}

// Detectar cuando se está escribiendo
function isTyping(e) {
    websocket.sendTypingCollaborators(globals.getCookie("ID-USER"));
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(notIsTyping, TYPING_DELAY);
}

function notIsTyping() {
    websocket.sendStopTypingCollaborators(globals.getCookie("ID-USER"));
}

function hideResendContainer() {
    document.querySelector("#resend-container-input").style.display = "none";
    chat_message_form.setAttribute("data-type", "right");
    isResend = false;
}

// Crear un mensaje y agregarlo al chat
async function createMessage(data) {
    let type = data.id_user == globals.getCookie("ID-USER") ? "right" : "left";
    
    if(data.response != undefined){
        type = type + "-response";
    }

    let chat_bubble = findChatBubble(type);

    if (!chat_bubble) {
        front.utils.handleError("Failed to create chat bubble");
        return;
    }

    const node_chat_bubble = chat_bubble.cloneNode(true);
    node_chat_bubble.style.display = "flex";
    node_chat_bubble.setAttribute("data-id", data.id);

    const profile_invite = node_chat_bubble.querySelector("#profile-invite");
    const collaborators = JSON.parse(environment_utils.getProject(KonvaLogic.id_stage).collaborators || "[]");

    const collaborator_chat_bubble = collaborators.find(item => item.user_id == data.id_user);
    if(profile_invite){
        profile_invite.innerText = collaborator_chat_bubble.name[0].toUpperCase();
        profile_invite.style.backgroundColor = collaborator_chat_bubble.color.hex || "black"
        profile_invite.setAttribute("data-id-user", collaborator_chat_bubble.user_id);
    }

    if(data.response != undefined){
        node_chat_bubble.querySelector("#response-message").setAttribute("data-id-response", data.response.id);
    }

    let user = type.includes("right") ? "Tu" : data.name;
    updateMessageDetails(node_chat_bubble, data.time, user, data.message, data.response);

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
        info_message.querySelector("#user-response").textContent = response.id_user == globals.getCookie("ID-USER") ? "Tu" : response.name;
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
    const project_response = environment_utils.getProject(KonvaLogic.id_stage);

    if(!project_response){
        front.utils.handleError("Failed to find project");
        return;
    }

    const chat = JSON.parse(project_response.chat_message || "[]");
    return chat.find(message => message.id == id_chat);
}

function updateResponseInput(chat){
    const resend_container_input = document.querySelector("#resend-container-input");
    resend_container_input.style.display = "flex";

    resend_container_input.querySelector("#user").textContent = chat.id_user == globals.getCookie("ID-USER") ? "Tu" : chat.name;
    resend_container_input.querySelector("#message").textContent = chat.message;
}

export async function loadChat(id_stage){
    const project_response = environment_utils.getProject(id_stage);

    if(!project_response){
        front.utils.handleError("Failed to find project");
        return;
    }

    const chat = JSON.parse(project_response.chat_message || "[]");
    console.log(chat);

    chat.forEach(message => {
        createMessage(message);
    })
}