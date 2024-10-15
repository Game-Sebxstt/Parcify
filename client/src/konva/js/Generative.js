import * as config from "../../config";
import * as konva from './KonvaLogic.js';
import { addShape } from "../ts/CreationShapes";
import { generateID } from "../../js/frontend/utilities/globals.js";

async function getGenerativeCanvas(prompt) {
    const response = await fetch(config.getApiUrl() + '/generative/generative-canvas', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            prompt,
            canvasSummary: {
                dimensionStage: {width: konva.stage.width(), height: konva.stage.height()},
                shapes: konva.stage.find('Shape').map(shape => shape.toJSON()),
            },
        }),
    });

    if (!response.ok) {
        return {canvasShapes: [], resume: "Parece que hubo un error al intentar generar el canvas, por favor intenta de nuevo."};
    }

    return response.json();
}

export async function generateCanvas(prompt) {
    const generativeCanvas = await getGenerativeCanvas(prompt);

    console.log("generativeCanvas", generativeCanvas);

    if (generativeCanvas.canvasShapes) {
        generativeCanvas.canvasShapes.forEach(shape => {
            console.log("shape", shape);
            if(shape.action === 'add') {
                const newShape = addShape(shape, shape.shape);
                newShape.setAttrs({
                    id_unique: generateID(),
                });
                konva.layer.add(newShape);
            }

            if(shape.action === 'edit') {
                const shapesToEdit = konva.layer.children.filter(item => item.attrs.id_unique == shape.id_unique);
                shapesToEdit.forEach(shapeEdit => {
                    shapeEdit.setAttrs(shape);
                });
            }

            if(shape.action === 'delete') {
                const shapesToDelete = konva.layer.children.filter(item => item.attrs.id_unique == shape.id_unique);
                shapesToDelete.forEach(shape => shape.destroy());
            }
            konva.layer.draw();
        });
    }

    return generativeCanvas || {};
}

export function updateStateChatbot() {
    const customEvent = new CustomEvent('updateStateChatbot', {
        detail: {
            state: 'generative',
            opacity: window.getComputedStyle(document.querySelector("#chat-bot")).opacity
        }
    });

    document.dispatchEvent(customEvent);
}

export function updateRecording(textRecording){
    const customEvent = new CustomEvent('updateRecording', {
        detail: {
            recording: textRecording
        }
    });

    document.dispatchEvent(customEvent);
}


let recording = false;
let mediaRecorder;
let audioChunks = [];
let recognition;

function initializeSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'es-ES';

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            updateRecording(interimTranscript.length > 0 ? interimTranscript : finalTranscript);
        };

        recognition.onerror = (event) => {
            console.error('Error en el reconocimiento de voz:', event.error);
        };
    } else {
        console.log('El reconocimiento de voz no está soportado en este navegador.');
    }
}

export async function toggleRecording() {
    if (!recording) {
        recording = true;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
            const audioUrl = URL.createObjectURL(audioBlob);

            audioChunks = [];
        };

        mediaRecorder.start();
        if (recognition) {
            recognition.start();
        }
        console.log("Grabación iniciada...");
    } else {
        recording = false;
        
        mediaRecorder.stop();
        if (recognition) {
            recognition.stop();
        }

        console.log("Grabación detenida.");
    }
}

const generative_action = document.querySelector("#generative-action");

if (generative_action) {
    generative_action.addEventListener("click", updateStateChatbot);
}

initializeSpeechRecognition();