import { drawText } from "../../ts/index";

class Text {
    constructor(properties) {
        this.type = 'text';
        this.text = properties.text || 'Hello World';
        this.x = properties.x || 0;
        this.y = properties.y || 0;
        this.width = properties.width || 80;
        this.height = properties.height || 80;
        this.align = properties.align || "left";
        this.alignV = properties.alignV || "top";
        this.color = properties.color || 'blue';
        this.fontFamily = properties.fontFamily || "Arial";
        this.fontSize = properties.fontSize || 18;
        this.fontStyle = properties.fontStyle || '';
        this.fontWeight = properties.fontWeight || '';
        this.justify = properties.justify || false;
        this.selected = false;
        this.handleSize = 7;
        this.padding = 11;
        this.rotation = 0;
        this.rotationHandleRadius = 24;
        this.resizeStartX = 0;
        this.resizeStartY = 0;
        this.resizing = false;
        this.handleIndex = -1;
        this.editing = false;
    }

    draw(context) {
        context.save();
        drawText(context, this.text, {
            x: this.x - (this.width / 2),
            y: this.y - (this.height / 2),
            width: this.width,
            height: this.height,
            align: this.align,
            vAlign: this.alignV,
            font: this.fontFamily,
            fontSize: this.fontSize,
            fontStyle: this.fontStyle,
            fontWeight: this.fontWeight,
            justify: this.justify,
            color: this.color
        });

        if (this.selected && !this.editing) {
            this.drawBoundingBox(context);
            this.drawHandles(context);
            this.drawRotationHandle(context);
        }

        context.restore();
    }

    isClicked(mouseX, mouseY) {
        const bounds = this.getBounds();
        return (
            mouseX >= bounds.left &&
            mouseX <= bounds.right &&
            mouseY >= bounds.top &&
            mouseY <= bounds.bottom
        );
    }

    getBounds() {
        return {
            left: this.x - (this.width / 2) - this.padding,
            right: this.x + (this.width / 2) + this.padding,
            top: this.y - (this.height / 2) - this.padding,
            bottom: this.y + (this.height / 2) + this.padding
        };
    }

    drawBoundingBox(context) {
        const bounds = this.getBounds();

        context.strokeStyle = "red";
        context.lineWidth = 2;
        context.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
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
            [this.x - (this.width / 2) - this.padding - this.handleSize, this.y], // Izquierda
            [this.x + (this.width / 2) + this.padding + this.handleSize, this.y], // Derecha
            [this.x, this.y - (this.height / 2) - this.padding - this.handleSize], // Arriba
            [this.x, this.y + (this.height / 2) + this.padding + this.handleSize]  // Abajo
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
        let newWidth = this.width;
        let newHeight = this.height;

        switch (this.handleIndex) {
            case 0: // Izquierda
                newWidth -= dx;
                this.x += dx / 2;
                break;
            case 1: // Derecha
                newWidth += dx;
                this.x += dx / 2;
                break;
            case 2: // Arriba
                newHeight -= dy;
                this.y += dy / 2;
                break;
            case 3: // Abajo
                newHeight += dy;
                this.y += dy / 2;
                break;
            default:
                break;
        }

        this.width = Math.max(5, newWidth);
        this.height = Math.max(5, newHeight);
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
        const handleY = this.y - (this.height / 2) - this.padding - this.rotationHandleRadius;

        context.beginPath();
        context.arc(handleX, handleY, this.handleSize, 0, Math.PI * 2);
        context.fillStyle = "blue";
        context.fill();
        context.closePath();
    }

    isInRotationHandle(mouseX, mouseY) {
        const handleX = this.x;
        const handleY = this.y - (this.height / 2) - this.padding - this.rotationHandleRadius;
        const distance = Math.sqrt((mouseX - handleX) ** 2 + (mouseY - handleY) ** 2);
        return distance <= this.handleSize;
    }

    updateRotation(mouseX, mouseY) {
        const dx = mouseX - this.x;
        const dy = mouseY - this.y;
        this.rotation = Math.atan2(dy, dx);
    }

    // Método para iniciar la edición de texto
    startEditing() {
        this.editing = true;
    }

    // Método para detener la edición de texto
    stopEditing() {
        this.editing = false;
    }

    // Método para actualizar el texto mientras se edita
    updateText(newText) {
        if (this.editing) {
            this.text = newText;
        }
    }
}

export { Text };
