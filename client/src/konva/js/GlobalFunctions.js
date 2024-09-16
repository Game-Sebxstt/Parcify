import * as konva from "./KonvaLogic";
import * as globals from '../../js/frontend/utilities/globals';
import * as websocket from '../../js/backend/websocket'
import * as CustomCursor from '../ts/shapes/CustomCursor'
import Konva from "konva";
import * as States from "./StatesLogic";
import Export from "../../components/Konva/Export.astro";

export function downloadURI(uri, name) {
    var link = document.createElement('a');
    link.download = name;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return true;
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

export function createElement(elementKonva, trActive = true){
    if(elementKonva){
        konva.getElements().push(elementKonva);
        konva.layer.add(elementKonva);

        Object.keys(States.StatesShapes).forEach(key => {
            States.StatesShapes[key] = false;
        });

        States.StatesCursor.addShape = false;
        
        if(trActive){
            konva.tr?.setAttr("visible", true);
            konva.tr?.nodes([elementKonva]);
        }

        konva.updateElementsEvent();
    }
}

export function createElementKonva(elementKonva){
    console.log(elementKonva);
    const className = elementKonva.className;
    const options = elementKonva.attrs;

    if(className == "Rect"){
        const rect = new Konva.Rect(options);
        createElement(rect, false);
    }

    if(className == "Circle"){
        const circle = new Konva.Circle(options);
        console.log(circle);
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

export function createCursorCollaborator(collaborator){
    const cursorById = konva.layer.find(item => item.id() === "mouseCursor");
    if(cursorById.find(item => item.getAttr("id_user") == collaborator.user_id)) return;

    const options = {
        x: 0,
        y: 0,
        radius: 10,
        fill: collaborator.color.hex,
        stroke: 'white',
        strokeWidth: 1,
        draggable: false,
        id: "mouseCursor",
        id_user: collaborator.user_id,
        visible: false,
        name_user: collaborator.name,
        font_size: 20,
    }
    
    const customCursor = new CustomCursor.CustomCursor(options, konva.layerCollaborators, konva.stage)
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

export function setBorderElement(element) {
    removeBorderElement();
    konva.setElementSelectedCollaborators(element);
    const beforeStroke = element.stroke();
    const beforeStrokeWidth = element.strokeWidth();
    element.setAttrs({
        stroke: "rgb(0, 161, 255)",
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
            stroke: element.getAttr("beforeStroke"),
            strokeWidth: element.getAttr("beforeStrokeWidth"),
        });

        konva.layer.draw();
    });
}

export function changeElement(element, elementKonva, user_id, posRelativePointer) {    
    const attrs_replace = elementKonva.attrs;
    element.setAttrs(attrs_replace);
    updateCursorCollaborator(posRelativePointer, user_id);
    setBorderElement(element);
    konva.layer.draw();
}

let isUpdateToolBar = false;
let nodeSelect = null;

export function getNodeSelectToolBar(){
    return nodeSelect;
}

export function setUpdateToolBar(state){
    isUpdateToolBar = state;
    showBarTool(nodeSelect);
}

export function showBarTool(nodes) {
    const barTool = document.querySelector("#BarTool");
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
    konva.picker.updateNodeSelect(nodeSelect);

    updateToolBarShape();
    initializeBarTool(target, barTool);
    setUpEventListeners(target, barTool, stage, nodes);

    function createBoundingRectForNodes(nodes) {
        const boundingRect = new Konva.Rect({
            fill: 'rgba(0, 255, 255, 0)',
            strokeWidth: 1,
            listening: false,
        });

        konva.layer.add(boundingRect);
        updateBoundingRect(boundingRect, nodes);
        konva.layer.draw();

        nodes.forEach(node => {
            node.on("dragmove transform", () => {
                target.setAttr("barToolSelected", true);
                updateBoundingRect(boundingRect, nodes);
                updateToolBar(target, barTool);
            });
        });

        stage.on("dragmove wheel", () => {
            target.setAttr("barToolSelected", true);
            updateBoundingRect(boundingRect, nodes);
            updateToolBar(target, barTool);
        })

        return boundingRect;
    }

    function updateBoundingRect(rect, nodes) {
        let maxX = 0, maxY = 0, minX = Infinity, minY = Infinity;

        nodes.forEach(node => {
            const nodeX = node.x();
            const nodeY = node.y();

            if (nodeX + node.width() > maxX) maxX = nodeX + node.width();
            if (nodeY + node.height() > maxY) maxY = nodeY + node.height();
            if (nodeX < minX) minX = nodeX;
            if (nodeY < minY) minY = nodeY;
        });

        rect.position({ x: minX, y: minY });
        rect.size({ width: maxX - minX, height: maxY - minY });
    }

    function initializeBarTool(target, barTool) {
        target.setAttr("barToolSelected", true);
        barTool.style.display = "flex"
        updateToolBar(target, barTool);
    }

    function nodeContainText(){
        if(!nodeSelect.parent instanceof Konva.Group) return false;

        let isContain = false;

        nodeSelect.parent.getChildren().forEach((item) => {
            if(item instanceof Konva.Text){
                isContain = true;
            }
        })

        return isContain;
    }

    function setUpEventListeners(target, barTool, stage, nodes) {
        target.on("dragstart", () => onDragStart(target, barTool));
        target.on("dragmove transform", () => updateToolBar(target, barTool));
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
        if (e.target !== target) {
            target.setAttr("barToolSelected", false);
            let isNodeElement = false;

            if (nodes && nodes.length > 0 && boundingRect) {
                nodes.forEach(node => {
                    if (node === e.target) {
                        isNodeElement = true;
                    }
                });

                if (!isNodeElement) {
                    boundingRect.destroy();
                    konva.layer.draw();
                } else {
                    barTool.style.display = "flex"
                    barTool.style.pointerEvents = "auto";
                }
            }

            if (e.target instanceof Konva.Stage) {
                barTool.style.display = "none"
                barTool.style.pointerEvents = "none";
            }
        } else {
            updateToolBar(target, barTool);
        }
    }

    function updateToolBar(target, barTool){
        requestAnimationFrame(() => {
            updateBarToolPosition(target, barTool);
        });
    }

    function updateBarToolPosition(target, barTool) {
        if (!target.getAttr("barToolSelected")) return;

        // barTool.childNodes.forEach((item) => {
        //     let idItem = item.id;
        //     if(!idItem) return;

        //     idItem = idItem.split("_").filter((item) => item == "font");

        //     if(idItem.length > 0){
        //         if(nodeContainText()){
        //             item.style.display = "flex";
        //             document.querySelectorAll("#sep").forEach(item => {
        //                 item.style.display = "flex";
        //             })
        //         }else{
        //             item.style.display = "none";
        //             document.querySelectorAll("#sep").forEach(item => {
        //                 item.style.display = "none";
        //             })
        //         }
        //     }
        // })

        const { x, y } = target.absolutePosition();
        const scaleX = target.scaleX() * stage.scaleX();
        const scaleY = target.scaleY() * stage.scaleY();
        const width = target instanceof Konva.Rect || target instanceof Konva.Text ? target.width() * scaleX : target.radius() * scaleX;
        const height = target instanceof Konva.Rect || target instanceof Konva.Text ? target.height() * scaleY : target.radius() * scaleY;
    
        const barToolRect = barTool.getBoundingClientRect();
        const barToolShape = {
            width: parseFloat(window.getComputedStyle(barTool).width) || barToolRect.width || 0,
            height: parseFloat(window.getComputedStyle(barTool).height) || barToolRect.height || 0,
            originalWidth: konva.getWidthBarTool(),
            originalHeight: konva.getHeightBarTool(),
            scaleX: Math.min(Math.max(stage.scaleX(), 0.5), 0.6),
            scaleY: Math.min(Math.max(stage.scaleY(), 0.4), 0.5),
            x: barToolRect.left,
            y: barToolRect.top,
        };

        let BarToolExtra = null;
        document.querySelectorAll("#BarToolExtra").forEach(child => {
            if (window.getComputedStyle(child).display !== "none") {
                BarToolExtra = child;
            }
        });
        
        const barToolHalfWidth = barToolRect.width / 2;
        const barToolHalfHeight = barToolRect.height / 2;
        let adjustedBarToolTop;
        let adjustedBarToolLeft;
    
        let topTarget, leftTarget;
        if (target instanceof Konva.Rect) {
            topTarget = y - height / 4;
            leftTarget = x - barToolHalfWidth + width / 2;
        } else {
            topTarget = y - barToolHalfHeight - height;
            leftTarget = x - barToolHalfWidth;
        }

        const headerHeight = parseFloat(window.getComputedStyle(document.querySelector("#header-konva")).height);
    
        if(BarToolExtra){
            const BarToolExtraRect = BarToolExtra.getBoundingClientRect();
            adjustedBarToolTop = BarToolExtraRect.y <= headerHeight ? konva.stage.height() : topTarget;
            adjustedBarToolLeft = BarToolExtraRect.x <= 0  ? barToolHalfHeight : leftTarget > window.innerWidth - barToolShape.width ? window.innerWidth - barToolShape.width - barToolHalfHeight : leftTarget;
        }else{
            adjustedBarToolTop = topTarget <= headerHeight ? konva.stage.height() : topTarget;
            adjustedBarToolLeft = leftTarget <= 0  ? barToolHalfHeight : leftTarget > window.innerWidth - barToolShape.width ? window.innerWidth - barToolShape.width - barToolHalfHeight : leftTarget;
        }
    
        barTool.style.display = "flex"
        barTool.style.pointerEvents = "auto";
        barTool.style.top = `${adjustedBarToolTop}px`;
        barTool.style.left = `${adjustedBarToolLeft}px`;
        barTool.style.width = `${barToolShape.originalWidth * barToolShape.scaleX}px`;
        barTool.style.height = `${barToolShape.originalHeight * barToolShape.scaleY}px`;
        barTool.style.border = `${1 * barToolShape.scaleX}px solid rgba(255, 255, 255, .2)`;
    
        // document.querySelector("#font_size").style.fontSize = `${14 * barToolShape.scaleX}px`;
        // document.querySelector("#font_family").style.fontSize = `${14 * barToolShape.scaleX}px`;
    
        if(!isUpdateToolBar) return;

        if (BarToolExtra) {
            const keyBarToolExtra = BarToolExtra.getAttribute("data-type")
            const BarToolExtraShape = {
                width: parseFloat(window.getComputedStyle(BarToolExtra).width) || BarToolExtra.width || 0,
                height: parseFloat(window.getComputedStyle(BarToolExtra).height) || BarToolExtra.height || 0,
                originalWidth: konva.getDimensionBarToolExtra(keyBarToolExtra).width,
                originalHeight: konva.getDimensionBarToolExtra(keyBarToolExtra).height,
            };

            BarToolExtra.style.height = `${BarToolExtraShape.originalHeight * barToolShape.scaleY}px`;
            BarToolExtra.style.border = `${1 * barToolShape.scaleX}px solid rgba(255, 255, 255, .2)`;
    
            document.querySelector("#nameBar").querySelector("#name").style.fontSize = `${24 * barToolShape.scaleX}px`;
    
            document.querySelector("#style_color").style.padding = `${8 * barToolShape.scaleX}px`;
            document.querySelector("#style_color").style.gap = `${8 * barToolShape.scaleX} 0px`;
    
            BarToolExtra.querySelectorAll("#input_color").forEach(child => {
                child.style.width = `${36 * barToolShape.scaleX}px`;
                child.style.height = `${36 * barToolShape.scaleX}px`;
                child.style.borderRadius = `${6 * barToolShape.scaleX}px`;
            });
        }
    }
}

export function updateToolBarShape() {
    let node = isGroupText(nodeSelect) ? isGroupText(nodeSelect) : nodeSelect;

    updateToolBarButtons(node);
    updateToolBarFont(node);
    updateBarToolExtra(node);
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

export function actionToolBar(change, type, action){
    let node = isGroupText(nodeSelect) ? isGroupText(nodeSelect) : nodeSelect;
    let extra;

    if(node.getAttr(type) == change && action){
        change = null
    }

    change = parseFloat(change) ? parseFloat(change) : change;

    if(type == "border"){
        node = nodeSelect;

        if(change == "dash"){
            change = [10, 5];
            type = "dash";
            extra = {
                stroke: node.stroke() || "white",
                strokeWidth: node.strokeWidth() || 2,
                border: "dash",
            }
        }

        if(change == "normal"){
            change = null;
            type = null;
            extra = {
                dash: null,
                stroke: node.stroke() || "white",
                strokeWidth: node.strokeWidth() || 2,
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

    node.setAttrs({
        [type]: change,
        ...extra
    })
    
    // websocket.changeElementKonva(node, konva.stage.getRelativePointerPosition());
    konva.layer.draw();
}