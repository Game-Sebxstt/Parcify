const canvas = document.getElementById('canvas');
const context = canvas?.getContext('2d');

import { Circle } from "./class/circle";
import { Rectangle } from "./class/rectangle";
import { Text } from './class/text'

let elements = [];
let contentCanvas = document.getElementById('content-canvas');

let states = {
    text: true,
    circle: false,
    rectangle: false,
    triangle: false,
    diamond: false,
    inverted_triangle: false,
    rounded_rectangle: false,
    chevron: false,
};

let states_pointer = {
    select: true,
    move: false,
};

let selectedElement = null;
let offsetX = 0;
let offsetY = 0;
let resizeHandle = false;

canvas.width = contentCanvas.offsetWidth;
canvas.height = contentCanvas.offsetHeight;

window.addEventListener("resize", () => {
    contentCanvas = document.getElementById('content-canvas');
    canvas.width = contentCanvas.offsetWidth;
    canvas.height = contentCanvas.offsetHeight;
});

function addShape(shapeProperties) {
    let newShape;
    if (states.circle) {
        newShape = new Circle(shapeProperties);
    } else if (states.rectangle) {
        newShape = new Rectangle(shapeProperties);
    } else if (states.triangle) {
        newShape = new Triangle(shapeProperties);
    } else if (states.diamond) {
        newShape = new Diamond(shapeProperties);
    } else if (states.inverted_triangle) {
        newShape = new InvertedTriangle(shapeProperties);
    } else if (states.rounded_rectangle) {
        newShape = new RoundedRectangle(shapeProperties);
    } else if (states.chevron) {
        newShape = new Chevron(shapeProperties);
    } else if(states.text){
        newShape = new Text(shapeProperties);
    }

    elements.push(newShape);
    drawElements();
}

function drawElements() {
    context.clearRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "white";
    context.fillRect(0,0, canvas.width, canvas.height);

    elements.forEach(item => {
        item.draw(context);

        if (item.selected) {
            item.drawRotationHandle(context);
        }
    });

}

canvas.addEventListener('click', function(event) {
    var canvasRect = canvas.getBoundingClientRect();
    var mouseX = event.clientX - canvasRect.left;
    var mouseY = event.clientY - canvasRect.top;

    let isSelectItem = false;

    elements.forEach(item => {
        item.selected = false;

        if (item.isClicked(mouseX, mouseY) || item.isInHandle(mouseX, mouseY) || item.isInRotationHandle(mouseX, mouseY)) {
            elements.forEach(e => e.selected = false);
            item.selected = true;
            selectedElement = item;
            states_pointer.select = false;
            isSelectItem = true;
        }

    });

    if (states_pointer.select == true) {
        addShape({ x: mouseX, y: mouseY, color: 'purple', stroke: true, strokeWidth: 2, strokeColor: 'yellow' });
    }

    if (!isSelectItem) {
        states_pointer.select = true;
        selectedElement = null
    }

    drawElements();
});

canvas.addEventListener('mousedown', function(event) {
    var canvasRect = canvas.getBoundingClientRect();
    var mouseX = event.clientX - canvasRect.left;
    var mouseY = event.clientY - canvasRect.top;
    
    elements.forEach(item => {
        if (item.isClicked(mouseX, mouseY)) {
            elements.forEach(e => e.selected = false);
            item.selected = true;
            selectedElement = item;
            states_pointer.select = false;
        }
    });

    if (selectedElement && selectedElement.isInHandle(mouseX, mouseY)) {
        selectedElement.startResize(mouseX, mouseY);
        states_pointer.select = false;
    } else if (selectedElement && selectedElement.isClicked(mouseX, mouseY)) {
        offsetX = mouseX - selectedElement.x;
        offsetY = mouseY - selectedElement.y;
        states_pointer.move = true;
        states_pointer.select = false;  
    }
});

canvas.addEventListener('mousemove', function(event) {
    var canvasRect = canvas.getBoundingClientRect();
    var mouseX = event.clientX - canvasRect.left;
    var mouseY = event.clientY - canvasRect.top;

    if (selectedElement && selectedElement.isInRotationHandle(mouseX, mouseY)) {
        console.log(selectedElement.rotation)
        selectedElement.updateRotation(mouseX, mouseY);
        drawElements();
    }

    if (selectedElement && selectedElement.isResizing()) {
        selectedElement.resizeTo(mouseX, mouseY);
        drawElements();
    } else if (states_pointer.move && selectedElement) {
        selectedElement.x = mouseX - offsetX;
        selectedElement.y = mouseY - offsetY;
        drawElements();
    }
});

canvas.addEventListener('mouseup', function(event) {
    if (selectedElement) {
        selectedElement.finishResize();
    }

    if (states_pointer.move) {
        states_pointer.move = false;
        selectedElement = null;
    }
});

canvas.addEventListener('dblclick', function(event) {
    var canvasRect = canvas.getBoundingClientRect();
    var mouseX = event.clientX - canvasRect.left;
    var mouseY = event.clientY - canvasRect.top;
    
    elements.forEach(item => {
        if (item.type === 'text' && item.isClicked(mouseX, mouseY)) {
            item.startEditing();

            const newText = prompt('Ingrese el nuevo texto:', item.text);

            if (newText !== null) {
                item.updateText(newText);
                item.selected = true;
                item.stopEditing();
                drawElements();
            }
        }
    });
});

context.fillStyle = "white";
context.fillRect(0,0, canvas.width, canvas.height);

// Events to elements in DOM

let export_canvas = document.querySelector("#export");

export_canvas.addEventListener("click", () => {
    let imgData = canvas.toDataURL("image/jpeg", 2);
    const createEl = document.createElement("a");
    createEl.href = imgData;

    createEl.download = "Canvas";

    createEl.click();
    createEl.remove();
});