const canvas = document.getElementById('canvas');
const context = canvas?.getContext('2d');

let elements = [];
let contentCanvas = document.getElementById('content-canvas');

let states = {
    circle: false,
    rectangle: true,
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
    console.log(elements)
    drawElements();
}

function drawElements() {
    context.clearRect(0, 0, canvas.width, canvas.height);

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

    if (selectedElement && selectedElement.isClicked(mouseX, mouseY)) {
        offsetX = mouseX - selectedElement.x;
        offsetY = mouseY - selectedElement.y;
        states_pointer.move = true;
        states_pointer.select = false;  
    } else if (selectedElement && selectedElement.isInHandle(mouseX, mouseY)) {
        selectedElement.startResize(mouseX, mouseY);
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
        this.handleSize = 7;
        this.padding = 11;
        this.rotation = 0;
        this.rotationHandleRadius = 24;
        this.resizeStartX = 0;
        this.resizeStartY = 0;
        this.resizing = false;
        this.handleIndex = -1;
    }

    draw(context) {
        context.save();

        // Aplicar la transformación de rotación al contexto
        context.translate(this.x, this.y);
        context.rotate(this.rotation);
        context.translate(-this.x, -this.y);

        // Dibujar el círculo
        context.beginPath();
        context.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.fill();

        if (this.stroke) {
            context.strokeStyle = this.strokeColor;
            context.lineWidth = this.strokeWidth;
            context.stroke();
        }

        context.restore();

        if (this.selected) {
            this.drawBoundingBox(context);
            this.drawHandles(context);
            this.drawRotationHandle(context);
        }
    }

    isClicked(mouseX, mouseY) {
        const distance = Math.sqrt((mouseX - this.x) ** 2 + (mouseY - this.y) ** 2);
        return distance <= this.r;
    }

    drawBoundingBox(context) {
        const topLeftX = this.x - this.r - this.padding;
        const topLeftY = this.y - this.r - this.padding;
        const boxWidth = (this.r + this.padding) * 2;
        const boxHeight = (this.r + this.padding) * 2;

        context.strokeStyle = "red";
        context.lineWidth = 2;
        context.strokeRect(topLeftX, topLeftY, boxWidth, boxHeight);
    }

    drawHandles(context) {
        const handles = this.getHandlePositions();

        handles.forEach(handle => {
            const [x, y] = handle;
            this.drawHandle(context, x, y);
        });
    }

    getHandlePositions() {
        return [
            [this.x - this.r - this.padding, this.y], // Izquierda
            [this.x + this.r + this.padding, this.y], // Derecha
            [this.x, this.y - this.r - this.padding], // Arriba
            [this.x, this.y + this.r + this.padding]  // Abajo
        ];
    }

    drawHandle(context, x, y) {
        context.fillStyle = "white";
        context.fillRect(x - this.handleSize, y - this.handleSize, this.handleSize * 2, this.handleSize * 2);
        context.strokeStyle = "red";
        context.strokeRect(x - this.handleSize, y - this.handleSize, this.handleSize * 2, this.handleSize * 2);
    }

    isInHandle(mouseX, mouseY) {
        const handles = this.getHandlePositions();

        for (let i = 0; i < handles.length; i++) {
            const [handleX, handleY] = handles[i];
            const distance = Math.sqrt((mouseX - handleX) ** 2 + (mouseY - handleY) ** 2);
            if (distance <= this.handleSize) {
                this.handleIndex = i;
                return true;
            }
        }

        return false;
    }

    startResize(mouseX, mouseY) {
        this.resizeStartX = mouseX;
        this.resizeStartY = mouseY;
        this.resizing = true;
    }

    resizeTo(mouseX, mouseY) {
        const dx = mouseX - this.resizeStartX;
        const dy = mouseY - this.resizeStartY;
        let newR = this.r;

        switch (this.handleIndex) {
            case 0: // Izquierda
                newR = Math.max(5, this.r - dx);
                break;
            case 1: // Derecha
                newR = this.r + dx;
                break;
            case 2: // Arriba
                newR = Math.max(5, this.r - dy);
                break;
            case 3: // Abajo
                newR = this.r + dy;
                break;
            default:
                break;
        }

        this.r = Math.max(5, newR);
        this.resizeStartX = mouseX;
        this.resizeStartY = mouseY;
    }

    finishResize() {
        this.resizing = false;
        this.handleIndex = -1;
    }

    isResizing() {
        return this.resizing;
    }

    drawRotationHandle(context) {
        const handleX = this.x;
        const handleY = this.y - this.r - this.padding - this.rotationHandleRadius;

        context.beginPath();
        context.arc(handleX, handleY, this.handleSize, 0, Math.PI * 2);
        context.fillStyle = "blue";
        context.fill();
        context.closePath();
    }

    isInRotationHandle(mouseX, mouseY) {
        const handleX = this.x;
        const handleY = this.y - this.r - this.padding - this.rotationHandleRadius;
        const distance = Math.sqrt((mouseX - handleX) ** 2 + (mouseY - handleY) ** 2);
        return distance <= this.handleSize;
    }

    updateRotation(mouseX, mouseY) {
        const dx = mouseX - this.x;
        const dy = mouseY - this.y;
        this.rotation = Math.atan2(dy, dx);
    }
}

class Rectangle {
    constructor(properties) {
        this.type = 'rectangle';
        this.width = properties.width || 80;
        this.x = properties.x - this.width / 2;
        this.y = properties.y - this.width / 2;
        this.height = properties.height || 60;
        this.color = properties.color || 'black';
        this.stroke = properties.stroke || false;
        this.strokeWidth = properties.strokeWidth || 2;
        this.strokeColor = properties.strokeColor || 'blue';
        this.selected = false;
        this.handleSize = 7;
        this.padding = 11;
        this.rotation = 0;
        this.rotationHandleRadius = 24;
        this.resizeStartX = 0;
        this.resizeStartY = 0;
        this.resizing = false;
        this.handleIndex = -1;
    }

    draw(context) {
        context.save();
    
        // Aplicar la transformación de rotación al contexto
        context.translate(this.x + this.width / 2, this.y + this.height / 2);
        context.rotate(this.rotation);
        context.translate(-(this.x + this.width / 2), -(this.y + this.height / 2));
    
        // Dibujar el rectángulo con el relleno
        context.beginPath();
        context.rect(this.x, this.y, this.width, this.height);
        context.fillStyle = this.color;
        context.fill();
    
        // Dibujar el contorno
        if (this.stroke) {
            context.strokeStyle = this.strokeColor;
            context.lineWidth = this.strokeWidth;
            context.strokeRect(this.x, this.y, this.width, this.height);
        }
    
        context.restore(); // Restaurar el contexto original
    
        // Dibujar los elementos seleccionados si corresponde
        if (this.selected) {
            this.drawBoundingBox(context);
            this.drawHandles(context);
            this.drawRotationHandle(context);
        }
    }
    

    isClicked(mouseX, mouseY) {
        return (
            mouseX >= this.x &&
            mouseX <= this.x + this.width &&
            mouseY >= this.y &&
            mouseY <= this.y + this.height
        );
    }

    drawBoundingBox(context) {
        const topLeftX = this.x - this.padding;
        const topLeftY = this.y - this.padding;
        const boxWidth = this.width + 2 * this.padding;
        const boxHeight = this.height + 2 * this.padding;

        context.strokeStyle = "red";
        context.lineWidth = 2;
        context.strokeRect(topLeftX, topLeftY, boxWidth, boxHeight);
    }

    drawHandles(context) {
        const handles = this.getHandlePositions();

        handles.forEach(handle => {
            const [x, y] = handle;
            this.drawHandle(context, x, y);
        });
    }

    getHandlePositions() {
        return [
            [this.x - this.padding, this.y - this.padding], // Arriba-Izquierda
            [this.x + this.width + this.padding, this.y - this.padding], // Arriba-Derecha
            [this.x + this.width + this.padding, this.y + this.height + this.padding], // Abajo-Derecha
            [this.x - this.padding, this.y + this.height + this.padding]  // Abajo-Izquierda
        ];
    }

    drawHandle(context, x, y) {
        context.fillStyle = "white";
        context.fillRect(x - this.handleSize, y - this.handleSize, this.handleSize * 2, this.handleSize * 2);
        context.strokeStyle = "red";
        context.strokeRect(x - this.handleSize, y - this.handleSize, this.handleSize * 2, this.handleSize * 2);
    }

    isInHandle(mouseX, mouseY) {
        const handles = this.getHandlePositions();

        for (let i = 0; i < handles.length; i++) {
            const [handleX, handleY] = handles[i];
            const distance = Math.sqrt((mouseX - handleX) ** 2 + (mouseY - handleY) ** 2);
            if (distance <= this.handleSize) {
                this.handleIndex = i;
                return true;
            }
        }

        return false;
    }

    startResize(mouseX, mouseY) {
        this.resizeStartX = mouseX;
        this.resizeStartY = mouseY;
        this.resizing = true;
    }

    resizeTo(mouseX, mouseY) {
        let newWidth = this.width;
        let newHeight = this.height;

        switch (this.handleIndex) {
            case 0: // Arriba-Izquierda
                newWidth -= mouseX - this.x;
                newHeight -= mouseY - this.y;
                this.x = mouseX;
                this.y = mouseY;
                break;
            case 1: // Arriba-Derecha
                newWidth = mouseX - this.x;
                newHeight -= mouseY - this.y;
                this.y = mouseY;
                break;
            case 2: // Abajo-Derecha
                newWidth = mouseX - this.x;
                newHeight = mouseY - this.y;
                break;
            case 3: // Abajo-Izquierda
                newWidth -= mouseX - this.x;
                newHeight = mouseY - this.y;
                this.x = mouseX;
                break;
            default:
                break;
        }

        this.width = Math.max(5, newWidth);
        this.height = Math.max(5, newHeight);
    }

    finishResize() {
        this.resizing = false;
        this.handleIndex = -1;
    }

    isResizing() {
        return this.resizing;
    }

    drawRotationHandle(context) {
        const handleX = this.x + this.width / 2;
        const handleY = this.y - this.padding - this.rotationHandleRadius;

        context.beginPath();
        context.arc(handleX, handleY, this.handleSize, 0, Math.PI * 2);
        context.fillStyle = "blue";
        context.fill();
        context.closePath();
    }

    isInRotationHandle(mouseX, mouseY) {
        const handleX = this.x + this.width / 2;
        const handleY = this.y - this.padding - this.rotationHandleRadius;
        const distance = Math.sqrt((mouseX - handleX) ** 2 + (mouseY - handleY) ** 2);
        return distance <= this.handleSize;
    }

    updateRotation(mouseX, mouseY) {
        const dx = mouseX - (this.x + this.width / 2);
        const dy = mouseY - (this.y - this.padding - this.rotationHandleRadius);
        this.rotation = Math.atan2(dy, dx);
    }
}