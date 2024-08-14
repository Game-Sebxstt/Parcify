import Konva from "konva";
import * as States from "./StatesLogic";
import * as req from '../../js/backend/requests';

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
export const id_stage = urlParams.get("id");

const new_stage_db = await getStage(id_stage);

// Constants
const SCALEBY_DEFAULT = 1.2;
const MIN_WIDTH_DEFAULT = 20;
const GUIDELINE_OFFSET_DEFAULT = 5;

// Variables
let SCALEBY = SCALEBY_DEFAULT;
let MIN_WIDTH = MIN_WIDTH_DEFAULT;
let GUIDELINE_OFFSET = GUIDELINE_OFFSET_DEFAULT;
let SELECTING = false;
let SELECTALL = true;
let ISDRAG = false;

// State variables
let X1, Y1, X2, Y2;
let elements = [];
let groups = [];
let elementsLayerBackground = [];
let historySave = [];
let indexHistory = 0;

let konva = document.querySelector("#konva");
let widthKonva = Number(window.getComputedStyle(konva).width.split("px")[0]);
let heightKonva = Number(window.getComputedStyle(konva).height.split("px")[0]);


export function setScaleBy(scaleBy){
    SCALEBY = scaleBy;
}

export function setMinWidth(minWidth){
    MIN_WIDTH = minWidth;
}

export function setSelecting(selecting){
    SELECTING = selecting;
}

export function setSelectAll(select){
    SELECTALL = select;
}

export function setIsDrag(isDrag){
    ISDRAG = isDrag;
}

export function setElements(elements){
    elements = elements;
}

export function setPositions(positions){
    X1 = positions.X1;
    Y1 = positions.Y1;
    X2 = positions.X2;
    Y2 = positions.Y2;
}

export function setGuideline(guideline){
    GUIDELINE_OFFSET = guideline;
}

export function getScaleBy(){
    return SCALEBY;
}

export function getMinWidth(){
    return MIN_WIDTH;
}

export function getSelecting(){
    return SELECTING;
}

export function getSelectAll(){
    return SELECTALL;
}

export function getIsDrag(){
    return ISDRAG;
}

export function getElements(){
    return elements;
}

export function getPositions(){
    return {X1, Y1, X2, Y2};
}

export function getGuideline(){
    return GUIDELINE_OFFSET;
}

export let stage;

if(new_stage_db){
    stage = Konva.Node.create(JSON.parse(new_stage_db), 'konva');
} else {
    stage = new Konva.Stage({
        container: 'konva',
        width: widthKonva,
        height: heightKonva,
        draggable: false,
    });
}

stage.stopDrag();

export var layer = stage.getLayers().find(item => item.attrs.id == "layer") || new Konva.Layer({
    id: "layer"
});

elements = [...layer.getChildren().filter(item => (item.attrs.id != "selection") && item.attrs.id != "transformer") ];

layer.getChildren().forEach(item => {
    if(item instanceof Konva.Image == false){
        return;
    }

    const image = new Image();

    image.onload = function () {
        var image = new Konva.Image({
            x: item.x(),
            y: item.y(),
            image: this,
            width: item.width(),
            height: item.height(),
            draggable: true,
            id: "default",
            name: "shape",
            imagePath: item.attrs.imagePath,
            _id: item._id
        });

        elements.push(image);
        layer.add(image);
        layer.draw();
    }

    image.src = item.attrs.imagePath;

})

var layerBackground = stage.getLayers().find(item => item.attrs.id == "layerbackground") || new Konva.Layer({
    id: "layerbackground",
});

if(!stage.getLayers().find(item => item.attrs.id == "layer") && !stage.getLayers().find(item => item.attrs.id == "layerBackground")){
    stage.add(layer);
    stage.add(layerBackground); 
}

layer.zIndex(1);
layerBackground.zIndex(0);

export let bg = layerBackground.getChildren().find(item => item.attrs.id == "bg") ||  new Konva.Rect({
    x: 0,
    y: 0,
    width: stage.width(),
    height: stage.height(),
    fill: "#1E1E1E",
    listening: false,
    draggable: false,
    scale: {
        x: 8,
        y: 8,
    },
    name: "bg"
});

if(!layerBackground.getChildren().find(item => item.attrs.id == "bg")){
    layerBackground.add(bg);
    elementsLayerBackground.push(bg);
}

export var tr = layer.getChildren().find(item => item.attrs.id == "transformer") || new Konva.Transformer({
    padding: 1,
    flipEnabled: false,
    boundBoxFunc: (oldBox, newBox) => {
        if (Math.abs(newBox.width) < MIN_WIDTH) {
          return oldBox;
        }
        return newBox;
    },
    ignoreStroke: true,
    visible: true,
    // centeredScaling: true,
    rotationSnaps: [0, 90, 180, 270],
    id: "transformer"
});

if(!layer.getChildren().find(item => item.attrs.id == "transformer")){
    layer.add(tr);
}

export var selectionRectangle = layer.getChildren().find(item => item.attrs.id == "selection") ||  new Konva.Rect({
    fill: 'rgba(252,127,83, .4)',
    visible: false,
    listening: false,
    id: "selection"
});

if(!layer.getChildren().find(item => item.attrs.id == "selection")){
    layer.add(selectionRectangle);
}

saveHistory(stage.toJSON());

async function getStage(id_stage) {
    const validation = await req.getProject(id_stage);

    if(!validation.state || !validation){
        let errorMensaje = document.getElementById('danger');
        errorMensaje.style.display = "flex"
        errorMensaje.querySelector("#txt").textContent = data_register.data;
        return null;
    }

    if(!validation.data.message.stage){
        return null;
    }

    return validation.data.message.stage;
}

export function groupElements() {
    let selectedNodes = tr.nodes();
    if(selectedNodes[0] instanceof Konva.Group){
        selectedNodes = tr.nodes()[0].getChildren();    
    }
    if (selectedNodes.length < 2) {
        alert("cagaste")
        return;
    }

    const group = new Konva.Group({
        draggable: true,
    });

    selectedNodes.forEach((node) => {
        node.draggable(false);
        group.add(node);
    });

    layer.add(group);
    elements.push(group);
    tr.nodes([group]);
    layer.batchDraw();
}

export function ungroupElements() {
    let selectedNodes = tr.nodes();
    if (selectedNodes.length === 0) {
        return;
    }

    if (selectedNodes[0] instanceof Konva.Group == false) {
        return;
    }

    const children = selectedNodes[0].children.slice();
    selectedNodes[0].remove();

    children.forEach((node) => {
        node.draggable(true);
        layer.add(node);
        elements.push(node);
    });

    tr.nodes(children);
    layer.batchDraw();
}

export function saveHistory(stageJSON) {
    historySave.push(JSON.parse(stageJSON));
    indexHistory = historySave.length;
}

export function undo() {
    if (indexHistory > 0) {
        indexHistory--;
        const lastState = historySave[indexHistory];

        layer.destroy();
        
        const stageJSON = lastState;
        const layerJSON = stageJSON.children[1];
        layer = Konva.Layer.create(layerJSON);
        stage.add(layer);
        
        elements = layer.getChildren().filter(item => (item.attrs.id != "selection") && item.attrs.id != "transformer");
        tr = layer.getChildren().find(item => item.attrs.id == "transformer");
        selectionRectangle = layer.getChildren().find(item => item.attrs.id == "selection");
        
        tr.setAttr("visible", true)
        layer.draw();
        updateElementsEvent();
        snapDragElements();
        snapTransformElements();
    }
}

export function redo() {
    if (indexHistory < historySave.length - 1) {
        indexHistory++;
        const nextState = historySave[indexHistory];
        
        layer.destroy();        

        const stageJSON = nextState;
        const layerJSON = stageJSON.children[1];
        layer = Konva.Layer.create(layerJSON);
        stage.add(layer);

        elements = layer.getChildren().filter(item => (item.attrs.id != "selection") && item.attrs.id != "transformer");
        tr = layer.getChildren().find(item => item.attrs.id == "transformer");
        selectionRectangle = layer.getChildren().find(item => item.attrs.id == "selection");

        tr.setAttr("visible", true)
        layer.draw();
        updateElementsEvent();
        snapDragElements();
        snapTransformElements();
    }
}

export function updateElementsEvent(){
    elements.forEach(item => {
        item.on("transformend", () => {
            saveHistory(stage.toJSON());
        })
    });
}

export function dbClickElement(e) {
    let element = e.target;
    
    if (element instanceof Konva.Text) {
        dbClickText(element);
    }

    if (element instanceof Konva.Rect) {
        dbClickRect(element);
    }
}

function createTextArea(textAlign, areaPosition, elementDrag, textNode, value) {
    let fillColor = "black";
    let fontSize = elementDrag.attrs.font_size;
    let fontFamily = "Arial";

    if (textNode){
        fillColor = textNode.fill();
        fontSize = textNode.fontSize();
        fontFamily = textNode.fontFamily();
    }

    var textarea = document.createElement('div');
    textarea.contentEditable = true;
    textarea.id = "edit-text";
    document.body.appendChild(textarea);
    textarea.innerText = value || " ";
    textarea.style.position = 'absolute';
    textarea.style.top = areaPosition.y + 'px';
    textarea.style.left = areaPosition.x + 'px';
    textarea.style.width = elementDrag.width() * elementDrag.scaleX() + 'px';
    textarea.style.height = elementDrag.height() * elementDrag.scaleY() + 'px';
    textarea.style.fontSize = fontSize + 'px';
    textarea.style.border = '0px';
    textarea.style.padding = '0px';
    textarea.style.margin = 'none';
    textarea.style.overflow = 'hidden';
    textarea.style.background = 'red';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.lineHeight = 1;
    textarea.style.fontFamily = fontFamily;
    textarea.style.transformOrigin = 'right top';
    textarea.style.textAlign = textAlign;
    textarea.style.display = 'flex';
    textarea.style.justifyContent = textAlign;
    textarea.style.alignItems = textAlign;
    textarea.style.color = fillColor;
    textarea.style.transform = `rotateZ(${elementDrag.rotation() ?? 0}deg)`;
    setTextareaWidth(elementDrag.width() * elementDrag.getAbsoluteScale().x, textarea, textNode);
    textarea.focus();
    moveCursorToEnd(textarea);
    SELECTALL = false;

    return textarea;
}

function setTextareaWidth(newWidth, textarea, textNode) {
    if (!newWidth) {
        newWidth = textNode.placeholder.length * textNode.fontSize();
    }
    textarea.style.width = newWidth + 'px';
}

function dbClickText(textNode) {
    States.StatesCursor.textEditing = textNode;
    textNode.hide();

    var textPosition = textNode.absolutePosition();
    var stageBox = stage.container().getBoundingClientRect();

    var areaPosition = {
        x: stageBox.left + textPosition.x,
        y: stageBox.top + textPosition.y,
    };

    var textarea = createTextArea(textNode.align(), areaPosition, textNode, textNode, (textNode.text() == "Escribe un texto." ? "": textNode.text()));

    function removeTextarea() {
        document.querySelector("#edit-text")?.remove();
        window.removeEventListener('click', handleOutsideClick);
        textNode.show();
        tr.show();
        tr.forceUpdate();
        SELECTALL = true;
        States.StatesCursor.textEditing = undefined;
    }

    textarea.addEventListener('keydown', function (e) {
        if (e.keyCode === 13 && !e.shiftKey) {
            textNode.text(textarea.innerText);
            removeTextarea();
        }
        if (e.keyCode === 27) {
            removeTextarea();
        }
    });

    textarea.addEventListener('keydown', function () {
        setTextareaWidth(textNode.width() * textNode.getAbsoluteScale().x, textarea, textNode);
    });

    function handleOutsideClick(e) {
        if (e.target !== textarea) {
            textNode.text(textarea.value);
            removeTextarea();
        }
    }
    
    setTimeout(() => {
        window.addEventListener('click', handleOutsideClick);
    });
}

function moveCursorToEnd(element) {
    var range = document.createRange();
    var sel = window.getSelection();
    range.selectNodeContents(element);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
}

function dbClickRect(elementDrag) {
    let textNode
    if (elementDrag.parent instanceof Konva.Group) {
        textNode = elementDrag.parent.getChildren().find(item => item instanceof Konva.Text);
    }

    let value;
    let textAlign = "center";

    if (textNode) {
        value = textNode.text();
        textAlign = textNode.align() || "center";
        textNode.hide();
    }

    States.StatesCursor.textEditing = elementDrag;

    var textPosition = elementDrag.absolutePosition();
    var stageBox = stage.container().getBoundingClientRect();

    var areaPosition = {
        x: stageBox.left + textPosition.x,
        y: stageBox.top + textPosition.y,
    };

    var textarea = createTextArea(textAlign, areaPosition, elementDrag, textNode, value);

    function removeTextarea() {
        document.querySelector("#edit-text")?.remove();
        window.removeEventListener('click', handleOutsideClick);
        elementDrag.show();

        let group;

        if (elementDrag.parent instanceof Konva.Group) {
            elementDrag.parent.getChildren().forEach(item => {
                if(item instanceof Konva.Text){
                    item.destroy();
                }
            });

            group = elementDrag.parent;
        } else {
            group = new Konva.Group({
                draggable: true,
            });
            
            layer.add(group);
        }

        group.add(elementDrag);
        group.add(new Konva.Text({
            x: elementDrag.x(),
            y: elementDrag.y(),
            width: elementDrag.width(),
            height: elementDrag.height(),
            text: textarea.innerText,
            fontSize: elementDrag.attrs.font_size,
            fontFamily: "Arial",
            fill: "black",
            align: "center",
            verticalAlign: "middle",
            draggable: true,
            listening: false,
        }));

        layer.draw();
        updateElementsEvent();

        tr.show();
        tr.forceUpdate();
        tr.moveToTop();
        tr.nodes(group.getChildren());
        SELECTALL = true;
        States.StatesCursor.textEditing = undefined;

        let isTextFind = false
        group.getChildren().forEach(item => {
            if (item instanceof Konva.Text) {
                isTextFind = true;

                item.setAttrs({
                    width: Math.max(5, group.getChildren().find(item => item instanceof Konva.Rect).width() * group.getChildren().find(item => item instanceof Konva.Rect).scaleX(), MIN_WIDTH), 
                    height: Math.max(5, group.getChildren().find(item => item instanceof Konva.Rect).height() * group.getChildren().find(item => item instanceof Konva.Rect).scaleY()),
                    scaleX: 1,
                    scaleY: 1,
                });
            }
        });

        if(isTextFind){
            group.setAttrs({
                scaleX: 1,
                scaleY: 1,
            });
        }

        group.on('transform dragmove', function() {
            group.getChildren().forEach(item => {
                if (item instanceof Konva.Text) {
                    item.setAttrs({
                        x: group.getChildren().find(item => item instanceof Konva.Rect).x(),
                        y: group.getChildren().find(item => item instanceof Konva.Rect).y(),
                        width: Math.max(5, group.getChildren().find(item => item instanceof Konva.Rect).width() * group.getChildren().find(item => item instanceof Konva.Rect).scaleX(), MIN_WIDTH), 
                        height: Math.max(5, group.getChildren().find(item => item instanceof Konva.Rect).height() * group.getChildren().find(item => item instanceof Konva.Rect).scaleY()),
                        scaleX: 1,
                        scaleY: 1,
                    });
                }
            });
        });
    }

    textarea.addEventListener('keydown', function (e) {
        if (e.keyCode === 13 && !e.shiftKey) {
            elementDrag.attrs.text = textarea.innerText;
            removeTextarea();
        }
        if (e.keyCode === 27) {
            removeTextarea();
        }
    });

    textarea.addEventListener('keydown', function () {
        setTextareaWidth(elementDrag.width() * elementDrag.getAbsoluteScale().x, textarea, textNode);
    });

    function handleOutsideClick(e) {
        if (e.target !== textarea) {
            elementDrag.attrs.text = textarea.innerText;
            removeTextarea();
        }
    }

    setTimeout(() => {
        window.addEventListener('click', handleOutsideClick);
    });
}