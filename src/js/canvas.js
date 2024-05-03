const canvas = document.getElementById('canvas');
const context = canvas?.getContext('2d');

function init(){
    if(!canvas){
        return;
    }

    let contentCanvas = document.getElementById('content-canvas');

    canvas.width = contentCanvas.offsetWidth;
    canvas.height = contentCanvas.offsetHeight;

    window.addEventListener("resize", () => {
        contentCanvas = document.getElementById('content-canvas');
        canvas.width = contentCanvas.offsetWidth;
        canvas.height = contentCanvas.offsetHeight;
    });

    let isPencil = false;

    function draw(){
        drawCircle(window.innerWidth/2 - 50, window.innerHeight/2 - 50, 50);
    }

    function drawCircle(x,y,r){
        context.fillStyle = "#6ab150";
        context.lineWidth = 5;
        context.arc(x,y,r,0,2*Math.PI);
        context.fill();
    }

    draw();
}

init();