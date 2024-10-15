import Konva from 'konva'
import * as States from "../js/StatesLogic";

interface PropertiesGeneral{
    id: string,
    name: string,
    isVisible: boolean,
    draggable: boolean,
    strokeScaleEnabled: boolean,
}

interface PropertiesNecessary{
    x: number,
    y: number,
    scale: {
        x: number,
        y: number,
    },
    rotation: number,
    fill: string,
    opacity: number,
    stroke: string,
    strokeWidth: number,
}

interface Square{
    type: "rect",
    cornerRadius: number,
    width: number,
    height: number,
    listening: boolean,
    draggable: boolean,
    border: string,
}

interface Circle{
    type: "circle",
    radius: number,
}

interface Triangle{
    type: "triangle" | "diamond",
    sides: number,
    radius: number,
}

interface Line{
    type: "line" | "arrow",
    pointerLength: number,
    pointerWidth: number,
    points: number[],
}

interface Text{
    type: "text",
    text: string,
    fill: string,
    align: string,
    fontStyle: any,
    fontSize: number,
    fontFamily: string,
    verticalAlign: string,
}

let PropertiesGeneral: PropertiesGeneral = {
    id: "default",
    name: "shape",
    isVisible: true,
    draggable: true,
    strokeScaleEnabled: false,
}

let PropertiesNecessary: PropertiesNecessary = {
    x: 0,
    y: 0,
    scale: {
        x: 1,
        y: 1,
    },
    rotation: 0,
    fill: "#dddddd",
    opacity: 1,
    stroke: "#dddddd",
    strokeWidth: 0,
}

let Square: Square = {
    ...PropertiesGeneral,
    ...PropertiesNecessary,
    width: 50,
    height: 50,
    cornerRadius: 0,
    type: "rect",
    listening: true,
    draggable: true,
    border: "none",
}

let Circle: Circle = {
    ...PropertiesGeneral,
    ...PropertiesNecessary,
    radius: 30,
    type: "circle"
}

let Triangle: Triangle = {
    ...PropertiesGeneral,
    ...PropertiesNecessary,
    radius: 30,
    sides: 3,
    type: "triangle"
}

let Diamond: Triangle = {
    ...PropertiesGeneral,
    ...PropertiesNecessary,
    radius: 30,
    sides: 4,
    type: "diamond"
}

let Line: Line = {
    ...PropertiesGeneral,
    ...PropertiesNecessary,
    pointerLength: 10,
    pointerWidth: 10,
    points: [0,0, 0, -100],
    type: "line"
}

let Text: Text = {
    ...PropertiesGeneral,
    ...PropertiesNecessary,
    text: "Escribe un texto.",
    align: "left",
    fill: "rgb(255,255,255)",
    fontStyle: "normal",
    fontFamily: 'Arial',
    verticalAlign: "top",
    fontSize: 12,
    type: "text"
}


function addShape(shapeProperties: PropertiesNecessary, shapeType: string){
    if(States.StatesShapes.circle || shapeType === "circle"){
        return new Konva.Circle({...Circle, ...shapeProperties});
    }else if(States.StatesShapes.square || shapeType === "square" || shapeType === "rectangle"){
        shapeProperties.x -= 25;
        shapeProperties.y -= 25;
        return new Konva.Rect({...Square, ...shapeProperties})
    }else if(States.StatesShapes.triangle || shapeType === "triangle"){
        return new Konva.RegularPolygon({...Triangle, ...shapeProperties});
    }else if(States.StatesShapes.diamond || shapeType === "diamond"){
        return new Konva.RegularPolygon({...Diamond, ...shapeProperties});
    }else if(States.StatesShapes.line || shapeType === "line"){
        PropertiesNecessary.strokeWidth = 1;
        return new Konva.Arrow({...Line, ...shapeProperties});
    }else if(States.StatesShapes.text || shapeType === "text"){
        return new Konva.Text({...Text, ...shapeProperties});
    }

    return false;
}

export {addShape}