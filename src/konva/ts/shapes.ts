import Konva from 'konva'
import * as States from "../js/states";

interface ShapeProperties{
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    pointerLength: number,
    pointerWidth: number,
    sides: number,
    points: number[],
    fill: string,
    stroke: string,
    strokeWidth: number,
    cornerRadius: number,
    isVisible: boolean,
    draggable: boolean,
    id: string,
    name: string,
    text: string,
    align: string,
}

let defaultConfig: ShapeProperties = {
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    radius: 30,
    pointerLength: 10,
    pointerWidth: 10,
    sides: 3,
    points: [0,0, 0, -100],
    fill: "black",
    stroke: "black",
    strokeWidth: 2,
    cornerRadius: 3,
    isVisible: true,
    draggable: true,
    id: "default",
    name: "shape",
    text: "Esto es un texto por defecto",
    align: "left",
}

function addShape(shapeProperties: ShapeProperties){
    if(States.StatesShapes.circle){
        return new Konva.Circle({...defaultConfig, ...shapeProperties});
    }else if(States.StatesShapes.rectangle){
        return new Konva.Rect({...defaultConfig, ...shapeProperties})
    }else if(States.StatesShapes.triangle){
        shapeProperties.sides = 3;
        return new Konva.RegularPolygon({...defaultConfig, ...shapeProperties});
    }else if(States.StatesShapes.diamond){
        shapeProperties.sides = 4;
        return new Konva.RegularPolygon({...defaultConfig, ...shapeProperties});
    }else if(States.StatesShapes.arrow){
        return new Konva.Arrow({...defaultConfig, ...shapeProperties});
    }else if(States.StatesShapes.text){
        defaultConfig.name = "text";
        return new Konva.Text({...defaultConfig, ...shapeProperties});
    }

    return false;
}

export {addShape}