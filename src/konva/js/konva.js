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
stage.add(layer);

function generateGrid(scaleX, scaleY) {
    // let bg = new Konva.Rect({ // Fondo
    //     x: 0,
    //     y: 0,
    //     width: widthKonva,
    //     height: heightKonva,
    //     fill: "#ffffff",
    //     listening: false,
    //     draggable: false,
    // })
    // layer.add(bg);

    // for (var i = 0; i < widthKonva / 30; i++) {
    //     layer.add(new Konva.Line({
    //         points: [Math.round(i * 30) + 0.5, 0, Math.round(i * 30) + 0.5, heightKonva],
    //         stroke: '#ddd',
    //         strokeWidth: 1,
    //         scale: { x: scaleX, y: scaleY },
    //     }));
    // }
    
    // layer.add(new Konva.Line({points: [0,0,10,10]}));
    // for (var j = 0; j < heightKonva / 30; j++) {
    //   layer.add(new Konva.Line({
    //     points: [0, Math.round(j * 30), widthKonva, Math.round(j * 30)],
    //     stroke: '#ddd',
    //     strokeWidth: 0.5,
    //     scale: { x: scaleX, y: scaleY },
    //   }));
    // }
}
generateGrid(1,1);

// stage.container().style.backgroundColor = "#f0f0f0";
// stage.container().style.backgroundImage = "radial-gradient(rgba(140, 140, 140, 0.171) 2px, transparent 0)";
// stage.container().style.backgroundSize = "30px 30px";
// stage.container().style.backgroundPosition = "-5px -5px"

var tr = new Konva.Transformer({ // Transformador de tamaño y posicion con limite
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
            name: "shape"
        }

        let shape = addShape(shapeProperties);

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

    if (!e.target.hasName("shape")) {
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
    var dataURL = stage.toDataURL({ pixelRatio: 3 });
    downloadURI(dataURL, 'stage.jpeg');
});

let undoButton = document.querySelector('#undo');
undoButton.addEventListener('click', undo);

let redoButton = document.querySelector('#redo');
redoButton.addEventListener('click', redo);