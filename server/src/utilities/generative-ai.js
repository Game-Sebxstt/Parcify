
export function normalizeShape(shape, existingShapes) {
    if (shape.action === 'edit' || shape.action === 'delete') {
        return shape
    }

    const defaultSize = { width: 100, height: 100 };
    let normalizedShape = {
        action: 'add',
        shape: shape.shape || 'circle',
        fill: shape.fill || "#000000",
        x: shape.x !== undefined ? Math.round(shape.x) : 400,
        y: shape.y !== undefined ? Math.round(shape.y) : 300,
        size: shape.size || defaultSize,
        rotation: shape.rotation || 0,
    };

    normalizedShape.size = {
        width: Math.round(normalizedShape.size.width) || defaultSize.width,
        height: Math.round(normalizedShape.size.height) || defaultSize.height,
    };

    if (normalizedShape.shape === 'circle') {
        const diameter = Math.max(normalizedShape.size.width, normalizedShape.size.height);
        normalizedShape.size = { width: diameter, height: diameter };
    }

    if (normalizedShape.shape === 'text') {
        normalizedShape.text = shape.text || 'Texto de ejemplo';
        normalizedShape.fontSize = shape.fontSize || 20;
        normalizedShape.fontFamily = shape.fontFamily || 'Arial';
    }

    return normalizedShape;
}

export function validateShapeInput(shape) {
    let newShape = shape;
    if (typeof shape.x != 'number' || typeof shape.y != 'number') {
    }
    
    return newShape;
}