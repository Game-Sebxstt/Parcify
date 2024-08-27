import Konva from "konva";
import * as States from "./StatesLogic";
import * as req from '../../js/backend/requests';
import { TransformerPoints } from "../ts/utilities/TransformerPoint";
import { PickerCustom } from "../ts/utilities/PickerCustom";

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
export const id_stage = urlParams.get("id");

const new_stage_db = await getStage(id_stage);

// Constants
const SCALEBY_DEFAULT = 1.2;
const MIN_WIDTH_DEFAULT = 20;
const GUIDELINE_OFFSET_DEFAULT = 5;

// Variables
var SCALEBY = SCALEBY_DEFAULT;
var MIN_WIDTH = MIN_WIDTH_DEFAULT;
var GUIDELINE_OFFSET = GUIDELINE_OFFSET_DEFAULT;
var SELECTING = false;
var SELECTALL = true;
var ISDRAG = false;

// State variables
var X1, Y1, X2, Y2;
var elements = [];
var groups = [];
var elementsLayerBackground = [];
var historySave = [];
var indexHistory = 0;

// BarTool Variables
var BarTool = document.querySelector('#BarTool');
BarTool.style.display = "flex";
var widthBarTool = BarTool.offsetWidth;
var heightBarTool = BarTool.offsetHeight;
BarTool.style.display = "none"

var BarToolExtra = document.querySelector('#BarToolExtra'); 
var dimensionBarToolExtra = {
    color: {
        x: 0,
        y: 0,
        width: BarToolExtra.offsetWidth,
        height: BarToolExtra.offsetHeight,
    },
    align: {
        x: 0,
        y: 0,
        width: BarToolExtra.offsetWidth,
        height: BarToolExtra.offsetHeight,
    },
    colorText: {
        x: 0,
        y: 0,
        width: BarToolExtra.offsetWidth,
        height: BarToolExtra.offsetHeight,
    },
    border: {
        x: 0,
        y: 0,
        width: BarToolExtra.offsetWidth,
        height: BarToolExtra.offsetHeight,
    }
};

console.log(dimensionBarToolExtra)

let konva = document.querySelector("#konva");
let widthKonva = Number(window.getComputedStyle(konva).width.split("px")[0]);
let heightKonva = Number(window.getComputedStyle(konva).height.split("px")[0]);

export function setKonva(konvaChange) {
    konva = konvaChange;
}

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

export function setElements(elementsChange){
    elements = elementsChange;
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

export function setWidthBarTool(widthBarToolChange){
    widthBarTool = widthBarToolChange;
}

export function setHeightBarTool(heightBarToolChange){
    heightBarTool = heightBarToolChange;
}

export function setDimensionBarToolExtra(dimensionBarToolExtraChange, key){
    if(!key) return;

    dimensionBarToolExtra[key] = dimensionBarToolExtraChange;
}

export function getKonva(){
    return konva;
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

export function getWidthBarTool(){
    return widthBarTool;
}

export function getHeightBarTool(){
    return heightBarTool;
}

export function getDimensionBarToolExtra(key){
    if(!key) return null;
    
    return dimensionBarToolExtra[key];
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

const stagePickCustom = new Konva.Stage({
    container: 'konvaPickCustom',
    width: 320,
    height: 110,
    draggable: false,
});

stagePickCustom.stopDrag();

const layerPickCustom = new Konva.Layer();
const layerBasePickCustom = new Konva.Layer();

stagePickCustom.add(layerPickCustom);
stagePickCustom.add(layerBasePickCustom);

layerPickCustom.zIndex(1);
layerBasePickCustom.zIndex(2);

export var layerUtilities = stage.getLayers().find(item => item.attrs.id == "layerUtilities") || new Konva.Layer({
    id: "layerUtilities"
});
stage.add(layerUtilities);

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
layerUtilities.zIndex(1);
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

export var tr = layerUtilities.getChildren().find(item => item.attrs.id == "transformer") || new Konva.Transformer({
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
    rotationSnaps: [0, 90, 180, 270],
    id: "transformer"
});

if(!layerUtilities.getChildren().find(item => item.attrs.id == "transformer")){
    layerUtilities.add(tr);
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

export const transformer = new TransformerPoints(stage, layer, layerUtilities, {
    arrowColor: 'white',
    borderArrowColor: '#80D0FF',
    anchorColor: 'white',
    borderColor: '#80D0FF',
    anchorSize: 5,
    enabledAnchors: ["left", "right", "top", "bottom"],
    proximityThreshold: 20,
});

const config = {
    blockWidth: 200,
    blockHeight: 100,
    stripWidth: 30
};

export const picker = new PickerCustom(stagePickCustom, layerBasePickCustom, layerPickCustom, config);

transformer.init();
saveHistory(stage.toJSON());
// fitStageIntoParentContainer();

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
    // tr.hide();
    
    if (element instanceof Konva.Text) {
        dbClickText(element);
    }

    if (element instanceof Konva.Rect) {
        if(element.getAttr("block") == true) return;
        dbClickRect(element);
    }
}

export function fitStageIntoParentContainer() {
    var containerWidth = konva.offsetWidth;

    var scale = containerWidth / widthKonva;

    stage.width(widthKonva * scale);
    stage.height(heightKonva * scale);
    stage.scale({ x: scale, y: scale });
}

function createTextArea(textAlign, areaPosition, elementDrag, textNode, value) {
    let fillColor = "rgb(0 0 0 / 1)";
    let fontSize = 20;
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
    textarea.innerText = value || "‎";
    textarea.style.position = 'absolute';
    textarea.style.top = areaPosition.y + 'px';
    textarea.style.left = areaPosition.x + 'px';
    textarea.style.width = elementDrag.width() * elementDrag.scaleX() * stage.scaleX() + "px"
    textarea.style.height = elementDrag.height() * elementDrag.scaleY() * stage.scaleY() + "px"
    textarea.style.fontSize = fontSize * stage.scaleX() + "px";
    textarea.style.fontWeight = textNode ? textNode.fontStyle() : "normal";
    textarea.style.fontStyle = textNode ? textNode.fontStyle() : "normal";
    textarea.style.textDecoration = textNode ? textNode.textDecoration() : "none";
    textarea.style.border = '0px';
    textarea.style.padding = '0px';
    textarea.style.margin = 'none';
    textarea.style.overflow = 'hidden';
    textarea.style.background = 'none';
    textarea.style.outline = 'none';
    textarea.style.zIndex = "1"
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

    stage.on("wheel dragmove", updateTextArea)
    textNode.on('transform', updateTextArea)

    function updateTextArea(){
        textPosition = textNode.absolutePosition();
        stageBox = stage.container().getBoundingClientRect();

        areaPosition = {
            x: stageBox.left + textPosition.x,
            y: stageBox.top + textPosition.y,
        }

        textarea.style.top = areaPosition.y + 'px';
        textarea.style.left = areaPosition.x + 'px';
        textarea.style.width = textNode.width() * textNode.scaleX() * stage.scaleX() + "px"
        textarea.style.height = textNode.height() * textNode.scaleY() * stage.scaleY() + "px"

        textarea.style.fontSize = textNode.fontSize() * stage.scaleX() + "px";
    }

    function handleOutsideClick(e) {
        if (e.target !== textarea) {
            textNode.text(textarea.innerText);
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
                name: "ShapeText"
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
            fontSize: textNode ? textNode.fontSize() : 20,
            fontFamily: textNode ? textNode.fontFamily() : "Arial",
            fontStyle: textNode ? textNode.fontStyle() : "normal",
            textDecoration: textNode ? textNode.textDecoration() : "none",
            fill: textNode ? textNode.fill() : "rgb(0 0 0 / 1)",
            align: textNode ? textNode.align() : "center",
            verticalAlign: textNode ? textNode.verticalAlign() : "middle",
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

    stage.on("wheel dragmove", updateTextArea)
    elementDrag.on('transform', updateTextArea)

    function updateTextArea(){
        textPosition = elementDrag.absolutePosition();
        stageBox = stage.container().getBoundingClientRect();

        areaPosition = {
            x: stageBox.left + textPosition.x,
            y: stageBox.top + textPosition.y,
        }

        textarea.style.top = areaPosition.y + 'px';
        textarea.style.left = areaPosition.x + 'px';
        textarea.style.width = elementDrag.width() * elementDrag.scaleX() * stage.scaleX() + "px"
        textarea.style.height = elementDrag.height() * elementDrag.scaleY() * stage.scaleY() + "px"

        if(textNode){
            textarea.style.fontSize = textNode.fontSize() * stage.scaleX() + "px";
        }
    }

    function handleOutsideClick(e) {
        let isBarTool = false;
        let element = e.target;
        while(element){
            if(element.id == "BarTool"){
                isBarTool = true;
                break;
            }

            element = element.parentElement;
        }

        if (e.target !== textarea && !isBarTool) {
            elementDrag.attrs.text = textarea.innerText;
            removeTextarea();
        }
    }

    setTimeout(() => {
        window.addEventListener('click', handleOutsideClick);
    });
}