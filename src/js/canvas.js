const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight * 0.9;

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.9;
});

let isPencil = true;
let isForm = false;

let currentTool = 'square';
let shapes = [];

const squareBtn = document.getElementById('square-btn');
const rectangleBtn = document.getElementById('rectangle-btn');
const circleBtn = document.getElementById('circle-btn');
const pencilBtn = document.getElementById('pencil-btn');

function draw() {
        trazos.forEach(trazo => {
            context.beginPath();
            context.moveTo((trazo.inicialX - originx) * scale, (trazo.inicialY - originy) * scale);
            context.lineWidth = trazo.grosor * scale;
            context.strokeStyle = trazo.color;
            context.lineCap = "round";
            context.lineJoin = "round";
            context.lineTo((trazo.finalX - originx) * scale, (trazo.finalY - originy) * scale);
            context.stroke();
        });

        shapes.forEach(shape => {
            switch (shape.type) {
                case 'square':
                    drawSquare(shape.x, shape.y);
                    break;
                case 'rectangle':
                    drawRectangle(shape.x, shape.y);
                    break;
                case 'circle':
                    drawCircle(shape.x, shape.y);
                    break;
                default:
                    break;
            }
        });
}

setInterval(draw, 10);

let scale = 1;
let originx = 0;
let originy = 0;
let ctrlPressed = false;

let trazos = []; 

let initialX;
let initialY;
let correccionX = 0;
let correccionY = 0;

let posicion = canvas.getBoundingClientRect();
correccionX = posicion.x;
correccionY = posicion.y;

const dibujar = (cursorX, cursorY) => {
    context.beginPath();
    context.moveTo((initialX - originx) * scale, (initialY - originy) * scale);
    context.lineWidth = 5 * scale;
    context.strokeStyle = "#000";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineTo((cursorX - originx) * scale, (cursorY - originy) * scale);
    context.stroke();

    trazos.push({
        inicialX: initialX,
        inicialY: initialY,
        finalX: cursorX,
        finalY: cursorY,
        grosor: 5,
        color: "#000"
    });

    initialX = cursorX;
    initialY = cursorY;
};

const drawShapes = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    draw();
};

const drawPreview = (x, y) => {
    drawShapes();

    switch (currentTool) {
        case 'square':
            drawSquare(x, y, true);
            break;
        case 'rectangle':
            drawRectangle(x, y, true);
            break;
        case 'circle':
            drawCircle(x, y, true);
            break;
        default:
            break;
    }
};

const drawShape = (x, y) => {
    switch (currentTool) {
        case 'square':
            drawSquare(x, y);
            break;
        case 'rectangle':
            drawRectangle(x, y);
            break;
        case 'circle':
            drawCircle(x, y);
            break;
        default:
            break;
    }

    shapes.push({ x, y, type: currentTool });
};

squareBtn.addEventListener('click', () => {
    currentTool = 'square';
    isForm = true;
    isPencil = false;
    canvas.addEventListener('mousemove', mouseMoving);
});

rectangleBtn.addEventListener('click', () => {
    currentTool = 'rectangle';
    isForm = true;
    isPencil = false;
    canvas.addEventListener('mousemove', mouseMoving);
});

circleBtn.addEventListener('click', () => {
    currentTool = 'circle';
    isForm = true;
    isPencil = false;
    canvas.addEventListener('mousemove', mouseMoving);
});

pencilBtn.addEventListener('click', () => {
    isForm = false;
    isPencil = true;
});

const mouseMoving = (evt) => {
    evt.preventDefault();
    if(isPencil){
        if (evt.changedTouches === undefined) {
            dibujar(evt.offsetX, evt.offsetY);
        } else {
            dibujar(evt.changedTouches[0].pageX - correccionX, evt.changedTouches[0].pageY - correccionY);
        }
    }else{
        const x = evt.clientX - canvas.getBoundingClientRect().left;
        const y = evt.clientY - canvas.getBoundingClientRect().top;
    
        drawPreview(x, y);
    }
};

const mouseUp = (evt) => {
    if(isPencil){
        canvas.removeEventListener("mousemove", mouseMoving);
        canvas.removeEventListener("touchmove", mouseMoving);
    }

    evt.preventDefault();
    if (!isForm) return;

    const x = evt.clientX - canvas.getBoundingClientRect().left;
    const y = evt.clientY - canvas.getBoundingClientRect().top;

    drawShape(x, y);
    canvas.removeEventListener('mousemove', mouseMoving);
    isForm = false;
};

const mouseDown = (evt) => {
    evt.preventDefault();
    if(isPencil){
        if (evt.changedTouches === undefined) {
            initialX = evt.offsetX;
            initialY = evt.offsetY;
        } else {
            initialX = evt.changedTouches[0].pageX - correccionX;
            initialY = evt.changedTouches[0].pageY - correccionY;
        }
        dibujar(initialX, initialY);
        canvas.addEventListener("mousemove", mouseMoving);
        canvas.addEventListener('touchmove', mouseMoving);
    }
};

canvas.addEventListener("mouseup", mouseUp);

function drawSquare(x, y, preview = false) {
    const size = 50;
    if (preview) {
        context.strokeStyle = 'red';
        context.strokeRect(x - size / 2, y - size / 2, size, size);
    } else {
        context.fillStyle = 'red';
        context.fillRect(x - size / 2, y - size / 2, size, size);
    }
}

function drawRectangle(x, y, preview = false) {
    const width = 100;
    const height = 50;
    if (preview) {
        context.strokeStyle = 'blue';
        context.strokeRect(x - width / 2, y - height / 2, width, height);
    } else {
        context.fillStyle = 'blue';
        context.fillRect(x - width / 2, y - height / 2, width, height);
    }
}

function drawCircle(x, y, preview = false) {
    const radius = 30;
    if (preview) {
        context.strokeStyle = 'green';
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.stroke();
    } else {
        context.fillStyle = 'green';
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
    }
}

let selectedSquare = null;

canvas.addEventListener('mousedown', (evt) => {
    const x = evt.clientX - canvas.getBoundingClientRect().left;
    const y = evt.clientY - canvas.getBoundingClientRect().top;

    shapes.forEach(shape => {
        if (x >= shape.x - 25 && x <= shape.x + 25 &&
            y >= shape.y - 25 && y <= shape.y + 25) {
            selectedSquare = shape;
        }
    });
});

canvas.addEventListener('mousemove', (evt) => {
    if (selectedSquare) {
        const x = evt.clientX - canvas.getBoundingClientRect().left;
        const y = evt.clientY - canvas.getBoundingClientRect().top;

        const diffX = x - selectedSquare.x;
        const diffY = y - selectedSquare.y;

        selectedSquare.x += diffX;
        selectedSquare.y += diffY;

        drawShapes();
    }
});

canvas.addEventListener('mouseup', () => {
    selectedSquare = null;
});

canvas.addEventListener("mousedown", mouseDown);

canvas.addEventListener("mouseup", mouseUp);
