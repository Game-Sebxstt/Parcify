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

export {Rectangle}