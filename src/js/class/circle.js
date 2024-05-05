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
            [this.x - this.r - this.padding - this.handleSize, this.y], // Izquierda
            [this.x + this.r + this.padding + this.handleSize, this.y], // Derecha
            [this.x, this.y - this.r - this.padding - this.handleSize], // Arriba
            [this.x, this.y + this.r + this.padding + this.handleSize]  // Abajo
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
        this.selected = true;
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

export {Circle}