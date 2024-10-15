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

const generative_action = document.querySelector("#generative-action");

generative_action.addEventListener("click", async () => {
    updateStateChatbot();
})