import * as konva from "./KonvaLogic";
import * as globals from '../../js/frontend/utilities/globals';
import * as websocket from '../../js/websocket/actions'
import * as req from '../../js/backend/requests'
import * as CustomCursor from '../ts/shapes/CustomCursor'
import Konva from "konva";
import * as States from "./StatesLogic";
import * as environment_utils from "../../js/globals/environment-utils";
import * as config from "../config";

let needsUpdate = false;
let isUpdateToolBar = false;
let nodeSelect = null;

export function downloadURI(uri, name) {
    var link = document.createElement('a');
    link.download = name;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return true;
}

export function findElementRecursively(container, id_unique) {
    for (let i = 0; i < container.children.length; i++) {
        const child = container.children[i];
        
        if (child.attrs.id_unique === id_unique) {
            return child;
        }
        
        if (child.nodeType === 'Group') {
            const foundInGroup = findElementRecursively(child, id_unique);
            if (foundInGroup) {
                return foundInGroup;
            }
        }
    }
    
    return null;
}

export function processStage(layersToHide, callback) {
    layersToHide.forEach(layerId => {
        const layer = konva.stage.findOne(`#${layerId}`);
        if (layer) {
            layer.visible(false);
        }
    });

    const dataURL = konva.stage.toDataURL();

    layersToHide.forEach(layerId => {
        const layer = konva.stage.findOne(`#${layerId}`);
        if (layer) {
            layer.visible(true);
        }
    });

    callback(dataURL);
}

export function updateDimensionStage() {
    let width = window.innerWidth;
    let height = window.innerHeight;

    if (document.fullscreenElement && document.fullscreenElement.id === "konva") {
        width = window.screen.width;
        height = window.screen.height;
    }

    konva.stage.width(width);
    konva.stage.height(height);
    konva.layer.batchDraw();
}

export function getLineGuideStops(skipShape) {
    var vertical = [0, konva.stage.width() / 2, konva.stage.width()];
    var horizontal = [0, konva.stage.height() / 2, konva.stage.height()];

    konva.stage.find('.shape').forEach((guideItem) => {
        if (guideItem === skipShape) {
            return;
        }
        var box = guideItem.getClientRect();
        vertical.push([box.x, box.x + box.width, box.x + box.width / 2]);
        horizontal.push([box.y, box.y + box.height, box.y + box.height / 2]);
    });
    return {
        vertical: vertical.flat(),
        horizontal: horizontal.flat(),
    };
}

export function getObjectSnappingEdges(node) {
    var box = node.getClientRect();
    var absPos = node.absolutePosition();

    return {
        vertical: [
            {
                guide: Math.round(box.x),
                offset: Math.round(absPos.x - box.x),
                snap: 'start',
            },
            {
                guide: Math.round(box.x + box.width / 2),
                offset: Math.round(absPos.x - box.x - box.width / 2),
                snap: 'center',
            },
            {
                guide: Math.round(box.x + box.width),
                offset: Math.round(absPos.x - box.x - box.width),
                snap: 'end',
            },
        ],
        horizontal: [
            {
                guide: Math.round(box.y),
                offset: Math.round(absPos.y - box.y),
                snap: 'start',
            },
            {
                guide: Math.round(box.y + box.height / 2),
                offset: Math.round(absPos.y - box.y - box.height / 2),
                snap: 'center',
            },
            {
                guide: Math.round(box.y + box.height),
                offset: Math.round(absPos.y - box.y - box.height),
                snap: 'end',
            },
        ],
    };
}

export function getGuides(lineGuideStops, itemBounds) {
    var resultV = [];
    var resultH = [];

    lineGuideStops.vertical.forEach((lineGuide) => {
        itemBounds.vertical.forEach((itemBound) => {
            var diff = Math.abs(lineGuide - itemBound.guide);
            if (diff < konva.getGuideline()) {
                resultV.push({
                    lineGuide: lineGuide,
                    diff: diff,
                    snap: itemBound.snap,
                    offset: itemBound.offset,
                });
            }
        });
    });

    lineGuideStops.horizontal.forEach((lineGuide) => {
        itemBounds.horizontal.forEach((itemBound) => {
            var diff = Math.abs(lineGuide - itemBound.guide);
            if (diff < konva.getGuideline()) {
                resultH.push({
                    lineGuide: lineGuide,
                    diff: diff,
                    snap: itemBound.snap,
                    offset: itemBound.offset,
                });
            }
        });
    });

    var guides = [];

    var minV = resultV.sort((a, b) => a.diff - b.diff)[0];
    var minH = resultH.sort((a, b) => a.diff - b.diff)[0];
    if (minV) {
        guides.push({
            lineGuide: minV.lineGuide,
            offset: minV.offset,
            orientation: 'V',
            snap: minV.snap,
        });
    }
    if (minH) {
        guides.push({
            lineGuide: minH.lineGuide,
            offset: minH.offset,
            orientation: 'H',
            snap: minH.snap,
        });
    }
    return guides;
}

export function drawGuides(guides) {
    guides.forEach((lg) => {
        if (lg.orientation === 'H') {
            var line = new Konva.Line({
                points: [-6000, 0, 6000, 0],
                stroke: 'rgb(0, 161, 255)',
                strokeWidth: 1,
                name: 'guid-line',
                dash: [4, 6],
            });
            konva.layer.add(line);
            line.absolutePosition({
                x: 0,
                y: lg.lineGuide,
            });
        } else if (lg.orientation === 'V') {
            var line = new Konva.Line({
                points: [0, -6000, 0, 6000],
                stroke: 'rgb(0, 161, 255)',
                strokeWidth: 1,
                name: 'guid-line',
                dash: [4, 6],
            });
            konva.layer.add(line);
            line.absolutePosition({
                x: lg.lineGuide,
                y: 0,
            });
        }
    });
}

export function randomId(){
    return Math.random().toString(36).substr(2, 9);
}

export function findElementByIdUnique(node, id_unique) {
    if (node.attrs && node.attrs.id_unique === id_unique) {
        return node;
    }

    if (node.hasChildren && node.hasChildren()) {
        const children = node.getChildren();
        for (let i = 0; i < children.length; i++) {
            const found = findElementByIdUnique(children[i], id_unique);
            if (found) {
                return found;
            }
        }
    }

    return null;
}

export function getSvgString(svgElement){
    var svgString = new XMLSerializer().serializeToString(svgElement);
    var decoded = unescape(encodeURIComponent(svgString));
    var base64 = btoa(decoded);
    return `data:image/svg+xml;base64,${base64}`
}

export function createCursorCustom(fill, stroke){
    const svgElement = konva.getCursorCustom();
    const svgDataUrl = getSvgString(svgElement);

    konva.stage.container().style.cursor = svgElement ? `url(${svgDataUrl}), auto` : "move";
}

export function createElement(elementKonva, trActive = true){
    if(elementKonva){
        konva.getElements().push(elementKonva);
        konva.layer.add(elementKonva);

        Object.keys(States.StatesShapes).forEach(key => {
            States.StatesShapes[key] = false;
        });

        States.StatesCursor.addShape = false;
        
        if(trActive){
            const collaborator = environment_utils.getCollaboratorOfProject(konva.id_stage, globals.getCookie("ID-USER"));
            collaborator.elements_created += 1;
            environment_utils.setCollaboratorOfProject(konva.id_stage, globals.getCookie("ID-USER"), collaborator); 

            konva.tr?.setAttr("visible", true);
            konva.tr?.nodes([elementKonva]);
        }

        konva.updateElementsEvent();
    }
}

export function deleteElement(element){
    konva.setElements(konva.getElements().filter(item => item.attrs.id_unique !== element.attrs.id_unique));
    element.destroy();
    konva.layer.batchDraw();

    const collaborator = environment_utils.getCollaboratorOfProject(konva.id_stage, globals.getCookie("ID-USER"));
    collaborator.elements_deleted += 1;
    environment_utils.setCollaboratorOfProject(konva.id_stage, globals.getCookie("ID-USER"), collaborator);
}

export function createElementKonva(elementKonva, attrs){
    const className = elementKonva.className;
    const options = attrs ?? elementKonva.attrs;

    if(className == "Rect"){
        const rect = new Konva.Rect(options);
        createElement(rect, false);
    }

    if(className == "Circle"){
        const circle = new Konva.Circle(options);
        createElement(circle, false);
    }

    if(className == "RegularPolygon"){
        const regularPolygon = new Konva.RegularPolygon(options);
        createElement(regularPolygon, false);
    }

    if(className == "Text"){
        const text = new Konva.Text(options);
        createElement(text, false);
    }
}

export function deleteElementKonva(elementKonva){
    const element = konva.getElements().find(item => item.attrs.id_unique === elementKonva.attrs.id_unique);

    if(element){
        element.remove();
        konva.layer.draw();
    }
}

export function moveUpElementKonva(elementKonva){
    const element = konva.getElements().find(item => item.attrs.id_unique === elementKonva.attrs.id_unique);

    if(element){
        element.moveUp();
        konva.layer.draw();
    }
}

export function moveDownElementKonva(elementKonva){
    const element = konva.getElements().find(item => item.attrs.id_unique === elementKonva.attrs.id_unique);

    if(element){
        element.moveDown();
        konva.layer.draw();
    }
}

export function createCursorCollaborator(collaborator){
    const svgElement = konva.getCursorCustom();
    svgElement.setAttribute("fill", collaborator.color.hex);
    const svgDataUrl = getSvgString(svgElement);

    const configCursor = {
        fill: collaborator.color.hex,
        id: "mouseCursor",
        id_user: collaborator.user_id,
        string_svg: svgDataUrl,
        margin: {
            top: 5,
            left: 2.5,
            right: 0,
            bottom: 0,
        }
    }

    const configName = {
        name_user: collaborator.name,
        font_size: 14,
        padding: {
            top: 2.5,
            left: 5,
            right: 5,
            bottom: 2.5,
        },
    }

    const configGlobal = {
        configCursor,
        configName,
    }
    
    const customCursor = new CustomCursor.CustomCursor(configGlobal, konva.layerCollaborators, konva.stage)
    customCursor.initCursor();
    konva.setCursorCollaborators(customCursor);
}

export function removeCursorCollaborator(id_user){
    konva.getCursorCollaborators().forEach((cursor) => {
        if(cursor.id_user == id_user){
            cursor.removeCursor();
        }
    });
}

export function updateCursorCollaborator({x, y}, id_user){
    if(!konva.getCursorCollaborators) return;

    konva.getCursorCollaborators().forEach((cursor) => {
        if(cursor.id_user == id_user){
            cursor.updateCursor({x, y});
        }
    });
}

export function detectedMouseMove(){
    konva.stage.on("mousemove", (e) => {
        const pos = konva.stage.getRelativePointerPosition();
        const x = pos.x;
        const y = pos.y;
        websocket.updateMouseCursor({x, y}, globals.getCookie("ID-USER"));
    })
}

export function getCursorCollaborator(id_user){
    const elementsById = konva.layer.find(item => item.id() === "mouseCursor");

    if(!elementsById){
        return null;
    }

    return elementsById.find(item => item.getAttr("id_user") == id_user);
}

export function setBorderElement(element, collaborator) {
    removeBorderElement();
    konva.setElementSelectedCollaborators(element);
    const beforeStroke = element.stroke();
    const beforeStrokeWidth = element.strokeWidth();

    element.setAttrs({
        stroke: collaborator ? collaborator.color.hex : "rgb(0, 161, 255)",
        strokeWidth: 3,
        beforeStroke,
        beforeStrokeWidth,
    });
}

export function removeBorderElement() {
    const elementSelectedList = konva.getElementSelectedCollaborators();

    if (!elementSelectedList) return;
    
    elementSelectedList.forEach((element) => {
        element.setAttrs({
            stroke: element.getAttr("beforeStroke") || "white",
            strokeWidth: element.getAttr("beforeStrokeWidth") || 2,
        });

        konva.layer.draw();
    });
}

export function updateBoundingRect(rect, nodes) {
    let maxX = -Infinity, maxY = -Infinity, minX = Infinity, minY = Infinity;

    nodes.forEach(node => {
        let box = node.getClientRect({ relativeTo: konva.stage });

        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
    });

    rect.position({ x: minX, y: minY });
    rect.size({ width: maxX - minX, height: maxY - minY });
    konva.layer.batchDraw();
}

function updateElement() {
    if (needsUpdate) {
        konva.layer.batchDraw();
        needsUpdate = false;
    }
    if (needsUpdate) {
        requestAnimationFrame(updateElement);
    }
}

requestAnimationFrame(updateElement);

export function changeElement(element, updatedAttrs, user_id, posRelativePointer, collaborator) {
    element.setAttrs(updatedAttrs);
    setBorderElement(element, collaborator);
    updateCursorCollaborator(posRelativePointer, user_id);
    hiddenToolBarShape();
    konva.layer.batchDraw();
    needsUpdate = true;
}

export function updateAttrsElement(element, updatedAttrs){
    if(!updatedAttrs.data.isGroup){
        element.setAttrs(updatedAttrs.data);
        konva.layer.batchDraw();
        return
    }

    element.children.forEach(child => {
        const attrsChild = updatedAttrs.data.childAttrs.find(item => item.id_unique == child.attrs.id_unique)
        child.setAttrs(attrsChild);
    })
}

export function getNodeSelectToolBar(){
    return nodeSelect;
}

export function setUpdateToolBar(state){
    isUpdateToolBar = state;
    showBarTool(nodeSelect);
}

export function adjustDropdownPositions(barToolRect, headerHeight) {
    const dropdownDimension = konva.getDimensionDropdown();

    if(!dropdownDimension) return;

    const rectReference = document.createElement("span")
    rectReference.style.position = "absolute"
    document.querySelector("body").appendChild(rectReference)

    const yPositionDropdown = barToolRect.y - dropdownDimension.height;
    const yPosition = yPositionDropdown <= headerHeight ? barToolRect.height + dropdownDimension.height : -barToolRect.height / 2
    rectReference.style.top = `${yPositionDropdown}px`
    dropdownDimension.element.style.top = `${yPosition}px`

    rectReference.remove();
}

function updateToolBarState(attrsNode){
    const customEvent = new CustomEvent("updateToolBar", {
        detail: {attrs: attrsNode},
    });

    document.dispatchEvent(customEvent);
}

function updateContextMenuState(nodeElement){
    const customEvent = new CustomEvent("updateContextMenu", {
        detail: {node: nodeElement},
    });

    document.dispatchEvent(customEvent);
}

const UMBRAL_SEPARATION = 10;
let NODE_SELECTION_CONTEXT_MENU = null;
let updatePending = false;

let contextMenu = document.querySelector("#contextMenu");

function performUpdate(element) {
    if(!contextMenu) {
        contextMenu = document.querySelector("#contextMenu");
    }

    if (!element || !contextMenu) return;

    if (element instanceof Konva.Group) {
        element = element.findOne('Rect');
    }

    NODE_SELECTION_CONTEXT_MENU = element;

    const { x, y, width, height } = element.getClientRect();
    const { width: menuWidth } = contextMenu.getBoundingClientRect();
    const stageWidth = konva.stage.width();

    const position = {
        x: x + width + menuWidth + UMBRAL_SEPARATION >= stageWidth
            ? x - menuWidth - UMBRAL_SEPARATION
            : x + width + UMBRAL_SEPARATION,
        y: y + height / 2
    };

    Object.assign(contextMenu.style, {
        top: `${position.y}px`,
        left: `${position.x}px`
    });

    updatePending = false;
}

export function updateDimensionContextMenu(element) {
    if (!updatePending) {
        updatePending = true;
        requestAnimationFrame(() => performUpdate(element || NODE_SELECTION_CONTEXT_MENU));
    }
}

export function hiddenContextMenu() {
    if(!contextMenu) {
        contextMenu = document.querySelector("#contextMenu");
    }

    if(!contextMenu) return;

    contextMenu.style.display = "none";
}

export function showContextMenu(element) {
    if(!contextMenu) {
        contextMenu = document.querySelector("#contextMenu");
    }

    if(!contextMenu) return;

    contextMenu.style.display = "flex";

    konva.stage.on("wheel dragmove", () => {
        updateDimensionContextMenu();
    });

    updateContextMenuState(element);
    updateDimensionContextMenu(element || NODE_SELECTION_CONTEXT_MENU);
}

export function showBarTool(nodes) {
    const barTool = document.querySelector("#BarTool");
    const dropdown = barTool.querySelector(".dropdown-tool-bar")

    if(dropdown){
        const rect = dropdown.getBoundingClientRect();
        const dimensionRect = {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left,
            element:  dropdown,
        }
        konva.setDimensionDropdown(dimensionRect);
        adjustDropdownPositions(document.querySelector("#BarTool").getBoundingClientRect(), document.querySelector("#header-konva").getBoundingClientRect().height)
    }

    const stage = konva.stage;
    let target = States.StatesCursor.select;
    let boundingRect;

    if (!target && (!nodes || nodes.length === 0)) return;

    if (nodes && nodes.length > 0) {
        boundingRect = createBoundingRectForNodes(nodes);
        target = boundingRect;
    } else {
        initializeBarTool(target, barTool);
    }

    nodeSelect = target;
    let attrsSend = {
        fontStyle: null,
        fontFamily: null,
        fontSize: null,
        textDecoration: null,
        align: null,
        fill: null,
        type: [],
    }
    if(isGroupText(nodeSelect)){
        const textNode = isGroupText(nodeSelect);
        attrsSend["fontStyle"] = textNode.fontStyle();
        attrsSend["fontFamily"] = textNode.fontFamily();
        attrsSend["fontSize"] = textNode.fontSize();
        attrsSend["textDecoration"] = textNode.textDecoration();
        attrsSend["align"] = textNode.align();
        attrsSend["type"].push(textNode.className);
    }

    attrsSend["fill"] = target.fill();
    attrsSend["type"].push(target.className);
    updateToolBarState(attrsSend);

    updateToolBarShape();
    initializeBarTool(target, barTool);
    setUpEventListeners(target, barTool, stage, nodes);

    function createBoundingRectForNodes(nodes) {
        const boundingRect = new Konva.Rect({
            fill: 'rgba(0, 255, 0, .1)',
            strokeWidth: 1,
            listening: false,
            id: "boundingRect",
        });

        konva.layer.add(boundingRect);
        updateBoundingRect(boundingRect, nodes);
        konva.layer.draw();

        konva.tr.on("dragmove transform", () => {
            target.setAttr("barToolSelected", true);
            updateBoundingRect(boundingRect, nodes);
            updateToolBar(target, barTool);
        });

        stage.on("dragmove wheel", () => {
            target.setAttr("barToolSelected", true);
            updateBoundingRect(boundingRect, nodes);
            updateToolBar(target, barTool);
        })

        return boundingRect;
    }

    function initializeBarTool(target, barTool) {
        if(!barTool) return;

        target.setAttr("barToolSelected", true);
        barTool.style.display = "flex"
        updateToolBar(target, barTool);
    }

    function setUpEventListeners(target, barTool, stage, nodes) {
        target.on("dragstart", () => onDragStart(target, barTool));
        target.on("dragmove, transform", () => updateToolBar(target, barTool));
        target.on("dragend", () => onDragEnd(target, barTool));
        stage.on("wheel", () => updateToolBar(target, barTool));
        stage.on("dragmove transform", () => updateToolBar(target, barTool));
        stage.on("click tap", (e) => onStageClick(e, target, barTool, nodes));
    }

    function onDragStart(target, barTool) {
        if (!target.getAttr("barToolSelected")) return;
        barTool.style.display = "none"
        barTool.style.pointerEvents = "none";
    }

    function onDragEnd(target, barTool) {
        if (!target.getAttr("barToolSelected")) return;
        barTool.style.display = "flex"
        barTool.style.pointerEvents = "auto";
        updateToolBar(target, barTool);
    }

    function onStageClick(e, target, barTool, nodes) {
        if(e.target instanceof Konva.Stage){
            hiddenToolBarShape();
            boundingRect?.destroy();
            return;
        }

        target = config.getBarElementSelected() != e.target ? e.target : target;

        if(nodes){
            target = boundingRect;
        }

        config.setBarElementSelected(target);
        updateToolBar(target, barTool);
    }

    function updateToolBar(target, barTool){
        requestAnimationFrame(() => {
            updateBarToolPosition(target, barTool);
        });
    }

    function updateBarToolPosition(target, barTool) {
        if (!target.getAttr("barToolSelected")) return;
    
        const stage = konva.stage;
        const targetRect = target.getClientRect();
        const barToolRect = barTool.getBoundingClientRect();
        const headerHeight = document.querySelector("#header-konva").getBoundingClientRect().height;

        const barToolDimensions = calculateBarToolDimensions(barTool, barToolRect, stage);
        const barToolPosition = calculateBarToolPosition(targetRect, barToolDimensions, headerHeight);
    
        applyBarToolStyles(barTool, barToolPosition, barToolDimensions);
        adjustDropdownPositions(barToolRect, headerHeight);
    }
    
    function calculateBarToolDimensions(barTool, barToolRect, stage) {
        const computedStyle = window.getComputedStyle(barTool);
        return {
            width: parseFloat(computedStyle.width) || barToolRect.width || 0,
            height: parseFloat(computedStyle.height) || barToolRect.height || 0,
            originalWidth: konva.getWidthBarTool(),
            originalHeight: konva.getHeightBarTool(),
            scaleX: Math.min(Math.max(stage.scaleX(), 0.5), 0.6),
            scaleY: Math.min(Math.max(stage.scaleY(), 0.4), 0.5)
        };
    }
    
    function calculateBarToolPosition(targetRect, barToolDimensions, headerHeight) {
        const xPosition = targetRect.x - barToolDimensions.width / 2 + targetRect.width / 2;
        const yPosition = targetRect.y - barToolDimensions.height - 10;
    
        return {
            x: clamp(xPosition, 0, window.innerWidth - barToolDimensions.width),
            y: clamp(yPosition, headerHeight + barToolDimensions.height / 2, window.innerHeight - barToolDimensions.height - headerHeight)
        };
    }
    
    function applyBarToolStyles(barTool, position, dimensions) {
        // barTool.style.display = "flex";
        barTool.style.left = `${position.x}px`;
        barTool.style.top = `${position.y}px`;
        barTool.style.width = `${dimensions.originalWidth * dimensions.scaleX}px`;
        barTool.style.height = `${dimensions.originalHeight * dimensions.scaleY}px`;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
}

export function updateToolBarShape() {
    let node = isGroupText(nodeSelect) ? isGroupText(nodeSelect) : nodeSelect;

    updateToolBarButtons(node);
    updateToolBarFont(node);
    updateBarToolExtra(node);
}

export function hiddenToolBarShape(){
    const barTool = document.querySelector("#BarTool");
    barTool.style.display = "none";
}

function updateToolBarButtons(node) {
    const toolBarButtonAction = document.querySelectorAll("#tool_bar_button_action");

    toolBarButtonAction.forEach((item) => {
        const dataTypeButton = item ? item.getAttribute("data-type") : "default";
        const dataValueButton = item ? item.getAttribute("data-value") : "default";

        const attrNode = node.getAttr(dataTypeButton);

        if (dataValueButton == attrNode) {
            item.style.backgroundColor = "rgb(251, 127, 83)";
            actionToolBar(dataValueButton, dataTypeButton);
        } else {
            item.style.backgroundColor = "transparent";
        }
    });
}

function updateToolBarFont(node) {
    // Actualiza el font family si el nodo es un texto
    const toolBarFontFamily = document.querySelector("#BarToolFontFamily");
    if (toolBarFontFamily && node instanceof Konva.Text) {
        toolBarFontFamily.value = node.fontFamily();
        actionToolBar(toolBarFontFamily.value, "fontFamily");
    }

    // Actualiza el font size si el nodo es un texto
    const toolBarFontSize = document.querySelector("#BarToolFontSize");
    if (toolBarFontSize && node instanceof Konva.Text) {
        toolBarFontSize.value = node.fontSize();
        actionToolBar(toolBarFontSize.value, "fontSize");
    }
}

function updateBarToolExtra(node) {
    const BarToolExtraList = document.querySelectorAll("#BarToolExtra");

    BarToolExtraList.forEach((item) => {
        const dataTypeItem = item.getAttribute("data-type");
        const newDataTypeItem = dataTypeItem == "color" ? "fill" : dataTypeItem;

        const inputColor = item.querySelectorAll(`#input_${dataTypeItem}`);
        let findColor = false;

        inputColor.forEach((color) => {
            const fillColor = color.getAttribute(`data-${newDataTypeItem}`);

            if (dataTypeItem == "border") {
                node = nodeSelect;
            }else{
                node = isGroupText(nodeSelect) ? isGroupText(nodeSelect) : nodeSelect;
            }

            // Maneja selección de color o borde
            findColor = handleColorSelection(node, color, inputColor, fillColor, dataTypeItem, newDataTypeItem);

            if(dataTypeItem == "color"){
                // Si no se encuentra color, establece el color personalizado por defecto
                if (!findColor) {
                    // resetCustomColor(inputColor, newDataTypeItem);
                }
            }

        });


    });
}

function handleColorSelection(node, color, inputColor, fillColor, dataTypeItem, newDataTypeItem) {
    let findColor = false;

    if (node.getAttr(newDataTypeItem) == fillColor) {
        findColor = true;

        if (dataTypeItem == "color") {
            color.style.borderColor = "rgba(251, 127, 83)";
            resetOtherColors(inputColor, color, "borderColor");
        } else {
            color.style.backgroundColor = "rgba(251, 127, 83)";
            resetOtherColors(inputColor, color, "backgroundColor", "rgba(30,30,30,.9)");
        }
    }

    return findColor;
}

function resetOtherColors(inputColor, selectedColor, property, resetValue = "transparent") {
    inputColor.forEach((colorChild) => {
        if (colorChild !== selectedColor) {
            colorChild.style[property] = resetValue;
        }
    });
}

function resetCustomColor(inputColor, newDataTypeItem) {
    inputColor.forEach((color) => {
        if (color.getAttribute(`data-${newDataTypeItem}`) == "custom") {
            color.style.borderColor = "rgba(251, 127, 83)";
        } else {
            color.style.borderColor = "transparent";
        }
    });
}

export function createTextInShape(attrs, elementDrag, isSelected = false){
    document.querySelector("#edit-text-collaborator")?.remove();
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
            id_unique: globals.generateID(),
            name: "ShapeText"
        });
        
        konva.layer.add(group);
        konva.setElements([...konva.getElements(), group]);
    }

    group.add(elementDrag);
    group.add(new Konva.Text(attrs));

    konva.layer.draw();
    konva.updateElementsEvent();

    if(isSelected){
        konva.tr.show();
        konva.tr.forceUpdate();
        konva.tr.moveToTop();
        konva.tr.nodes(group.getChildren());
        konva.setSelectAll(true)
    }
    States.StatesCursor.textEditing = undefined;

    let isTextFind = false
    group.getChildren().forEach(item => {
        if (item instanceof Konva.Text) {
            isTextFind = true;

            item.setAttrs({
                width: Math.max(5, group.getChildren().find(item => item instanceof Konva.Rect).width() * group.getChildren().find(item => item instanceof Konva.Rect).scaleX(), konva.getMinWidth()), 
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
}

export function isGroupText(node){
    let returnNode = false
    if(node.parent instanceof Konva.Group){
        node.parent.getChildren().forEach((item) => {
            if(item instanceof Konva.Text){
                returnNode = item;
                return;
            }
        })
    }

    return returnNode;
}

export function actionToolBar(change, type, action, nodeChange){
    websocket.changeElementKonva({change: change, type: type, action: action, node: (nodeChange ?? nodeSelect)}, konva.stage.getRelativePointerPosition());
}

export function setAttrOfAction(change, type, action, nodeChange){
    const isAvailable = type != "fill" && type != "border"
    let node = isGroupText((nodeChange ?? nodeSelect)) && isAvailable ? isGroupText((nodeChange ?? nodeSelect)) : (nodeChange ?? nodeSelect);
    let extra;

    if(node.getAttr(type) == change && action){
        change = null
    }

    change = parseFloat(change) ? parseFloat(change) : change;

    if(type == "border"){
        node = nodeChange || nodeSelect;

        if(change == "dash"){
            change = [10, 5];
            type = "dash";
            extra = {
                stroke: node.stroke() || "white",
                strokeWidth: 2,
                border: "dash",
            }
        }

        if(change == "normal"){
            change = null;
            type = null;
            extra = {
                dash: null,
                stroke: node.stroke() || "white",
                strokeWidth: 2,
                border: "normal",
            }
        }

        if(change == "none"){
            change = null;
            type = null;
            extra = {
                dash: null,
                stroke: null,
                strokeWidth: null,
                border: "none",
            }
        }
    }

    if (type === 'fontStyle' && change === 'strikethrough') {
        const currentDecoration = node.textDecoration() || '';
        if (currentDecoration.includes('line-through')) {
          node.textDecoration(currentDecoration.replace('line-through', '').trim());
        } else {
          node.textDecoration((currentDecoration + ' line-through').trim());
        }
    }

    if (type === 'textColor') {
        node.fill(change);
    }

    const newAttrs = {
        [type]: change,
        id_unique: node.getAttr("id_unique"),
        ...extra
    }

    node.setAttrs(newAttrs)
    konva.layer.draw();
}