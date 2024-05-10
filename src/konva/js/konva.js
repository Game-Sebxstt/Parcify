import Konva from "konva";
import _ from 'lodash'
import { downloadURI } from "./functions";
import { addShape } from "../ts/shapes";
import * as States from "./states";

let konva = document.querySelector("#konva");
let elements = [];
let groups = [];
let elementsLayerBackground = [];
let historySave = [];
let indexHistory = 0;
let widthKonva = Number(window.getComputedStyle(konva).width.split("px")[0]);
let heightKonva = Number(window.getComputedStyle(konva).height.split("px")[0]);

var SCALEBY = 1.1;
var MAX_WIDTH = widthKonva;
var X1, Y1, X2, Y2;
var SELECTING = false;
var SHIFTLEFT = false;

let stage;

if(localStorage.getItem("STAGEJSON")){
    stage = Konva.Node.create(JSON.parse(localStorage.getItem("STAGEJSON")), 'konva');
} else {
    stage = new Konva.Stage({
        container: 'konva',
        width: widthKonva,
        height: heightKonva,
        draggable: true,
    });
}

var layer = stage.getLayers().find(item => item.attrs.id == "layer") || new Konva.Layer({
    id: "layer"
});

elements = [...layer.getChildren().filter(item => (item.attrs.id != "selection") && item.attrs.id != "transformer") ];

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
    boundBoxFunc: function (oldBoundBox, newBoundBox) {
        if (Math.abs(newBoundBox.width) > MAX_WIDTH) {
            return oldBoundBox;
        }
        return newBoundBox;
    },
    visible: true,
    id: "transformer"
});

tr.zIndex(100);

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

function ungroupElements() {
    const selectedGroup = tr.nodes()[0];
    if (!(selectedGroup instanceof Konva.Group)) {
        return;
    }

    const children = selectedGroup.getChildren();
    children.forEach((child) => {
        child.draggable(true);
        layer.add(child);
    });

    selectedGroup.destroy();
    elements = elements.filter((item) => item !== selectedGroup);
    tr.nodes(children);
    layer.batchDraw();
}

function groupElements() {
    const selectedNodes = tr.nodes();
    if (selectedNodes.length < 2) {
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

function saveHistory(stageJSON) {
    historySave.push(JSON.parse(stageJSON));
    indexHistory = historySave.length;
}

function undo() {
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
        
        layer.draw();
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

        layer.draw();
    }
}

stage.on('dragmove', () => {
    bg.absolutePosition({ x: 0, y: 0 });
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
    if (e.target !== stage || !SHIFTLEFT) {
        return;
    }

    e.evt.preventDefault();
    X1 = stage.getRelativePointerPosition().x;
    Y1 = stage.getRelativePointerPosition().y;
    X2 = stage.getRelativePointerPosition().x;
    Y2 = stage.getRelativePointerPosition().y;

    selectionRectangle.width(0);
    selectionRectangle.height(0);
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

    if(e.target){
        if(e.target != stage){
            States.StatesCursor.select = e.target;
        }
    }

    if (States.StatesCursor.addShape && !States.StatesShapes.image) {
        let mousePos = stage.getRelativePointerPosition();

        let shapeProperties = {
            x: mousePos.x,
            y: mousePos.y,
        };

        let shape = addShape(shapeProperties);
        
        if(shape && shape.attrs.type === "text"){
            shape.on('transform', () => {
                shape.setAttrs({
                    width: Math.max(5, shape.width() * shape.scaleX()),
                    height: Math.max(5, shape.height() * shape.scaleY()),
                    scaleX: 1,
                    scaleY: 1,
                });
            });

            shape.on('dblclick dbltap', () => {
                shape.hide();
                tr.hide();
                layer.draw();
        
                var textPosition = shape.getAbsolutePosition();

                var stageBox = stage.container().getBoundingClientRect();
        
                var areaPosition = {
                  x: stageBox.left + textPosition.x,
                  y: stageBox.top + textPosition.y,
                };
        
                var textarea = document.createElement('textarea');
                document.body.appendChild(textarea);
        
                textarea.value = shape.text();
                textarea.style.position = 'absolute';
                textarea.style.top = areaPosition.y + 'px';
                textarea.style.left = areaPosition.x + 'px';
                textarea.style.width = shape.width() * 2 + 'px';
                textarea.style.height = shape.height() * 2 + 5 + 'px';
                textarea.style.border = 'none';
                textarea.style.padding = '0px';
                textarea.style.margin = '0px';
                textarea.style.overflow = 'hidden';
                textarea.style.background = 'transparent';
                textarea.style.outline = 'none';
                textarea.style.resize = 'none';
                textarea.style.lineHeight = shape.lineHeight();
                textarea.style.fontFamily = shape.fontFamily();
                textarea.style.transformOrigin = 'left top';
                textarea.style.textAlign = shape.align();
                textarea.style.color = shape.fill();
                textarea.style.fontSize = shape.fontSize() + "px"
                let rotation = shape.rotation();
                let transform = '';
                if (rotation) {
                  transform += 'rotateZ(' + rotation + 'deg)';
                }

                let px = 0;
                let isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;
                if (isFirefox) {
                    px += 2 + Math.round(shape.fontSize() / 20);
                }
                transform += 'translateY(-' + px + 'px)';
                textarea.style.transform = transform;
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 3 + 'px';

                textarea.focus();

                function removeTextarea(){
                    if(!textarea){
                        return;
                    }
                    shape.width();
                    textarea.remove();
                    window.removeEventListener('click', handleOutsideClick);
                    shape.show();
                    tr.show();
                    layer.draw();
                }

                textarea.addEventListener('keydown', function (e) {
                    if (e.keyCode === 13 && !e.shiftKey) {
                        shape.text(textarea.value);
                        removeTextarea();
                    }
                    if (e.keyCode === 27) {
                        removeTextarea();
                    }
                });

                textarea.addEventListener('input', function () {
                    shape.text(textarea.value);
                });

                function handleOutsideClick(e) {
                    if (e.target !== textarea) {
                        shape.text(textarea.value);
                        removeTextarea();
                    }
                }

                setTimeout(() => {
                    window.addEventListener('click', handleOutsideClick);
                });
            });
        }

        if(shape){
            saveHistory(stage.toJSON());

            elements.push(shape);
            layer.add(shape);

            Object.keys(States.StatesShapes).forEach(key => {
                States.StatesShapes[key] = false;
            });

            States.StatesCursor.addShape = false;
            tr.setAttr("visible", true);
            tr.nodes([shape])
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
            name: "image",
            draggable: true
        };

        image.onload = function () {
            var image = new Konva.Image({...shapeProperties});
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

    if (e.target === stage) {
        tr.nodes([]);
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
});

document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        const selectedNodes = tr.nodes();
        const copiedNodes = selectedNodes.map(node => node.toObject());
        const copiedData = JSON.stringify(copiedNodes);
        navigator.clipboard.writeText(copiedData);
    }

    if (e.ctrlKey && e.key === 'x') {
        e.preventDefault();
        let newElementsArray = [];
        const selectedNodes = tr.nodes();
        const copiedNodes = selectedNodes.map(node => node.toObject());
        const copiedData = JSON.stringify(copiedNodes);
        selectedNodes.map(item => item.remove());
        tr.nodes(newElementsArray);
        navigator.clipboard.writeText(copiedData);
    }

    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        const stageJSON = stage.toJSON();

        localStorage.removeItem("STAGEJSON");
        localStorage.setItem("STAGEJSON", JSON.stringify(stageJSON));
    }

    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        undo();
    }

    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        redo();
    }

    if(e.shiftKey){
        SHIFTLEFT = true;
        stage.setAttr("draggable", false);
    }

    if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        navigator.clipboard.readText().then(clipboardData => {
            if (clipboardData) {
                const pastedNodes = JSON.parse(clipboardData);
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
            }
        });
    }

    if(e.ctrlKey && e.key === 'a'){
        e.preventDefault();
        tr.nodes(elements);
    }

    if(e.ctrlKey && e.key === 'j'){
        e.preventDefault();
        groupElements();
    }

    if (e.ctrlKey && e.key === 'g') {
        e.preventDefault();
        ungroupElements();
    }
});

document.addEventListener('keyup', function (e) {
    if(e.code == "ShiftLeft"){
        SHIFTLEFT = false;
        stage.setAttr("draggable", true);
    }
});

let export_canvas = document.querySelector("#export");
export_canvas.addEventListener("click", () => {
    var dataURL = stage.toDataURL({ pixelRatio: 3 });
    // dataURL = tr.nodes()[0].toDataURL({ pixelRatio: 3})
    downloadURI(dataURL, 'stage.jpeg');
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
                        console.log("click")
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

let color_style = document.querySelector("#color_style");
let input_color = document.querySelector("#input_color");

let color_style_border = document.querySelector("#color_style_border");
let input_color_border = document.querySelector("#input_color_border");
let input_stroke_border = document.querySelector("#input_stroke_border");

input_layout_x.addEventListener("input", updateElement);
input_layout_y.addEventListener("input", updateElement);
input_width.addEventListener("input", updateElement);
input_height.addEventListener("input", updateElement);
input_rotate.addEventListener("input", updateElement);
input_radius.addEventListener("input", updateElement);
color_style_border.addEventListener("input", updateElement);
input_stroke_border.addEventListener("input", updateElement)
color_style.addEventListener("input", updateElement);
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

    selectedNodes.forEach((node) => {
        if (node instanceof Konva.Group) {
            const children = node.getChildren();
            children.forEach((child) => {
                updateNodeAttrs(child);
            });
        } else {
            updateNodeAttrs(node);
        }
    });

    layer.batchDraw();
}

function updateNodeAttrs(node) {
    let scaleX = node.attrs.scaleX ?? 1;
    let scaleY = node.attrs.scaleY ?? 1;

    let width;
    let height;

    if (node.attrs.width || node.attrs.height) {
        width = ((node.attrs.width || 1) * scaleX).toFixed(0);
        height = ((node.attrs.height || 1) * scaleY).toFixed(0);
    }

    if (node.attrs.radius) {
        width = ((node.attrs.radius || 1) * scaleX).toFixed(0) * 2;
        height = ((node.attrs.radius || 1) * scaleY).toFixed(0) * 2;
    }

    let x = parseFloat(input_layout_x.value);
    let y = parseFloat(input_layout_y.value);

    if(node.getParent() instanceof Konva.Group){
        x = node.attrs.x;
        y = node.attrs.y;
    }

    node.setAttrs({
        x: x,
        y: y,
        width: width / scaleX,
        height: height / scaleY,
        rotation: parseFloat(input_rotate.value),
        cornerRadius: parseFloat(input_radius.value),
        fill: color_style.value,
        stroke: color_style_border.value,
        strokeWidth: parseFloat(input_stroke_border.value),
    });
}

let previousAttrs = null;

setInterval(() => {
    if (States.StatesCursor.select != undefined && tr.nodes().length > 0) {
        if(document.querySelector("#content-edit") && document.querySelector("#content-edit-nothing")){
            document.querySelector("#content-edit").style.display = "flex";
            document.querySelector("#content-edit-nothing").style.display = "none";
        }

        let select = States.StatesCursor.select;
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
},);

function changeLayout(attrs) {
    color_style.value = attrs.fill;
    color_style_border.value = attrs.stroke;

    let scaleX = attrs.scaleX ?? 1;
    let scaleY = attrs.scaleY ?? 1;
    input_layout_x.value = attrs.x.toFixed(0)
    input_layout_y.value = attrs.y.toFixed(0)
    if(attrs.width){
        input_width.value = ((attrs.width || 1) * scaleX).toFixed(0)
        input_height.value = ((attrs.height || 1) * scaleY).toFixed(0)
    }

    if(attrs.radius){
        input_width.value = ((attrs.radius || 1) * scaleX).toFixed(0)
        input_height.value = ((attrs.radius || 1) * scaleY).toFixed(0)
    }

    if(attrs.rotation){
        input_rotate.value = attrs.rotation.toFixed(0) || 1;
    }
    
    if(attrs.cornerRadius){
        input_radius.value = attrs.cornerRadius;
    }

    input_color.value = color_style.value;
    input_color_border.value = color_style_border.value;
    input_stroke_border.value = attrs.strokeWidth;
}