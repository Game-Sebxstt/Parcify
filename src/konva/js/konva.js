import Konva from "konva";
import _ from 'lodash'
import { downloadURI } from "./functions";
import { addShape } from "../ts/shapes";
import * as States from "./states";
import * as req from '../../js/backend/requests'

document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

let konva = document.querySelector("#konva");
let elements = [];
let groups = [];
let elementsLayerBackground = [];
let historySave = [];
let indexHistory = 0;
let widthKonva = Number(window.getComputedStyle(konva).width.split("px")[0]);
let heightKonva = Number(window.getComputedStyle(konva).height.split("px")[0]);

let attempsChange = 12;

var SCALEBY = 1.2;
var MAX_WIDTH = widthKonva;
var MIN_WIDTH = 20;
var X1, Y1, X2, Y2;
var SELECTING = false;
var SELECTALL = true;
var ISDRAG = false;
var LIMIT_MOVEMENT = 10;
var GUIDELINE_OFFSET = 5;

let stage;

if(localStorage.getItem("STAGEJSON")){
    stage = Konva.Node.create(JSON.parse(localStorage.getItem("STAGEJSON")), 'konva');
} else {
    stage = new Konva.Stage({
        container: 'konva',
        width: widthKonva,
        height: heightKonva,
        draggable: false,
    });
}

stage.stopDrag();

var layer = stage.getLayers().find(item => item.attrs.id == "layer") || new Konva.Layer({
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

let bg = layerBackground.getChildren().find(item => item.attrs.id == "bg") ||  new Konva.Rect({
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

var tr = layer.getChildren().find(item => item.attrs.id == "transformer") || new Konva.Transformer({
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

var selectionRectangle = layer.getChildren().find(item => item.attrs.id == "selection") ||  new Konva.Rect({
    fill: 'rgba(252,127,83, .4)',
    visible: false,
    listening: false,
    id: "selection"
});

if(!layer.getChildren().find(item => item.attrs.id == "selection")){
    layer.add(selectionRectangle);
}

saveHistory(stage.toJSON());

// let grid = new Konva.Layer();

// let size = 12;
// let width = stage.width();
// let height = stage.height();
// let x = 0;
// let y = 0;

// for (let i = 0; i < width / size; i++) {
//     for (let j = 0; j < height / size; j++) {
//         let point = new Konva.Circle({
//             x: x,
//             y: y,
//             radius: 0.25,
//             fill: 'white',
//             listening: false,
//         });
//         grid.add(point);
//         y += size;
//     }
//     y = 0;
//     x += size;
// }

// grid.zIndex(0);
// stage.add(grid);

function moveLimit(){
    // elements.forEach(item => {
    //     item.on("dragmove", () => {
    //         let x = item.x();
    //         let y = item.y();

    //         let moveX = x % LIMIT_MOVEMENT;
    //         let moveY = y % LIMIT_MOVEMENT;

    //         if(moveX != 0){
    //             item.setAttr("x", x + (LIMIT_MOVEMENT - moveX))
    //         }

    //         if(moveY != 0){
    //             item.setAttr("y", y + (LIMIT_MOVEMENT - moveY))
    //         }
    //     });

    //     //resize limit width and height
    //     item.on("transform", () => {
    //         let width = item.width();
    //         let height = item.height();

    //         let moveWidth = width % LIMIT_MOVEMENT;
    //         let moveHeight = height % LIMIT_MOVEMENT;

    //         if(moveWidth != 0){
    //             item.setAttr("width", width + (LIMIT_MOVEMENT - moveWidth))
    //         }

    //         if(moveHeight != 0){
    //             item.setAttr("height", height + (LIMIT_MOVEMENT - moveHeight))
    //         }
    //     });

    // });

    // //Movimiento pero de grupos

    // groups.forEach(item => {
    //     item.on("dragmove", () => {
    //         let x = item.x();
    //         let y = item.y();

    //         let moveX = x % LIMIT_MOVEMENT;
    //         let moveY = y % LIMIT_MOVEMENT;

    //         if(moveX != 0){
    //             item.setAttr("x", x + (LIMIT_MOVEMENT - moveX))
    //         }

    //         if(moveY != 0){
    //             item.setAttr("y", y + (LIMIT_MOVEMENT - moveY))
    //         }
    //     });
    // });

    // layer.batchDraw();
}

function getLineGuideStops(skipShape) {
    var vertical = [0, stage.width() / 2, stage.width()];
    var horizontal = [0, stage.height() / 2, stage.height()];

    stage.find('.shape').forEach((guideItem) => {
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

function getObjectSnappingEdges(node) {
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

function getGuides(lineGuideStops, itemBounds) {
    var resultV = [];
    var resultH = [];

    lineGuideStops.vertical.forEach((lineGuide) => {
        itemBounds.vertical.forEach((itemBound) => {
            var diff = Math.abs(lineGuide - itemBound.guide);
            if (diff < GUIDELINE_OFFSET) {
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
            if (diff < GUIDELINE_OFFSET) {
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

function drawGuides(guides) {
    guides.forEach((lg) => {
        if (lg.orientation === 'H') {
            var line = new Konva.Line({
                points: [-6000, 0, 6000, 0],
                stroke: 'rgb(0, 161, 255)',
                strokeWidth: 1,
                name: 'guid-line',
                dash: [4, 6],
            });
            layer.add(line);
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
            layer.add(line);
            line.absolutePosition({
                x: lg.lineGuide,
                y: 0,
            });
        }
    });
}

function snapDragElements(){
    layer.on('dragmove', function (e) {
        if (e.target.id() === 'transformer') {
            return;
        }
        
        layer.find('.guid-line').forEach((l) => l.destroy());
    
        var lineGuideStops = getLineGuideStops(e.target);
        var itemBounds = getObjectSnappingEdges(e.target);
    
        var guides = getGuides(lineGuideStops, itemBounds);
    
        if (!guides.length) {
            return;
        }
    
        drawGuides(guides);
    
        var absPos = e.target.absolutePosition();
        guides.forEach((lg) => {
            switch (lg.snap) {
                case 'start': {
                    switch (lg.orientation) {
                        case 'V': {
                            absPos.x = lg.lineGuide + lg.offset;
                            break;
                        }
                        case 'H': {
                            absPos.y = lg.lineGuide + lg.offset;
                            break;
                        }
                    }
                    break;
                }
                case 'center': {
                    switch (lg.orientation) {
                        case 'V': {
                            absPos.x = lg.lineGuide + lg.offset;
                            break;
                        }
                        case 'H': {
                            absPos.y = lg.lineGuide + lg.offset;
                            break;
                        }
                    }
                    break;
                }
                case 'end': {
                    switch (lg.orientation) {
                        case 'V': {
                            absPos.x = lg.lineGuide + lg.offset;
                            break;
                        }
                        case 'H': {
                            absPos.y = lg.lineGuide + lg.offset;
                            break;
                        }
                    }
                    break;
                }
            }
        });
        e.target.absolutePosition(absPos);
    });

    layer.on('dragend', function (e) {
        if (e.target.id() === 'transformer') {
            return;
        }
        
        layer.find('.guid-line').forEach((l) => l.destroy());
        saveHistory(stage.toJSON());
    });
}

function getCornerRadius(width, height, cornerRadiusPercentage) {
    const shortestSide = Math.min(width, height);
    return shortestSide * cornerRadiusPercentage;
}

function snapTransformElements(){
    tr.on('transform', function (e) {
        layer.find('.guid-line').forEach((l) => l.destroy());
    
        var lineGuideStops = getLineGuideStops(e.target);
        var itemBounds = getObjectSnappingEdges(e.target);
    
        var guides = getGuides(lineGuideStops, itemBounds);
    
        if (!guides.length) {
            return;
        }
    
        drawGuides(guides);
    
        var absPos = e.target.absolutePosition();
        guides.forEach((lg) => {
            switch (lg.snap) {
                case 'start': {
                    switch (lg.orientation) {
                        case 'V': {
                            absPos.x = lg.lineGuide + lg.offset;
                            break;
                        }
                        case 'H': {
                            absPos.y = lg.lineGuide + lg.offset;
                            break;
                        }
                    }
                    break;
                }
                case 'center': {
                    switch (lg.orientation) {
                        case 'V': {
                            absPos.x = lg.lineGuide + lg.offset;
                            break;
                        }
                        case 'H': {
                            absPos.y = lg.lineGuide + lg.offset;
                            break;
                        }
                    }
                    break;
                }
                case 'end': {
                    switch (lg.orientation) {
                        case 'V': {
                            absPos.x = lg.lineGuide + lg.offset;
                            break;
                        }
                        case 'H': {
                            absPos.y = lg.lineGuide + lg.offset;
                            break;
                        }
                    }
                    break;
                }
            }
        });
        e.target.absolutePosition(absPos);

        // const width = e.target.width() * e.target.scaleX();
        // const height = e.target.height() * e.target.scaleY();
        // const cornerRadius = getCornerRadius(width, height, 0.1);
        // e.target.cornerRadius(cornerRadius);
    });

    tr.on("transformend", function (e) {
        layer.find('.guid-line').forEach((l) => l.destroy());
        saveHistory(stage.toJSON());
    });
}   

tr.on("transform", (e) => {
    if(e.target instanceof Konva.Text == true){
        e.target.setAttrs({
            width: Math.max(5, e.target.width() * e.target.scaleX(), MIN_WIDTH),
            height: Math.max(5, e.target.height() * e.target.scaleY()),
            scaleX: 1,
            scaleY: 1,
        });
    }

    if(e.target == States.StatesCursor.textEditing){
        var textPosition = e.target.absolutePosition();
        var stageBox = stage.container().getBoundingClientRect();
        var areaPosition = {
          x: stageBox.left + textPosition.x,
          y: stageBox.top + textPosition.y,
        };

        let textarea = document.querySelector("#edit-text")

        textarea.style.top = areaPosition.y + 'px';
        textarea.style.left = areaPosition.x + 'px';
        textarea.style.width = e.target.width() + 'px';
        textarea.style.height = e.target.height() * e.target.scaleY() + 'px';
    }
});

snapDragElements();

snapTransformElements();

function groupElements() {
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

function ungroupElements() {
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

function saveHistory(stageJSON) {
    historySave.push(JSON.parse(stageJSON));
    indexHistory = historySave.length;
}

function undo() {
    if (indexHistory > 0) {
        indexHistory--;
        const lastState = historySave[indexHistory];
        console.log(lastState)

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

function redo() {
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

function updateElementsEvent(){
    elements.forEach(item => {
        item.on("transformend", () => {
            saveHistory(stage.toJSON());
        })
    });
}

stage.on('dragmove', () => {
    bg.absolutePosition({ x: 0, y: 0 });

    if(States.StatesCursor.textEditing){
        var textPosition = States.StatesCursor.textEditing.absolutePosition();
        var stageBox = stage.container().getBoundingClientRect();
        var areaPosition = {
          x: stageBox.left + textPosition.x,
          y: stageBox.top + textPosition.y,
        };

        let textarea = document.querySelector("#edit-text")

        textarea.style.top = areaPosition.y + 'px';
        textarea.style.left = areaPosition.x + 'px';
        textarea.style.width = States.StatesCursor.textEditing.width() * States.StatesCursor.textEditing.scaleX() + 'px';
        textarea.style.height = States.StatesCursor.textEditing.height() * States.StatesCursor.textEditing.scaleY() + 'px';
    }
});

stage.on('mousemove', () => {
    if(!States.StatesCursor.addShape || States.StatesShapes.image){
        return;
    }

    tr.setAttr("visible", false);

    elements.forEach(element => {
        if(element.attrs.name == "preview"){
           element.remove();
        }
    });

    var mousePos = stage.getRelativePointerPosition();
    
    let shapeProperties = {
        x: mousePos.x,
        y: mousePos.y,
        draggable: false,
        listening: false,
        opacity: 0.5,
        name: 'preview'
    };

    let shape = addShape(shapeProperties);

    elements.push(shape)
    layer.add(shape);
    layer.draw();
});

stage.on('mousedown touchstart', (e) => {
    if (e.target !== stage || e.evt.button != 0) {
        return;
    }

    e.evt.preventDefault();
    X1 = stage.getRelativePointerPosition().x;
    Y1 = stage.getRelativePointerPosition().y;
    X2 = stage.getRelativePointerPosition().x;
    Y2 = stage.getRelativePointerPosition().y;

    selectionRectangle.width(0);
    selectionRectangle.height(0);
    selectionRectangle.moveUp();
    SELECTING = true;
});

stage.on('mousemove touchmove', (e) => {
    if (!SELECTING) {
        return;
    }

    e.evt.preventDefault();
    X2 = stage.getRelativePointerPosition().x;
    Y2 = stage.getRelativePointerPosition().y;

    selectionRectangle.setAttrs({
        visible: true,
        x: Math.min(X1, X2),
        y: Math.min(Y1, Y2),
        width: Math.abs(X2 - X1),
        height: Math.abs(Y2 - Y1),
    });
});

stage.on('mouseup touchend', (e) => {
    SELECTING = false;
    if (!selectionRectangle.visible()) {
        return;
    }
    e.evt.preventDefault();
    selectionRectangle.visible(false);
    var shapes = stage.find('.shape' || '.text');
    var box = selectionRectangle.getClientRect();
    var selected = shapes.filter((shape) =>
        Konva.Util.haveIntersection(box, shape.getClientRect())
    );
    tr.nodes(selected);
});

stage.on('click tap', function (e) {

    elements = elements.filter(item => item.attrs.name != "preview");
    layer.getChildren().forEach(element => {
        if(element.attrs.name == "preview"){
            element.destroy();
        }
    });

    if(e.target && e.target != stage){
        States.StatesCursor.select = e.target;
    }

    if (States.StatesCursor.addShape && !States.StatesShapes.image) {
        let mousePos = stage.getRelativePointerPosition();

        let shapeProperties = {
            x: mousePos.x,
            y: mousePos.y,
        };

        let shape = addShape(shapeProperties);

        if(shape){
            elements.push(shape);
            layer.add(shape);

            Object.keys(States.StatesShapes).forEach(key => {
                States.StatesShapes[key] = false;
            });

            States.StatesCursor.addShape = false;
            tr.setAttr("visible", true);
            tr.nodes([shape])
            saveHistory(stage.toJSON());

            updateElementsEvent();
            moveLimit();
        }
    }

    if(States.StatesShapes.image){
        if(!States.StatesValues.image){
            return;
        }

        var image = new Image();
        let mousePos = stage.getRelativePointerPosition();

        let widthDefault = 100;

        let shapeProperties = {
            x: mousePos.x - (widthDefault / 2),
            y: mousePos.y - (widthDefault / 2),
            image: image,
            width: widthDefault,
            height: widthDefault,
            id: "default",
            name: "shape",
            draggable: true,
            imagePath: States.StatesValues.image
        };

        image.onload = function () {
            var image = new Konva.Image({...shapeProperties});
            image.setAttr("_id", image._id);
            elements.push(image);
            layer.add(image);
            layer.draw();     
        };
        image.src = States.StatesValues.image;

        States.StatesCursor.addShape = false;
        States.StatesShapes.image = false;
        States.StatesValues.image = undefined;
    }

    if (selectionRectangle.visible()) {
        return;
    }

    if (e.target instanceof Konva.Stage == true) {
        tr.nodes([])
        return;
    }

    const parent = e.target.getParent();
    if (parent && parent instanceof Konva.Group) {
        tr.nodes([parent]);
        return;
    } else if (!e.target.hasName("shape") && !e.target.hasName("text") && !e.target.hasName("image")) {
        return;
    }

    const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
    const isSelected = tr.nodes().indexOf(e.target) >= 0;

    if (!metaPressed && !isSelected) {
        tr.moveUp();
        tr.nodes([e.target]);
    } else if (metaPressed && isSelected) {
        tr.moveUp();
        const nodes = tr.nodes().slice();
        nodes.splice(nodes.indexOf(e.target), 1);
        tr.nodes(nodes);
    } else if (metaPressed && !isSelected) {
        tr.moveUp();
        const nodes = tr.nodes().concat([e.target]);
        tr.nodes(nodes);
    }

});

stage.on('dblclick dbltap', (e) => {
    let textNode = e.target;
    if (textNode instanceof Konva.Text == false) {
      return;
    }

    States.StatesCursor.textEditing = textNode;
    textNode.hide();

    var textPosition = textNode.absolutePosition();
    var stageBox = stage.container().getBoundingClientRect();

    var areaPosition = {
      x: stageBox.left + textPosition.x,
      y: stageBox.top + textPosition.y,
    };

    var textarea = document.createElement('textarea');
    textarea.id = "edit-text"
    document.body.appendChild(textarea);
    textarea.value = textNode.text();
    textarea.style.position = 'absolute';
    textarea.style.top = areaPosition.y + 'px';
    textarea.style.left = areaPosition.x + 'px';
    textarea.style.width = textNode.width() * textNode.scaleX() + 'px';
    textarea.style.height = textNode.height() * textNode.scaleY() + 'px';
    textarea.style.fontSize = textNode.fontSize() + 'px';
    textarea.style.border = '0px';
    textarea.style.padding = '0px';
    textarea.style.margin = 'none';
    textarea.style.overflow = 'hidden';
    textarea.style.background = 'none';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.lineHeight = textNode.lineHeight();
    textarea.style.fontFamily = textNode.fontFamily();
    textarea.style.transformOrigin = 'right top';
    textarea.style.textAlign = textNode.align();
    textarea.style.color = textNode.fill();
    textarea.style.transform = `rotateZ(${textNode.rotation() ?? 0}deg)`;
    setTextareaWidth(textNode.width() * textNode.getAbsoluteScale().x);
    textarea.focus();
    SELECTALL = false;
  
    function removeTextarea() {
      document.querySelector("#edit-text")?.remove();
      window.removeEventListener('click', handleOutsideClick);
      textNode.show();
      tr.show();
      tr.forceUpdate();
      SELECTALL = true;
      States.StatesCursor.textEditing = undefined;
    }
  
    function setTextareaWidth(newWidth) {
      if (!newWidth) {
        newWidth = textNode.placeholder.length * textNode.fontSize();
      }
      textarea.style.width = newWidth + 'px';
    }
  
    textarea.addEventListener('keydown', function (e) {
      if (e.keyCode === 13 && !e.shiftKey) {
        textNode.text(textarea.value);
        removeTextarea();
      }
      if (e.keyCode === 27) {
        removeTextarea();
      }
    });
  
    textarea.addEventListener('keydown', function () {
      setTextareaWidth(textNode.width() * textNode.getAbsoluteScale().x);
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
});

stage.on('wheel', (e) => {
    e.evt.preventDefault();

    var oldScale = stage.scaleX();
    var pointer = stage.getPointerPosition();

    var mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
    };

    let direction = e.evt.deltaY > 0 ? 1 : -1;

    if (e.evt.ctrlKey) {
        direction = -direction;
    }

    var newScale = direction > 0 ? oldScale * SCALEBY : oldScale / SCALEBY;

    if(newScale > 8 || newScale < .3){
        return;
    }

    stage.scale({ x: newScale, y: newScale });

    var newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
    };
    stage.position(newPos);
    bg.absolutePosition({ x: 0, y: 0 });
    stage.batchDraw();
});

stage.on("mousedown", (e) => {
    if(e.evt.button == 1){
        ISDRAG = true
    }
});

stage.on("mousemove", (e) => {
    if(!ISDRAG){
        return;
    }

    stage.setAttr("draggable", true)
    stage.startDrag();
});

stage.on("mousedown", (e) => {
    if(e.evt.button == 1){
        stage.setAttr("draggable", false)
        stage.startDrag();
        ISDRAG = false;
    }
});

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const stageJSON = stage.toJSON();

        localStorage.removeItem("STAGEJSON");
        localStorage.setItem("STAGEJSON", JSON.stringify(stageJSON));
        req.saveProject(stageJSON);
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo();
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'j'){
        e.preventDefault();
        groupElements();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        ungroupElements();
        saveHistory(stage.toJSON())
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'u'){
        e.preventDefault();

        if(!tr.nodes() > 0){
            return;
        }

        let element = tr.nodes()[0];
        element.moveUp();
        saveHistory(stage.toJSON())
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'o'){
        e.preventDefault();

        if(!tr.nodes() > 0){
            return;
        }

        let element = tr.nodes()[0];
        element.moveDown();
        saveHistory(stage.toJSON())
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        if(!SELECTALL){
            return;
        }

        e.preventDefault();
        console.log("entroo")
        const selectedNodes = tr.nodes();
        const copiedNodes = selectedNodes.map(node => node.toObject());
        const copiedData = JSON.stringify(copiedNodes);
        navigator.clipboard.writeText(copiedData);
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'x') {
        if(!SELECTALL){
            console.log("no select")
            return;
        }
        
        e.preventDefault();
        const selectedNodes = tr.nodes();
        console.log(selectedNodes)
        const copiedNodes = selectedNodes.map(node => node.toObject());
        const copiedData = JSON.stringify(copiedNodes);
        navigator.clipboard.writeText(copiedData);
        selectedNodes.forEach(node => {
            layer.getChildren().forEach(item => {
                if(item._id == node.attrs._id){
                    item.destroy();
                }
            });
           node.destroy();
        });


        console.log(stage.getChildren())
        tr.nodes([]);
        layer.batchDraw();
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        if(!SELECTALL){
            return;
        }

        e.preventDefault();
        navigator.clipboard.readText().then(clipboardData => {
            if (clipboardData) {
                try{
                    let pastedNodes = JSON.parse(clipboardData);
                    const newNodes = pastedNodes.map(nodeData => {
                        const newNode = Konva.Node.create(nodeData, 'container');
                        newNode.setAttrs({
                            x: newNode.x() + (newNode.width() * 2),
                            y: newNode.y() - (newNode.height() / 2),
                        });
                        return newNode;
                    });
                    layer.add(...newNodes);
                    tr.nodes(newNodes);
    
                    elements = [...elements, ...newNodes];
                    layer.batchDraw();
                    saveHistory(stage.toJSON())
                }catch(e){
                    console.log("No se pudo pegar.")
                }
            }
        });
    }

    if(e.ctrlKey && e.key.toLowerCase() === 'a'){
        if(!SELECTALL){
            return;
        }
        
        e.preventDefault();
        tr.nodes([...elements]);
        console.log(tr.nodes())
    }
});

let export_canvas = document.querySelector("#export");
export_canvas.addEventListener("click", () => {
    if(tr.nodes().length > 0 && tr.nodes()[0] instanceof Konva.Group){
        var dataURL = tr.nodes()[0].toDataURL({ pixelRatio: 3})
        downloadURI(dataURL, 'stage.png');
        return;
    }

    var dataURL = stage.toDataURL({ pixelRatio: 3 });
    downloadURI(dataURL, 'stage.png');

})

let undoButton = document.querySelector('#undo');
undoButton.addEventListener('click', undo);

let redoButton = document.querySelector('#redo');
redoButton.addEventListener('click', redo);

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
        } else {
            console.log(`La clave '${attr}' no es válida en States.StatesShapes`);
        }
    });
});

let editor_text = document.querySelector("#editor_text");
let aligns = document.querySelectorAll("#align");
let aligns_vertical = document.querySelectorAll("#align_vertical");
let bold_style = document.querySelector("#bold_style");
let italic_style = document.querySelector("#italic_style");
let font_size = document.querySelector("#font_size");

let font_family = document.querySelector("#font_family");

font_family.addEventListener("change", () => {
    let node = tr.nodes()[0];
    if(!node){
        return;
    }

    let value = font_family.value;
    node.setAttr("fontFamily", value)
    States.StatesCursor.select.setAttr("fontFamily", value)
    
})

font_size?.addEventListener("input", (e) => {
    let node = tr.nodes()[0];
    if(!node){
        return;
    }

    let value = Number(e.target.value);

    if(value < 0 || value > 90){
        return;
    }

    node.setAttr("fontSize", value)
    States.StatesCursor.select.setAttr("fontSize", value)

});

italic_style?.addEventListener("click", () => {
    let node = tr.nodes()[0];
    if(!node){
        return;
    }


    if(node.getAttr("fontStyle") != "italic"){
        bold_style.style.backgroundColor = "transparent";
        italic_style.style.backgroundColor = "#505050";
        node.setAttr("fontStyle", "italic");
        States.StatesCursor.select.setAttr("fontStyle", "italic")
        return;
    }

    bold_style.style.backgroundColor = "transparent";
    italic_style.style.backgroundColor = "transparent";
    node.setAttr("fontStyle", "normal");
    States.StatesCursor.select.setAttr("fontStyle", "normal")
});

bold_style?.addEventListener("click", () => {
    let node = tr.nodes()[0];
    if(!node){
        return;
    }

    if(node.getAttr("fontStyle") != "bold"){
        italic_style.style.backgroundColor = "transparent";
        bold_style.style.backgroundColor = "#505050";
        node.setAttr("fontStyle", "bold");
        States.StatesCursor.select.setAttr("fontStyle", "bold")
        return;
    }

    bold_style.style.backgroundColor = "transparent";
    italic_style.style.backgroundColor = "transparent";
    node.setAttr("fontStyle", "normal");
    States.StatesCursor.select.setAttr("fontStyle", "normal")
});

aligns_vertical?.forEach(item => {

    item?.addEventListener("click", () => {
        let node = tr.nodes()[0];
        if(!node){
            return;
        }

        let attr = item.getAttribute("data-align-vertical");

        node.setAttr("verticalAlign", attr)
        States.StatesCursor.select.setAttr("verticalAlign", attr)

        item.style.backgroundColor = "#505050";

        aligns_vertical?.forEach(element => {
            if(item != element){
                element.style.backgroundColor = "transparent"
            }
        })
    });
});

aligns?.forEach(item => {
    item?.addEventListener("click", () => {
        let node = tr.nodes()[0];
        if(!node){
            return;
        }
    
        let attr = item.getAttribute("data-align");

        node.setAttr("align", attr)
        item.style.backgroundColor = "#505050";

        aligns?.forEach(element => {
            if(item != element){
                element.style.backgroundColor = "transparent"
            }
        })
    });
});

editor_text?.addEventListener("input", (e) =>{
    let node = tr.nodes()[0];
    if(!node || !node instanceof Konva.Text){
        return;
    }

    let value = e.target.value;

    States.StatesCursor.select.setAttr("text", value)
    node.setAttr("text", value)
});

let file_folder = document.querySelector("#file-folder");
let dropzone_file = document.querySelector("#dropzone-file")
let list_image_folder = document.querySelector("#list-image-folder");
let contents_image_folder = document.querySelectorAll("#content-image-folder");

if(contents_image_folder.length > 1){
    document.querySelector("#content-drop").style.display = "none";
    list_image_folder.style.display = "grid"
}

file_folder?.addEventListener("change", saveFile)
dropzone_file?.addEventListener("change", saveFile)

function saveFile(e){
    let files = e.target.files;

    if(files){
        Object.values(files).forEach(item => {
            const reader = new FileReader();

            reader.onload = e => {
                const imageData = e.target.result;
                let clone_content_image_folder = contents_image_folder[0].cloneNode();
                clone_content_image_folder.id = "content-image-folder";
                clone_content_image_folder.setAttribute("data-image-src", imageData);
                clone_content_image_folder.style.display = "flex"

                const image = document.createElement("img");
                image.src = imageData;
                image.classList.add("w-72")
                image.classList.add("h-36");

                clone_content_image_folder.appendChild(image)
                list_image_folder.appendChild(clone_content_image_folder);
                contents_image_folder = document.querySelectorAll("#content-image-folder");

                contents_image_folder?.forEach(item => {
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

        if(contents_image_folder.length > 0){
            document.querySelector("#content-drop").style.display = "none";
            list_image_folder.style.display = "grid"
        }
    }
}

let input_layout_x = document.querySelector("#input_layout_x");
let input_layout_y = document.querySelector("#input_layout_y");

let input_width = document.querySelector("#input_width");
let input_height = document.querySelector("#input_height");

let input_rotate = document.querySelector("#input_rotate");
let input_radius = document.querySelector("#input_radius");
let input_corner = document.querySelector("#input_corner");

let color_style = document.querySelector("#color_style");
let input_color = document.querySelector("#input_color");

let color_style_border = document.querySelector("#color_style_border");
let input_color_border = document.querySelector("#input_color_border");
let input_stroke_border = document.querySelector("#input_stroke_border");

let undo_element = document.querySelector("#undo");
let redo_element = document.querySelector("#redo");

let elements_focus = [
    editor_text, input_color, 
    input_color_border, input_corner, 
    input_height, input_width, 
    input_layout_x, input_layout_y, 
    input_radius, input_rotate, 
    input_stroke_border
]

elements_focus?.forEach(item => {
    item.addEventListener("focus", () => {
        SELECTALL = false;
        console.log(SELECTALL)
    })

    item.addEventListener("blur", () => {
        SELECTALL = true;
        console.log(SELECTALL)
    })
});

undo_element?.addEventListener("click", undo);
redo_element?.addEventListener("click", redo);

input_layout_x.addEventListener("input", updateElement);
input_layout_y.addEventListener("input", updateElement);
input_width.addEventListener("input", updateElement);
input_height.addEventListener("input", updateElement);

input_rotate.addEventListener("input", updateElement);
input_radius.addEventListener("input", updateElement);
input_corner.addEventListener("input", updateElement);
color_style_border.addEventListener("input", updateElement);
input_stroke_border.addEventListener("input", updateElement)
color_style.addEventListener("change", updateElement);
input_color.addEventListener("input", () => {
    let value = input_color.value;

    if (States.StatesCursor.select && value.split("").length == 7) {
        let select = States.StatesCursor.select;
        select.setAttrs({
            fill: value
        });
        layer.batchDraw();
    }
});

function updateElement() {
    const selectedNodes = tr.nodes();
    if (selectedNodes.length === 0) {
        return;
    }

    updateNodeAttrs(States.StatesCursor.select, tr.nodes()[0]);

    layer.batchDraw();
    saveHistory(stage.toJSON());
}

function updateNodeAttrs(select, node) {
    let scaleX = select.attrs.scaleX ?? 1;
    let scaleY = select.attrs.scaleY ?? 1;

    let width;
    let height;

    if (select.attrs.width || select.attrs.height) {
        width = input_width.value
        height = input_height.value
    }

    let x = parseFloat(input_layout_x.value);
    let y = parseFloat(input_layout_y.value);

    if(select.getParent() instanceof Konva.Group){
        x = select.attrs.x;
        y = select.attrs.y;
    }

    if(select instanceof Konva.Text == true){

    }

    if(node && node instanceof Konva.Group == false){
        node.setAttrs({
            x: x,
            y: y,
            width: width / scaleX,
            height: height / scaleY,
            rotation: parseFloat(input_rotate.value),
            cornerRadius: parseFloat(input_corner.value) || 0,
            radius: parseFloat(input_radius.value),
            fill: color_style.value,
            stroke: color_style_border.value,
            strokeWidth: parseFloat(input_stroke_border.value),
        });
        return;
    }

    select.setAttrs({
        x: x,
        y: y,
        width: width / scaleX,
        height: height / scaleY,
        rotation: parseFloat(input_rotate.value) || 0,
        cornerRadius: parseFloat(input_corner.value) || 0,
        radius: parseFloat(input_radius.value) || 0,
        fill: color_style.value,
        stroke: color_style_border.value,
        strokeWidth: parseFloat(input_stroke_border.value),
    });
}

let previousAttrs = null;

setInterval(() => {
    if (States.StatesCursor.select != undefined || tr.nodes().length > 0) {
        if(document.querySelector("#content-edit") && document.querySelector("#content-edit-nothing")){
            document.querySelector("#content-edit").style.display = "flex";
            document.querySelector("#content-edit-nothing").style.display = "none";
        }

        let select = States.StatesCursor.select;
        if(!select || !select.attrs){
            return;
        }

        const currentAttrs = { ...select.attrs };

        if (!_.isEqual(previousAttrs, currentAttrs)) {
            changeLayout(currentAttrs);
            previousAttrs = currentAttrs;
        }
    }else{
        if(document.querySelector("#content-edit") && document.querySelector("#content-edit-nothing")){
            document.querySelector("#content-edit").style.display = "none";
            document.querySelector("#content-edit-nothing").style.display = "flex";
        }
    }

    
    if(!tr.nodes().length > 0){
        if(document.querySelector("#content-edit") && document.querySelector("#content-edit-nothing")){
            document.querySelector("#content-edit").style.display = "none";
            document.querySelector("#content-edit-nothing").style.display = "flex";
        }
    }
},);

function changeLayout(attrs) {
    color_style.value = attrs.fill || "#000000";
    color_style_border.value = attrs.stroke || "#000000";

    if(attrs.text){
        editor_text.value = attrs.text;
    }

    if(attrs.align){
        aligns.forEach(item => {
            if(item.getAttribute("data-align") == attrs.align){
                item.style.backgroundColor = "#505050"
            }else{
                item.style.backgroundColor = "transparent"
            }
        })
    }

    if(attrs.verticalAlign){
        aligns_vertical.forEach(item => {
            if(item.getAttribute("data-align-vertical") == attrs.verticalAlign){
                item.style.backgroundColor = "#505050"
            }else{
                item.style.backgroundColor = "transparent"
            }
        })
    }

    let scaleX = attrs.scaleX ?? 1;
    let scaleY = attrs.scaleY ?? 1;
    input_layout_x.value = attrs.x.toFixed(0) || 0
    input_layout_y.value = attrs.y.toFixed(0) || 0
    if(attrs.width){
        input_width.value = ((attrs.width || 1) * scaleX).toFixed(0)
        input_height.value = ((attrs.height || 1) * scaleY).toFixed(0)
    }

    if(attrs.rotation){
        input_rotate.value = attrs.rotation.toFixed(0) || 1;
    }
    
    if(attrs.radius){
        input_radius.value = attrs.radius;
    }

    input_color.value = color_style.value || "";
    input_color_border.value = color_style_border.value || "";
    input_stroke_border.value = attrs.strokeWidth || 0;
    input_corner.value = attrs.cornerRadius || 0;
}