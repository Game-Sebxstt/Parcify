const canvas = document.getElementById('canvas');
const context = canvas?.getContext('2d');

let elements = [];
let contentCanvas = document.getElementById('content-canvas');

let states = {
    circle: true,
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
    }

    elements.push(newShape);
    drawElements();
}

function drawElements() {
    context.clearRect(0, 0, canvas.width, canvas.height);

    elements.forEach(item => {
        item.draw(context);
    });
}

canvas.addEventListener('click', function(event) {
    var canvasRect = canvas.getBoundingClientRect();
    var mouseX = event.clientX - canvasRect.left;
    var mouseY = event.clientY - canvasRect.top;

    let isSelectItem = false;

    elements.forEach(item => {
        item.selected = false;

        if (item.isClicked(mouseX, mouseY)) {
            elements.forEach(e => e.selected = false);
            item.selected = true;
            selectedElement = item;
            states_pointer.select = false;
            isSelectItem = true;
        }
    });

    if (!isSelectItem) {
        states_pointer.select = true;
    }

    if (states_pointer.select) {
        addShape({ x: mouseX, y: mouseY, size: 60, color: 'purple', stroke: true, strokeWidth: 2, strokeColor: 'yellow' });
    }

    drawElements();
});

canvas.addEventListener('mousedown', function(event) {
    var canvasRect = canvas.getBoundingClientRect();
    var mouseX = event.clientX - canvasRect.left;
    var mouseY = event.clientY - canvasRect.top;

    if (selectedElement && selectedElement.isInHandle(mouseX, mouseY)) {
        selectedElement.startResize(mouseX, mouseY);
    } else if (selectedElement && selectedElement.isClicked(mouseX, mouseY)) {
        offsetX = mouseX - selectedElement.x;
        offsetY = mouseY - selectedElement.y;
        states_pointer.move = true;
    }
});

canvas.addEventListener('mousemove', function(event) {
    var canvasRect = canvas.getBoundingClientRect();
    var mouseX = event.clientX - canvasRect.left;
    var mouseY = event.clientY - canvasRect.top;

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

class Circle {
    constructor(properties) {
        this.type = 'circle';
        this.x = properties.x;
        this.y = properties.y;
        this.r = properties.r || 50;
        this.color = properties.color || 'black';
        this.stroke = properties.stroke || false;
        this.strokeWidth = properties.strokeWidth || 2;
        this.strokeColor = properties.strokeColor || 'blue';
        this.selected = false;
        this.handleSize = 6;
        this.resizeStartX = 0;
        this.resizeStartY = 0;
        this.resizing = false;
    }

    draw(context) {
        context.beginPath();
        context.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.fill();

        if (this.stroke) {
            if (this.selected) {
                this.drawBoundingBox(context);
            } else {
                context.strokeStyle = this.strokeColor;
                context.lineWidth = this.strokeWidth;
                context.stroke();
            }
        }

        context.closePath();
    }

    isClicked(mouseX, mouseY) {
        const distance = Math.sqrt((mouseX - this.x) ** 2 + (mouseY - this.y) ** 2);
        return distance <= this.r;
    }

    drawBoundingBox(context) {
        const topLeftX = this.x - this.r;
        const topLeftY = this.y - this.r;
        const bottomRightX = this.x + this.r;
        const bottomRightY = this.y + this.r;

        context.strokeStyle = "red";
        context.lineWidth = 2;
        context.strokeRect(topLeftX, topLeftY, this.r * 2, this.r * 2);

        this.drawHandle(context, topLeftX, topLeftY);
        this.drawHandle(context, bottomRightX, bottomRightY);
    }

    drawHandle(context, x, y) {
        context.fillStyle = "white";
        context.fillRect(x - this.handleSize, y - this.handleSize, this.handleSize * 2, this.handleSize * 2);
        context.strokeStyle = "red";
        context.strokeRect(x - this.handleSize, y - this.handleSize, this.handleSize * 2, this.handleSize * 2);
    }

    isInHandle(mouseX, mouseY) {
        const topLeftX = this.x - this.r - this.handleSize;
        const topLeftY = this.y - this.r - this.handleSize;
        const bottomRightX = this.x + this.r + this.handleSize;
        const bottomRightY = this.y + this.r + this.handleSize;

        return mouseX >= topLeftX && mouseX <= bottomRightX && mouseY >= topLeftY && mouseY <= bottomRightY;
    }

    startResize(mouseX, mouseY) {
        this.resizeStartX = mouseX;
        this.resizeStartY = mouseY;
        this.resizing = true;
    }

    resizeTo(mouseX, mouseY) {
        const dx = mouseX - this.resizeStartX;
        const dy = mouseY - this.resizeStartY;
        const newR = Math.max(5, this.r + dx);

        this.r = newR;
        this.resizeStartX = mouseX;
        this.resizeStartY = mouseY;
    }

    finishResize() {
        this.resizing = false;
    }

    isResizing() {
        return this.resizing;
    }
}
