import Konva from "konva";
import { downloadURI } from "./functions";
import { addShape } from "../ts/shapes";
import * as States from "./states";

//Canva
let konva = document.querySelector("#konva");

//Variables Reusing
let elements = [];
let elementsLayerBackground = [];
let widthKonva = Number(window.getComputedStyle(konva).width.split("px")[0]);
let heightKonva = Number(window.getComputedStyle(konva).height.split("px")[0]);

//Variables Important
var SCALEBY = 1.1;
var MAX_WIDTH = widthKonva / 2;
var X1, Y1, X2, Y2;
var SELECTING = false;

let stage;

//Tools Konva
if(localStorage.getItem("STAGEJSON")){
    stage = Konva.Node.create(JSON.parse(localStorage.getItem("STAGEJSON")), 'konva');
}else{
    stage = new Konva.Stage({ // Lienzo
        container: 'konva',
        width: widthKonva,
        height: heightKonva,
        draggable: true,
    });
}

console.log(stage.getLayers(), stage.getLayers().find(item => item.attrs.id == "layer"))

var layer = stage.getLayers().find(item => item.attrs.id == "layer") || new Konva.Layer({
    id: "layer"
});

var layerBackground = stage.getLayers().find(item => item.attrs.id == "layerbackground") || new Konva.Layer({
    id: "layerbackground",
});

if(!stage.getLayers().find(item => item.attrs.id == "layer") && !stage.getLayers().find(item => item.attrs.id == "layerBackground")){
    stage.add(layer);
    stage.add(layerBackground); 
}

layer.zIndex(1);
layerBackground.zIndex(0);

let bg = new Konva.Rect({ // Fondo
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
layerBackground.add(bg);
elementsLayerBackground.push(bg);

var tr = new Konva.Transformer({ // Transformador de tamaño y posicion con limite
    nodes: elements,
    padding: 1,
    boundBoxFunc: function (oldBoundBox, newBoundBox) {
        if (Math.abs(newBoundBox.width) > MAX_WIDTH) {
        return oldBoundBox;
        }
        return newBoundBox;
    },
    visible: true,
});
layer.add(tr);

var selectionRectangle = new Konva.Rect({ // Area de seleccion de elementos
    fill: 'rgba(0,0,255,0.5)',
    visible: false,
    listening: false,
});
layer.add(selectionRectangle);

// Events to stage

stage.on('dragmove', () => {
    bg.absolutePosition({ x: 0, y: 0 });
});

stage.on('mousemove', () => {
    if(!States.StatesCursor.addShape){
        return;
    }

    tr.setAttr("visible", false);

    elements.forEach(element => {
        if(element.attrs.name == "preview"){
            element.destroy();
            return;
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
    }

    let shape = addShape(shapeProperties);

    elements.push(shape);
    layer.add(shape);
    layer.draw();
})

stage.on('mousedown touchstart', (e) => {
  if (e.target !== stage) {
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
    if (States.StatesCursor && !e.target.id()) {
        elements.forEach(element => {
            if(element.attrs.name == "preview"){
                element.destroy();
                return;
            }
        });

        let mousePos = stage.getRelativePointerPosition();

        let shapeProperties = {
            x: mousePos.x,
            y: mousePos.y,
        }

        let shape = addShape(shapeProperties);

        if(shape && shape.attrs.name === "text"){
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
                textarea.style.width = shape.width();
                textarea.style.height = shape.height();
                textarea.style.fontSize = shape.fontSize();
                textarea.style.border = '2px solid blue';
                textarea.style.padding = '.5rem';
                textarea.style.margin = '0px';
                textarea.style.overflow = 'hidden';
                textarea.style.background = 'none';
                textarea.style.outline = 'none';
                textarea.style.lineHeight = shape.lineHeight();
                textarea.style.fontFamily = shape.fontFamily();
                textarea.style.transformOrigin = 'left top';
                textarea.style.textAlign = shape.align();
                textarea.style.color = shape.fill();
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
                    tr.forceUpdate();
                    layer.draw();
                }

                textarea.addEventListener('keydown', function (e) {
                    // hide on enter
                    // but don't hide on shift + enter
                    if (e.keyCode === 13 && !e.shiftKey) {
                        shape.text(textarea.value);
                        removeTextarea();
                    }
                    // on esc do not set value back to node
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


                
                // textarea.focus();
        
                // textarea.addEventListener('keydown', function (e) {
                //   // hide on enter
                //   if (e.keyCode === 13) {
                //     removeTextarea();
                //   }
                // });

                // stage.on('click', removeTextarea);
              });
            
        }

        if(shape){
            elements.push(shape);
            tr.nodes(elements);
            layer.add(shape);
            layer.draw();
                            
            Object.keys(States.StatesShapes).forEach(key => {
                States.StatesShapes[key] = false;
            });

            States.StatesCursor.addShape = false;
            tr.setAttr("visible", true);
        }
    }

    if(States.StatesShapes.image && !e.target.id()){
        console.log(e.target.id())
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
        }

        image.onload = function () {
            var image = new Konva.Image({...shapeProperties});
            layer.add(image);
            layer.draw();     
        };
        image.src = '../../../public/Logo.jpg';
    }

    if (selectionRectangle.visible()) {
        return;
    }

    if (e.target === stage) {
        tr.nodes([]);
        return;
    }

    if (!e.target.hasName("shape") && !e.target.hasName("text") && !e.target.hasName("image")) {
        return;
    }

    const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
    const isSelected = tr.nodes().indexOf(e.target) >= 0;

    if (!metaPressed && !isSelected) {
        tr.nodes([e.target]);
    } else if (metaPressed && isSelected) {
        const nodes = tr.nodes().slice();
        nodes.splice(nodes.indexOf(e.target), 1);
        tr.nodes(nodes);
    } else if (metaPressed && !isSelected) {
        const nodes = tr.nodes().concat([e.target]);
        tr.nodes(nodes);
}});

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
    }

    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();

        const stageJSON = stage.toJSON();

        localStorage.removeItem("STAGEJSON");
        localStorage.setItem("STAGEJSON", JSON.stringify(stageJSON));
    }

    if(e.shiftKey){
        stage.setAttr("draggable", false);
    }

    if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();

    }
});

document.addEventListener('keyup', function (e) {
    if(e.code == "ShiftLeft"){
        stage.setAttr("draggable", true);
    }
});

// Events to canvas in DOM

let export_canvas = document.querySelector("#export");
export_canvas.addEventListener("click", () => {
    layerGrid.visible(false);
    var dataURL = stage.toDataURL({ pixelRatio: 3 });
    let stateDownload = downloadURI(dataURL, 'stage.jpeg');

    if(stateDownload){
        layerGrid.visible(true);
    }
});

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