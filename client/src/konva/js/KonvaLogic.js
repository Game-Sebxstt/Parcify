import Konva from "konva";
import * as States from "./StatesLogic";
import * as environment_utils from '../../js/globals/environment-utils'
import * as GlobalFunctions from './GlobalFunctions'
import * as chat from '../../js/frontend/utilities/chat';
import * as globals from '../../js/frontend/utilities/globals';
import * as websocket from '../../js/backend/websocket'
import * as config_konva from '../config'
import { TransformerPoints } from "../ts/utilities/TransformerPoint";

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
export const id_stage = urlParams.get("id");

const new_stage_db = await getStage(id_stage);

if(id_stage){
    await chat.loadChat(id_stage);
    chat.scrollToBottom();
}

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
var customCursor = document.querySelector("#cursor-custom")
var BarTool = document.querySelector('#BarTool');
var BarToolExtra = document.querySelector('#BarToolExtra'); 
var widthBarTool;
var heightBarTool;
var dimensionBarToolExtra;
var dimensionDropdown;

if(BarTool && BarToolExtra){
    BarTool.style.display = "flex";
    widthBarTool = BarTool.offsetWidth;
    heightBarTool = BarTool.offsetHeight;
    BarTool.style.display = "none"
    
    dimensionBarToolExtra = {
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
        },
        svg: {
            x: 0,
            y: 0,
            width: 36,
            height: 36,
        }
    };
}

let konva = document.querySelector("#konva");
let widthKonva;
let heightKonva;

//Elements
let cursorCollaborators = []
let elementSelectedCollaborators = [];

let isInitiated = true;

if(konva){
    widthKonva = Number(window.getComputedStyle(konva).width.split("px")[0]);
    heightKonva = Number(window.getComputedStyle(konva).height.split("px")[0]);
}

export function setDimensionDropdown(dimensionDropdownNew){
    dimensionDropdown = dimensionDropdownNew
}

export function setCursorCollaborators(cursorCollaborator){
    cursorCollaborators.push(cursorCollaborator);
}

export function setElementSelectedCollaborators(elementSelectedCollaborator){
    elementSelectedCollaborators.push(elementSelectedCollaborator);
}

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

export function getDimensionDropdown(){
    return dimensionDropdown
}

export function getCursorCustom(){
    return customCursor;
}

export function getCursorCollaborators(){
    if(!cursorCollaborators && isInitiated) return

    return cursorCollaborators;
}

export function getElementSelectedCollaborators(){
    if(!elementSelectedCollaborators && isInitiated) return

    return elementSelectedCollaborators;
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

export var layerCollaborators = new Konva.Layer({
    id: "layerCollaborators"
});
stage.add(layerCollaborators);

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

layerCollaborators.zIndex(1); 
layer.zIndex(1);
layerUtilities.zIndex(2);
layerBackground.zIndex(0);
GlobalFunctions.updateDimensionStage();

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

transformer.init();
saveHistory(stage.toJSON());
GlobalFunctions.createCursorCustom("#1E90FF", "white", globals.getCookie("ID-USER"));

// fitStageIntoParentContainer();

async function getStage(id_stage) {
    const validation = environment_utils.getProject(id_stage);

    if(!validation){
        return null;
    }

    if(!validation.stage){
        return null;
    }

    return validation.stage;
}

export function groupElements(nodes, generatedId, user_id, isSame = false) {
    let selectedNodes = nodes || tr.nodes();

    function flattenNodes(node) {
        if (node.nodeType === 'Group') {
            return node.getChildren().flatMap(flattenNodes);
        }
        return [node];
    }
    
    selectedNodes = selectedNodes.flatMap(flattenNodes).filter(item => item.attrs.id != "boxGroup");
    
    if(!selectedNodes.length > 2){
        console.error("Group elements must have at least");
        return;
    }

    const group = new Konva.Group({
        draggable: true,
        name: "GroupElements",
        id_unique: generatedId ?? globals.generateID(),
    })

    selectedNodes.forEach(node => {
        node.draggable(false);
        node.listening(false);
        group.add(node);
    })

    const boxGroup = new Konva.Rect({
        fill: 'rgba(252,127,83, 0)',
        id: "boxGroup",
    })

    GlobalFunctions.updateBoundingRect(boxGroup, group.children);

    group.add(boxGroup);
    layer.add(group);

    if(user_id && user_id == globals.getCookie("ID-USER")){
        tr.nodes([group]);
        tr.moveToTop();

        const collaborator = environment_utils.getCollaboratorOfProject(id_stage, globals.getCookie("ID-USER"));
        collaborator.group_created += 1;
        environment_utils.setCollaboratorOfProject(id_stage, globals.getCookie("ID-USER"), collaborator);
    }

    layer.batchDraw();

    config_konva.setBoxGroup(boxGroup);
    config_konva.setGroup(group);
    setElements([...getElements(), group]);
    updateElementsEvent();

    saveHistory(stage.toJSON())
    if(!isSame){
        GlobalFunctions.setBorderElement(boxGroup, environment_utils.getCollaboratorOfProject(id_stage, user_id))
    }
}

export function ungroupElements(group) {
    let selectedNodes = group ? [group] : tr.nodes();

    if (selectedNodes.length === 0) {
        console.error("No elements selected for ungrouping");
        return;
    }

    if (!group && !(selectedNodes[0] instanceof Konva.Group)) {
        selectedNodes = [selectedNodes[0].getParent()];
    }

    selectedNodes.forEach(itemGroup => {
        if (itemGroup.attrs.name != "GroupElements") {
            return;
        }

        const childNodes = itemGroup.children ? itemGroup.children.filter(item => item.attrs.id != "boxGroup") : [];

        let isCustom = itemGroup.attrs.posCustom ? true : false;

        const groupPosition = isCustom ? itemGroup.attrs.posCustom : itemGroup.position();
        const groupScale = {
            x: isCustom ? itemGroup.attrs.scaleCustom.x : itemGroup.scaleX(),
            y: isCustom ? itemGroup.attrs.scaleCustom.y : itemGroup.scaleY(),
        };
        const groupRotation = isCustom ? itemGroup.attrs.rotationCustom : itemGroup.rotation();

        childNodes.forEach(node => {
            const nodePosition = isCustom ? {x: node.attrs.x, y: node.attrs.y} : node.position();
            const nodeScale = isCustom ? {x: node.attrs.scaleCustom.x, y: node.attrs.scaleCustom.y} : {x: node.scaleX(), y: node.scaleY()};
            const nodeRotation = isCustom ? node.attrs.rotationCustom : node.rotation();

            const absoluteX = groupPosition.x + (nodePosition.x * groupScale.x);
            const absoluteY = groupPosition.y + (nodePosition.y * groupScale.y);

            let nodeCloned;

            if(isCustom){
                const className = node.className;
                node.attrs.x = absoluteX;
                node.attrs.y = absoluteY;
                node.attrs.scaleX = nodeScale.x * groupScale.x;
                node.attrs.scaleY = nodeScale.y * groupScale.y;
                node.attrs.rotation = nodeRotation + groupRotation;
                node.attrs.draggable = true;
                node.attrs.listening = true;

                nodeCloned = new Konva[className](node.attrs);
            }else{
                nodeCloned = node.clone({
                    x: absoluteX,
                    y: absoluteY,
                    scaleX: nodeScale.x * groupScale.x,
                    scaleY: nodeScale.y * groupScale.y,
                    rotation: nodeRotation + groupRotation,
                    draggable: true,
                    listening: true,
                    id: globals.generateID(),
                });
            }

            if (groupRotation !== 0) {
                const rotatedPosition = rotatePoint(
                    {x: absoluteX, y: absoluteY},
                    {x: groupPosition.x, y: groupPosition.y},
                    groupRotation
                );
                nodeCloned.position(rotatedPosition);
            }

            layer.add(nodeCloned);
            setElements([...getElements(), nodeCloned]);
            updateElementsEvent();
        });

        if(isCustom){
            config_konva.getGroups().forEach(item => {
                if(item.attrs.id == itemGroup.attrs.id){
                    item.destroy();
                }
            })
        }else{
            itemGroup.destroy();
        }
        config_konva.setGroups(config_konva.getGroups().filter(item => item.attrs.id !== itemGroup.attrs.id));
    });

    tr.nodes([]);
    layer.batchDraw();

    const collaborator = environment_utils.getCollaboratorOfProject(id_stage, globals.getCookie("ID-USER"));
    collaborator.group_deleted += 1;
    environment_utils.setCollaboratorOfProject(id_stage, globals.getCookie("ID-USER"), collaborator);

    saveHistory(stage.toJSON());
    websocket.deselectElementKonva();
}

function rotatePoint(point, center, angle) {
    const radians = (Math.PI / 180) * angle,
        cos = Math.cos(radians),
        sin = Math.sin(radians),
        nx = (cos * (point.x - center.x)) + (sin * (point.y - center.y)) + center.x,
        ny = (cos * (point.y - center.y)) - (sin * (point.x - center.x)) + center.y;
    return {x: nx, y: ny};
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
        const layerJSON = stageJSON.children[2];
        layer = Konva.Layer.create(layerJSON);
        const layerUtilitiesJSON = stageJSON.children[1];
        layerUtilities = Konva.Layer.create(layerUtilitiesJSON);
        stage.add(layer);
        stage.add(layerUtilities);
        
        elements = layer.getChildren().filter(item => (item.attrs.id != "selection") && item.attrs.id != "transformer");
        tr = layer.getChildren().find(item => item.attrs.id == "transformer");
        selectionRectangle = layer.getChildren().find(item => item.attrs.id == "selection");
        
        tr?.setAttr("visible", true)
        layer.draw();
        updateElementsEvent();
    }
}

export function redo() {
    if (indexHistory < historySave.length - 1) {
        indexHistory++;
        const nextState = historySave[indexHistory];
        
        layer.destroy();        

        const stageJSON = nextState;
        const layerJSON = stageJSON.children[2];
        layer = Konva.Layer.create(layerJSON);
        stage.add(layer);

        elements = layer.getChildren().filter(item => (item.attrs.id != "selection") && item.attrs.id != "transformer");
        tr = layer.getChildren().find(item => item.attrs.id == "transformer");
        selectionRectangle = layer.getChildren().find(item => item.attrs.id == "selection");

        tr?.setAttr("visible", true)
        layer.draw();
        updateElementsEvent();
    }
}

export function selectAll(){
    if(!getSelectAll()){
        return;
    }
    
    tr?.nodes([...getElements()]);
}

export function updateElementsEvent() {
    function throttle(func, limit) {
        let lastFunc;
        let lastRan;
        return function() {
            const context = this;
            const args = arguments;
            if (!lastRan) {
                func.apply(context, args);
                lastRan = Date.now();
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(function() {
                    if ((Date.now() - lastRan) >= limit) {
                        func.apply(context, args);
                        lastRan = Date.now();
                    }
                }, limit - (Date.now() - lastRan));
            }
        };
    }

    const throttleLimit = 50;

    elements.forEach(element => {
        element.on("transformend", () => {
            saveHistory(stage.toJSON());
        });

        element.on("dragmove", throttle((e) => {
            let updatedAttrs;
        
            if (element instanceof Konva.Group) {
                const childAttrs = [];

                element.getChildren().forEach(item => {
                    childAttrs.push({
                        x: item.x(),
                        y: item.y(),
                        scaleX: item.scaleX(),
                        scaleY: item.scaleY(),
                        rotation: item.rotation(),
                        id_unique: item.attrs.id_unique,
                    })
                })
        
                updatedAttrs = {
                    isGroup: element instanceof Konva.Group,
                    childAttrs: childAttrs,
                    id_unique: element.getAttr("id_unique"),
                    id_user: globals.getCookie("ID-USER"),
                    posCursor: stage.getRelativePointerPosition(),
                };
        
                if (element.attrs.name == "ShapeText") {
                    const rectNode = element.getChildren().find(item => item instanceof Konva.Rect);
                    
                    element.getChildren().forEach(item => {
                        if (item instanceof Konva.Text) {
                            const textPos = item.getPosition();
                            item.setAttrs({
                                x: textPos.x,
                                y: textPos.y,
                                width: Math.max(5, rectNode.width() * rectNode.scaleX(), getMinWidth()),
                                height: Math.max(5, rectNode.height() * rectNode.scaleY()),
                                scaleX: 1,
                                scaleY: 1,
                            });
                        }
                    });
                }
            } else {
                updatedAttrs = {
                    x: e.target.x(),
                    y: e.target.y(),
                    rotation: e.target.rotation(),
                    id_unique: e.target.attrs.id_unique,
                    id_user: globals.getCookie("ID-USER"),
                    posCursor: stage.getRelativePointerPosition(),
                };
            }
        
            websocket.updatePosElementKonva(updatedAttrs);
        }, throttleLimit));

        element.on("dragend", throttle((e) => {
            websocket.deselectElementKonva();
        }, throttleLimit));

        element.on("transform", throttle((e) => {
            console.log(e.target)

            const updatedAttrs = {
                x: e.target.x(),
                y: e.target.y(),
                scaleX: e.target.scaleX(),
                scaleY: e.target.scaleY(),
                width: e.target.width(),
                height: e.target.height(),
                rotation: e.target.rotation(),
                id_unique: e.target.attrs.id_unique,
                id_user: globals.getCookie("ID-USER"),
                posCursor: stage.getRelativePointerPosition(),
            };

            websocket.updatePosElementKonva(updatedAttrs)
        }, throttleLimit));
    });
}

updateElementsEvent();

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

        const attrsText = {
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
            id_unique: globals.generateID(),
        }

        GlobalFunctions.createTextInShape(attrsText, elementDrag)
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