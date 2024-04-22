const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight * .9;

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * .9;
});

let scale = 1;
let originx = 0;
let originy = 0;
let ctrlPressed = false;

let trazos = []; // Array para almacenar los trazos

function draw() {
    context.fillStyle = "white";
    context.fillRect(originx, originy, canvas.width / scale, canvas.height / scale);
    context.fillStyle = "black";

    // Dibujar trazos guardados
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

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const width = 100;
    const height = 100;
    const cornerRadius = 5;

    context.beginPath();
    context.moveTo(centerX - width / 2 + cornerRadius, centerY - height / 2);
    context.arcTo(centerX + width / 2, centerY - height / 2, centerX + width / 2, centerY + height / 2, cornerRadius);
    context.arcTo(centerX + width / 2, centerY + height / 2, centerX - width / 2, centerY + height / 2, cornerRadius);
    context.arcTo(centerX - width / 2, centerY + height / 2, centerX - width / 2, centerY - height / 2, cornerRadius);
    context.arcTo(centerX - width / 2, centerY - height / 2, centerX + width / 2, centerY - height / 2, cornerRadius);
    context.closePath();
    context.fill();
}

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

    // Almacena el trazo actual
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

const mouseDown = (evt) => {
    evt.preventDefault();
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
};

const mouseMoving = (evt) => {
    evt.preventDefault();
    if (evt.changedTouches === undefined) {
        dibujar(evt.offsetX, evt.offsetY);
    } else {
        dibujar(evt.changedTouches[0].pageX - correccionX, evt.changedTouches[0].pageY - correccionY);
    }
};

const mouseUp = () => {
    canvas.removeEventListener("mousemove", mouseMoving);
    canvas.removeEventListener("touchmove", mouseMoving);
};

canvas.addEventListener("mousedown", mouseDown);
canvas.addEventListener("mouseup", mouseUp);

// Pantallas táctiles
canvas.addEventListener('touchstart', mouseDown);
canvas.addEventListener('touchend', mouseUp);

setInterval(draw, 10);

document.addEventListener('keydown', function (event) {
    if (event.key === 'Control') {
        ctrlPressed = true;
    }
});

document.addEventListener('keyup', function (event) {
    if (event.key === 'Control') {
        ctrlPressed = false;
    }
});

canvas.onmousewheel = function (event) {
    if (!ctrlPressed) {
        return;
    }

    var mousex = event.clientX - canvas.offsetLeft;
    var mousey = event.clientY - canvas.offsetTop;
    var wheel = event.wheelDelta / 200;

    var zoom = Math.pow(1 + Math.abs(wheel) / 4, wheel > 0 ? 1 : -1);

    var maxZoom = 3;
    scale *= zoom;

    if (scale > maxZoom) {
        scale = maxZoom;
    } else {
        context.translate(
            originx,
            originy
        );
        context.scale(zoom, zoom);
        context.translate(
            -(mousex / scale + originx - mousex / (scale * zoom)),
            -(mousey / scale + originy - mousey / (scale * zoom))
        );

        originx = (mousex / scale + originx - mousex / (scale * zoom));
        originy = (mousey / scale + originy - mousey / (scale * zoom));
    }
};

document.addEventListener("keydown", function (e) {
    if (e.ctrlKey &&
        (
            e.keyCode == "61" ||
            e.keyCode == "107" ||
            e.keyCode == "173" ||
            e.keyCode == "109" ||
            e.keyCode == "187" ||
            e.keyCode == "189"
        )
    ) {
        e.preventDefault();
    }
});

document.addEventListener("wheel", function (e) {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, {
    passive: false
});
