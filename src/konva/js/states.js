let StatesShapes = {
    text: false,
    image: false,
    circle: false,
    square: false,
    triangle: false,
    diamond: false,
    line: false,
};

//Guardar los estados del cursor
let StatesCursor = {
    addShape: false,
    select: undefined,
    textEditing: undefined,
}

let StatesValues = {
    image: undefined,
}

export {StatesShapes, StatesCursor, StatesValues}