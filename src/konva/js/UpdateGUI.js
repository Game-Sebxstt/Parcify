import * as States from "./StatesLogic";
import _ from 'lodash';
import * as konva from "./KonvaLogic";
import Konva from "konva"
import * as GlobalFunctions from "./GlobalFunctions";

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
    exportCanvas: document.querySelector("#export"),
    fileFolder: document.querySelector("#file-folder"),
    dropzoneFile: document.querySelector("#dropzone-file"),
    listImageFolder: document.querySelector("#list-image-folder"),
    contentsImageFolder: document.querySelectorAll("#content-image-folder")
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

function updateElement() {
    const selectedNodes = konva.tr.nodes();
    if (selectedNodes.length === 0) {
        return;
    }

    updateNodeAttrs(States.StatesCursor.select, selectedNodes[0]);
    konva.layer.batchDraw();
    konva.saveHistory(konva.stage.toJSON());
}

function changeLayout(attrs) {
    domElements.colorStyle.value = attrs.fill || "black";
    domElements.colorStyleBorder.value = attrs.stroke || "black";

    if (attrs.text) {
        domElements.editorText.value = attrs.text;
    }

    updateAlignButtons(attrs.align, domElements.aligns, "data-align");
    updateAlignButtons(attrs.verticalAlign, domElements.alignsVertical, "data-align-vertical");

    const scaleX = attrs.scaleX ?? 1;
    const scaleY = attrs.scaleY ?? 1;
    domElements.inputLayoutX.value = (attrs.x !== undefined ? attrs.x.toFixed(0) : 0);
    domElements.inputLayoutY.value = (attrs.y !== undefined ? attrs.y.toFixed(0) : 0);

    if (attrs.width) {
        domElements.inputWidth.value = ((attrs.width || 1) * scaleX).toFixed(0);
        domElements.inputHeight.value = ((attrs.height || 1) * scaleY).toFixed(0);
    }

    if (attrs.rotation) {
        domElements.inputRotate.value = attrs.rotation.toFixed(0) || 1;
    }

    if (attrs.radius) {
        domElements.inputRadius.value = attrs.radius;
    }

    domElements.inputColor.value = domElements.colorStyle.value || "";
    domElements.inputColorBorder.value = domElements.colorStyleBorder.value || "";
    domElements.inputStrokeBorder.value = attrs.strokeWidth || 0;
    domElements.inputCorner.value = attrs.cornerRadius || 0;
}

function updateAlignButtons(attr, elements, dataAttribute) {
    elements.forEach(item => {
        if (item.getAttribute(dataAttribute) === attr) {
            item.style.backgroundColor = "#505050";
        } else {
            item.style.backgroundColor = "transparent";
        }
    });
}

// Manejadores de Eventos
domElements.fontFamily.addEventListener("change", () => {
    let node = konva.tr.nodes()[0];
    if (!node) return;

    let value = domElements.fontFamily.value;
    node.setAttr("fontFamily", value);
    States.StatesCursor.select.setAttr("fontFamily", value);
});

domElements.fontSize?.addEventListener("input", (e) => {
    let node = konva.tr.nodes()[0];
    if (!node) return;

    let value = Number(e.target.value);
    if (value < 0 || value > 90) return;

    node.setAttr("fontSize", value);
    States.StatesCursor.select.setAttr("fontSize", value);
});

domElements.italicStyle?.addEventListener("click", () => toggleFontStyle("italic", domElements.italicStyle, domElements.boldStyle));
domElements.boldStyle?.addEventListener("click", () => toggleFontStyle("bold", domElements.boldStyle, domElements.italicStyle));

domElements.alignsVertical.forEach(item => {
    item?.addEventListener("click", () => alignText(item, "data-align-vertical"));
});

domElements.aligns.forEach(item => {
    item?.addEventListener("click", () => alignText(item, "data-align"));
});

domElements.editorText?.addEventListener("input", (e) => {
    let node = konva.tr.nodes()[0];
    if (!node || node instanceof Konva.Text == false) return;

    let value = e.target.value;
    States.StatesCursor.select.setAttr("text", value);
    node.setAttr("text", value);
});

elementsFocus.forEach(item => {
    item.addEventListener("focus", () => {
        konva.setSelectAll(false);
    });
    item.addEventListener("blur", () => {
        konva.setSelectAll(true);
    });
});

domElements.undoElement?.addEventListener("click", undo);
domElements.redoElement?.addEventListener("click", redo);

domElements.inputLayoutX.addEventListener("input", updateElement);
domElements.inputLayoutY.addEventListener("input", updateElement);
domElements.inputWidth.addEventListener("input", updateElement);
domElements.inputHeight.addEventListener("input", updateElement);
domElements.inputRotate.addEventListener("input", updateElement);
domElements.inputRadius.addEventListener("input", updateElement);
domElements.inputCorner.addEventListener("input", updateElement);
domElements.colorStyleBorder.addEventListener("input", updateElement);
domElements.inputStrokeBorder.addEventListener("input", updateElement);
domElements.colorStyle.addEventListener("change", updateElement);
domElements.inputColor.addEventListener("input", () => updateColor(domElements.inputColor.value));

function toggleFontStyle(style, styleElement, oppositeStyleElement) {
    let node = konva.tr.nodes()[0];
    if (!node) return;

    if (node.getAttr("fontStyle") !== style) {
        oppositeStyleElement.style.backgroundColor = "transparent";
        styleElement.style.backgroundColor = "#505050";
        node.setAttr("fontStyle", style);
        States.StatesCursor.select.setAttr("fontStyle", style);
        return;
    }

    oppositeStyleElement.style.backgroundColor = "transparent";
    styleElement.style.backgroundColor = "transparent";
    node.setAttr("fontStyle", "normal");
    States.StatesCursor.select.setAttr("fontStyle", "normal");
}

function alignText(item, attribute) {
    let node = konva.tr.nodes()[0];
    if (!node) return;

    let attr = item.getAttribute(attribute);
    node.setAttr(attribute.slice(5), attr);
    States.StatesCursor.select.setAttr(attribute.slice(5), attr);

    item.style.backgroundColor = "#505050";
    [...item.parentNode.children].forEach(element => {
        if (item !== element) {
            element.style.backgroundColor = "transparent";
        }
    });
}

function updateColor(value) {
    if (States.StatesCursor.select && value.length === 7) {
        let select = States.StatesCursor.select;
        select.setAttrs({ fill: value });
        konva.layer.batchDraw();
    }
}

// Intervalo de actualización de layout
let previousAttrs = null;

setInterval(() => {
    if (States.StatesCursor.select || konva.tr.nodes().length > 0) {
        toggleEditPanel(true);
        let select = States.StatesCursor.select;
        if (!select || !select.attrs) return;

        const currentAttrs = { ...select.attrs };
        if (!_.isEqual(previousAttrs, currentAttrs)) {
            changeLayout(currentAttrs);
            previousAttrs = currentAttrs;
        }
    } else {
        toggleEditPanel(false);
    }
}, 100);

function toggleEditPanel(isVisible) {
    const editPanel = document.querySelector("#content-edit");
    const noEditPanel = document.querySelector("#content-edit-nothing");
    if (editPanel && noEditPanel) {
        editPanel.style.display = isVisible ? "flex" : "none";
        noEditPanel.style.display = isVisible ? "none" : "flex";
    }
}

domElements.exportCanvas.addEventListener("click", () => {
    if(konva.tr.nodes().length > 0 && konva.tr.nodes()[0] instanceof Konva.Group){
        var dataURL = konva.tr.nodes()[0].toDataURL({ pixelRatio: 3})
        GlobalFunctions.downloadURI(dataURL, 'stage.png');
        return;
    }

    var dataURL = konva.layer.toDataURL({ pixelRatio: 3 });
    GlobalFunctions.downloadURI(dataURL, 'stage.png');
});

if(domElements.contentsImageFolder.length > 1){
    document.querySelector("#content-drop").style.display = "none";
    domElements.listImageFolder.style.display = "grid"
}

domElements.fileFolder?.addEventListener("change", saveFile)
domElements.dropzoneFile?.addEventListener("change", saveFile)

function saveFile(e){
    let files = e.target.files;

    if(files){
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

        if(domElements.contentsImageFolder.length > 0){
            document.querySelector("#content-drop").style.display = "none";
            domElements.listImageFolder.style.display = "grid"
        }
    }
}

let undoButton = document.querySelector('#undo');
undoButton.addEventListener('click', () => {
    konva.undo();
});

let redoButton = document.querySelector('#redo');
redoButton.addEventListener('click', () => {
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