import * as States from "./StatesLogic";
import _ from 'lodash';
import * as konva from "./KonvaLogic";
import Konva from "konva"
import * as globals from '../../js/frontend/utilities/globals'
import * as req from '../../js/backend/requests'
import * as front from '../../js/frontend/front'
import * as GlobalFunctions from "./GlobalFunctions";
import { elements } from "chart.js";

// Selección de elementos del DOM
const domElements = {
    editorText: document.querySelector("#editor_text"),
    aligns: document.querySelectorAll("#align"),
    alignsVertical: document.querySelectorAll("#align_vertical"),
    boldStyle: document.querySelector("#bold_style"),
    italicStyle: document.querySelector("#italic_style"),
    fontSize: document.querySelector("#font_size"),
    fontFamily: document.querySelector("#font_family"),
    inputLayoutX: document.querySelector("#input_layout_x"),
    inputLayoutY: document.querySelector("#input_layout_y"),
    inputWidth: document.querySelector("#input_width"),
    inputHeight: document.querySelector("#input_height"),
    inputRotate: document.querySelector("#input_rotate"),
    inputRadius: document.querySelector("#input_radius"),
    inputCorner: document.querySelector("#input_corner"),
    colorStyle: document.querySelector("#color_style"),
    inputColor: document.querySelector("#input_color"),
    colorStyleBorder: document.querySelector("#color_style_border"),
    inputColorBorder: document.querySelector("#input_color_border"),
    inputStrokeBorder: document.querySelector("#input_stroke_border"),
    undoElement: document.querySelector("#undo"),
    redoElement: document.querySelector("#redo"),
    selectAllElement: document.querySelector("#selectAll"),
    shareProject: document.querySelector("#share-project"),
    popupInvite: document.querySelector("#popup-invite"),
    presentKonva: document.querySelector("#present"),
    copyLinkInvite: document.querySelector("#copy-link-invite"),
    usersInvited: document.getElementById("users-invited"),
    exportCanvas: document.querySelector("#export"),
    fileFolder: document.querySelector("#file-folder"),
    dropzoneFile: document.querySelector("#dropzone-file"),
    listImageFolder: document.querySelector("#list-image-folder"),
    contentsImageFolder: document.querySelectorAll("#content-image-folder"),
    export: document.querySelector("#exportForm"),
    openExport: document.querySelector("#openExport"),
};

const elementsFocus = [
    domElements.editorText, domElements.inputColor,
    domElements.inputColorBorder, domElements.inputCorner,
    domElements.inputHeight, domElements.inputWidth,
    domElements.inputLayoutX, domElements.inputLayoutY,
    domElements.inputRadius, domElements.inputRotate,
    domElements.inputStrokeBorder
];

// Funciones de Utilidad
function updateNodeAttrs(select, node) {
    const scaleX = select.attrs.scaleX ?? 1;
    const scaleY = select.attrs.scaleY ?? 1;
    const width = select.attrs.width ? domElements.inputWidth.value : undefined;
    const height = select.attrs.height ? domElements.inputHeight.value : undefined;

    let x = parseFloat(domElements.inputLayoutX.value);
    let y = parseFloat(domElements.inputLayoutY.value);

    if (select.getParent() instanceof Konva.Group) {
        x = select.attrs.x;
        y = select.attrs.y;
    }

    const commonAttrs = {
        x,
        y,
        width: width / scaleX,
        height: height / scaleY,
        rotation: parseFloat(domElements.inputRotate.value) || 0,
        cornerRadius: parseFloat(domElements.inputCorner.value) || 0,
        radius: parseFloat(domElements.inputRadius.value) || 0,
        fill: domElements.colorStyle.value,
        stroke: domElements.colorStyleBorder.value,
        strokeWidth: parseFloat(domElements.inputStrokeBorder.value),
    };

    if (node && !(node instanceof Konva.Group)) {
        node.setAttrs(commonAttrs);
        return;
    }

    select.setAttrs(commonAttrs);
}

function rgbaToHex(rgba) {
    const parts = rgba
        .replace(/rgba?\(|\s+|\)/g, '')
        .split(',');

    const r = parseInt(parts[0], 10).toString(16).padStart(2, '0');
    const g = parseInt(parts[1], 10).toString(16).padStart(2, '0');
    const b = parseInt(parts[2], 10).toString(16).padStart(2, '0');

    return `#${r}${g}${b}`;
}


function updateElement() {
    const selectedNodes = konva.tr.nodes();
    if (selectedNodes.length === 0) {
        return;
    }

    updateNodeAttrs(States.StatesCursor.select, selectedNodes[0]);
    konva.layer.batchDraw();
    konva.saveHistory(konva.stage.toJSON());
}

if (domElements.contentsImageFolder.length > 1) {
    document.querySelector("#content-drop").style.display = "none";
    domElements.listImageFolder.style.display = "grid"
}

domElements.fileFolder?.addEventListener("change", saveFile)
domElements.dropzoneFile?.addEventListener("change", saveFile)

domElements.undoElement?.addEventListener("click", () => {
    konva.undo();
})

domElements.redoElement?.addEventListener("click", () => {
    konva.redo();
})

domElements.selectAllElement?.addEventListener("click", () => {
    konva.selectAll();
})

function saveFile(e) {
    let files = e.target.files;

    if (files) {
        Object.values(files).forEach(item => {
            const reader = new FileReader();

            reader.onload = e => {
                const imageData = e.target.result;
                let clone_content_image_folder = domElements.contentsImageFolder[0].cloneNode();
                clone_content_image_folder.id = "content-image-folder";
                clone_content_image_folder.setAttribute("data-image-src", imageData);
                clone_content_image_folder.style.display = "flex"

                const image = document.createElement("img");
                image.src = imageData;
                image.classList.add("w-72")
                image.classList.add("h-36");

                clone_content_image_folder.appendChild(image)
                domElements.listImageFolder.appendChild(clone_content_image_folder);
                domElements.contentsImageFolder = document.querySelectorAll("#content-image-folder");

                domElements.contentsImageFolder?.forEach(item => {
                    item.addEventListener("click", () => {
                        let folder = item.getAttribute("data-image-src");

                        Object.keys(States.StatesShapes).forEach(key => {
                            States.StatesShapes[key] = false;
                        });

                        States.StatesShapes.image = true;
                        States.StatesCursor.addShape = true;
                        States.StatesValues.image = folder;
                    });
                });
            }

            reader.readAsDataURL(item);
        });

        if (domElements.contentsImageFolder.length > 0) {
            document.querySelector("#content-drop").style.display = "none";
            domElements.listImageFolder.style.display = "grid"
        }
    }
}

domElements.presentKonva?.addEventListener("click", async () => {
    if (document.fullscreenElement) {
        await document.exitFullscreen();
    } else {
        await document.querySelector("#konva").requestFullscreen();
    }
    
    GlobalFunctions.updateDimensionStage();
  });

domElements.shareProject?.addEventListener("click", async () => {
    domElements.popupInvite.style.display = "flex";
})

domElements.copyLinkInvite?.addEventListener("click", async () => {
    const id_stage = domElements.usersInvited.getAttribute("data-id");
    const {url, invitation} = globals.generateLinkInvitation(id_stage);
    const role = document.querySelector("#text-select").getAttribute("data-role");
    navigator.clipboard.writeText(url);
    req.sendInvitationProject(id_stage, {invitation: invitation, role: role});
})

let undoButton = document.querySelector('#undo');
undoButton?.addEventListener('click', () => {
    konva.undo();
});

let redoButton = document.querySelector('#redo');
redoButton?.addEventListener('click', () => {
    konva.redo();
});

let shapes = document.querySelectorAll("#shape");

shapes.forEach(element => {
    element.addEventListener("click", () => {
        let attr = element.getAttribute("data-select");

        Object.keys(States.StatesShapes).forEach(key => {
            States.StatesShapes[key] = false;
        });

        if (attr && States.StatesShapes.hasOwnProperty(attr)) {
            States.StatesShapes[attr] = true;
            States.StatesCursor.addShape = true;
        }
    });
});