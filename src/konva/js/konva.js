import Konva from "konva";
import { downloadURI } from "./functions";
import { addShape } from "../ts/shapes";
import * as States from "./states";

//Canva
let konva = document.querySelector("#konva");

//Variables Reusing
let elements = [];
let widthKonva = Number(window.getComputedStyle(konva).width.split("px")[0]);
let heightKonva = Number(window.getComputedStyle(konva).height.split("px")[0]);

//Variables Important
var SCALEBY = 1.1;
var MAX_WIDTH = widthKonva / 2;
var X1, Y1, X2, Y2;
var SELECTING = false;


//Tools Konva
let stage = new Konva.Stage({ // Lienzo
    container: 'konva',
    width: widthKonva,
    height: heightKonva,
    draggable: false,
});

var layer = new Konva.Layer(); // Capa
var layerGrid = new Konva.Layer(); // Capa de la cuadricula
var layerBackground = new Konva.Layer(); // Capa de fondo
stage.add(layer);
stage.add(layerGrid);
stage.add(layerBackground);

layer.zIndex(2);
layerGrid.zIndex(1);
layerBackground.zIndex(0);

function generateGrid(scaleX, scaleY) {
    let bg = new Konva.Rect({ // Fondo
        x: 0,
        y: 0,
        width: widthKonva,
        height: heightKonva,
        fill: "#ffffff",
        listening: false,
        draggable: false,
    });
    layerBackground.add(bg);

    elements = elements.filter((element) => {
        if (element.name() === "grid") {
            element.destroy();
            return false;
        }
        return true;
    });

    stage.find(".grid").forEach((element) => {
        element.destroy();
    });

    for (var i = 0; i < widthKonva / 10; i++) {
        let grid = new Konva.Line({
            points: [Math.round(i * 10) + 0.5, 0, Math.round(i * 10) + 0.5, heightKonva],
            stroke: '#ddd',
            strokeWidth: 1,
            scale: { x: scaleX, y: scaleY },
            name: "grid",
            listening: false,
            draggable: false,
        })

        elements.push(grid);
        layerGrid.add(grid);
    }
    
    layerGrid.add(new Konva.Line({points: [0,0,10,10]}));
    for (var j = 0; j < heightKonva / 10; j++) {
      let grid = new Konva.Line({
        points: [0, Math.round(j * 10), widthKonva, Math.round(j * 10)],
        stroke: '#ddd',
        strokeWidth: 0.5,
        scale: { x: scaleX, y: scaleY },
        name: "grid"
      })

      elements.push(grid);
      layerGrid.add(grid);
    }
}
generateGrid(1,1);

var tr = new Konva.Transformer({ // Transformador de tamaño y posicion con limite
    nodes: elements,
    padding: 5,
    boundBoxFunc: function (oldBoundBox, newBoundBox) {
        if (Math.abs(newBoundBox.width) > MAX_WIDTH) {
        return oldBoundBox;
        }
        return newBoundBox;
    },
});
layer.add(tr);

var selectionRectangle = new Konva.Rect({ // Area de seleccion de elementos
    fill: 'rgba(0,0,255,0.5)',
    visible: false,
    listening: false,
});
layer.add(selectionRectangle);

// Events to stage

stage.on('mousedown touchstart', (e) => {
    if (e.target !== stage) {
        return;
    }

    e.evt.preventDefault();
    X1 = stage.getPointerPosition().x;
    Y1 = stage.getPointerPosition().y;
    X2 = stage.getPointerPosition().x;
    Y2 = stage.getPointerPosition().y;

    selectionRectangle.width(0);
    selectionRectangle.height(0);
    SELECTING = true;
});

stage.on('mousemove touchmove', (e) => {
    if (!SELECTING) {
        return;
    }

    e.evt.preventDefault();
    X2 = stage.getPointerPosition().x;
    Y2 = stage.getPointerPosition().y;

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
    var shapes = stage.find('.rect');
    var box = selectionRectangle.getClientRect();
    var selected = shapes.filter((shape) =>
        Konva.Util.haveIntersection(box, shape.getClientRect())
    );

    tr.nodes(selected);
});

stage.on('click tap', function (e) {
    if (States.StatesCursor && !e.target.id()) {
        let mousePos = stage.getRelativePointerPosition();

        let shapeProperties = {
            x: mousePos.x,
            y: mousePos.y,
        }

        let shape = addShape(shapeProperties);
        console.log(shape.attrs.text.length)

        if(shape.attrs.name === "text"){
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

        elements.push(shape);
        tr.nodes(elements);
        layer.add(shape);
        layer.draw();
    }

    if (selectionRectangle.visible()) {
        return;
    }

    if (e.target === stage) {
        tr.nodes([]);
        return;
    }

    if (!e.target.hasName("shape") && !e.target.hasName("text")) {
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

  if(newScale > 10 || newScale < .3){
    return;
  }

  stage.scale({ x: newScale, y: newScale });

  var newPos = {
    x: pointer.x - mousePointTo.x * newScale,
    y: pointer.y - mousePointTo.y * newScale,
  };
  stage.position(newPos);
  generateGrid(newScale, newScale);
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