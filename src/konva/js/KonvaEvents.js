import * as States from "./StatesLogic";
import Konva from "konva";
import * as konva from "./KonvaLogic";
import * as GlobalFunctions from "./GlobalFunctions";
import { addShape } from "../ts/CreationShapes";
import { TransformerPoints } from "../ts/utilities/TransformerPoint";

konva.layer.on('dragmove', function (e) {
    if (e.target.id() === 'transformer') {
        return;
    }
    
    konva.layer.find('.guid-line').forEach((l) => l.destroy());

    var lineGuideStops = GlobalFunctions.getLineGuideStops(e.target);
    var itemBounds = GlobalFunctions.getObjectSnappingEdges(e.target);

    var guides = GlobalFunctions.getGuides(lineGuideStops, itemBounds);

    if (!guides.length) {
        return;
    }

    GlobalFunctions.drawGuides(guides);

    var absPos = e.target.absolutePosition();
    guides.forEach((lg) => {
        switch (lg.snap) {
            case 'start': {
                switch (lg.orientation) {
                    case 'V': {
                        absPos.x = lg.lineGuide + lg.offset;
                        break;
                    }
                    case 'H': {
                        absPos.y = lg.lineGuide + lg.offset;
                        break;
                    }
                }
                break;
            }
            case 'center': {
                switch (lg.orientation) {
                    case 'V': {
                        absPos.x = lg.lineGuide + lg.offset;
                        break;
                    }
                    case 'H': {
                        absPos.y = lg.lineGuide + lg.offset;
                        break;
                    }
                }
                break;
            }
            case 'end': {
                switch (lg.orientation) {
                    case 'V': {
                        absPos.x = lg.lineGuide + lg.offset;
                        break;
                    }
                    case 'H': {
                        absPos.y = lg.lineGuide + lg.offset;
                        break;
                    }
                }
                break;
            }
        }
    });
    e.target.absolutePosition(absPos);
});

konva.layer.on('dragend', function (e) {
    if (e.target.id() === 'transformer') {
        return;
    }
    
    konva.layer.find('.guid-line').forEach((l) => l.destroy());
    konva.saveHistory(konva.stage.toJSON());
});

konva.tr.on('transform', function (e) {
    konva.layer.find('.guid-line').forEach((l) => l.destroy());

    var lineGuideStops = GlobalFunctions.getLineGuideStops(e.target);
    var itemBounds = GlobalFunctions.getObjectSnappingEdges(e.target);

    var guides = GlobalFunctions.getGuides(lineGuideStops, itemBounds);

    if (!guides.length) {
        return;
    }

    GlobalFunctions.drawGuides(guides);

    var absPos = e.target.absolutePosition();
    guides.forEach((lg) => {
        switch (lg.snap) {
            case 'start': {
                switch (lg.orientation) {
                    case 'V': {
                        absPos.x = lg.lineGuide + lg.offset;
                        break;
                    }
                    case 'H': {
                        absPos.y = lg.lineGuide + lg.offset;
                        break;
                    }
                }
                break;
            }
            case 'center': {
                switch (lg.orientation) {
                    case 'V': {
                        absPos.x = lg.lineGuide + lg.offset;
                        break;
                    }
                    case 'H': {
                        absPos.y = lg.lineGuide + lg.offset;
                        break;
                    }
                }
                break;
            }
            case 'end': {
                switch (lg.orientation) {
                    case 'V': {
                        absPos.x = lg.lineGuide + lg.offset;
                        break;
                    }
                    case 'H': {
                        absPos.y = lg.lineGuide + lg.offset;
                        break;
                    }
                }
                break;
            }
        }
    });
    e.target.absolutePosition(absPos);
});

konva.tr.on("transformend", function (e) {
    konva.layer.find('.guid-line').forEach((l) => l.destroy());
    konva.saveHistory(konva.stage.toJSON());
});

konva.tr.on("transform", (e) => {
    if (!e.target) {
        return;
    }

    if (e.target instanceof Konva.Text) {
        e.target.setAttrs({
            width: Math.max(5, e.target.width() * e.target.scaleX(), konva.getMinWidth()),
            height: Math.max(5, e.target.height() * e.target.scaleY()),
            scaleX: 1,
            scaleY: 1,
        });
    }

    if(e.target instanceof Konva.Rect){
        if (e.target.parent instanceof Konva.Group) {
            konva.tr.nodes(e.target.parent.getChildren());
        }
    }

    if (e.target == States.StatesCursor.textEditing) {
        var textPosition = e.target.absolutePosition();
        var stageBox = konva.stage.container().getBoundingClientRect();
        var areaPosition = {
            x: stageBox.left + textPosition.x,
            y: stageBox.top + textPosition.y,
        };

        let textarea = document.querySelector("#edit-text");

        textarea.style.top = areaPosition.y + 'px';
        textarea.style.left = areaPosition.x + 'px';
        textarea.style.width = e.target.width() + 'px';
        textarea.style.height = e.target.height() * e.target.scaleY() + 'px';
    }
});

konva.tr.on("transformend", (e) => {
    if (!e.target) {
        return;
    }
});

konva.stage.on('dragmove', () => {
    konva.bg.absolutePosition({ x: 0, y: 0 });

    if(States.StatesCursor.textEditing){
        var textPosition = States.StatesCursor.textEditing.absolutePosition();
        var stageBox = konva.stage.container().getBoundingClientRect();
        var areaPosition = {
          x: stageBox.left + textPosition.x,
          y: stageBox.top + textPosition.y,
        };

        let textarea = document.querySelector("#edit-text")

        textarea.style.top = areaPosition.y + 'px';
        textarea.style.left = areaPosition.x + 'px';
        textarea.style.width = States.StatesCursor.textEditing.width() * States.StatesCursor.textEditing.scaleX() + 'px';
        textarea.style.height = States.StatesCursor.textEditing.height() * States.StatesCursor.textEditing.scaleY() + 'px';
    }
});

konva.stage.on('mousemove', () => {
    if(!States.StatesCursor.addShape || States.StatesShapes.image){
        return;
    }

    konva.tr.setAttr("visible", false);

    konva.getElements().forEach(element => {
        if(element.attrs.name == "preview"){
           element.remove();
        }
    });

    var mousePos = konva.stage.getRelativePointerPosition();
    
    let shapeProperties = {
        x: mousePos.x,
        y: mousePos.y,
        draggable: false,
        listening: false,
        opacity: 0.5,
        name: 'preview'
    };

    let shape = addShape(shapeProperties);

    konva.getElements().push(shape)
    konva.layer.add(shape);
    konva.layer.draw();
});

konva.stage.on('mousedown touchstart', (e) => {
    if (e.target !== konva.stage || e.evt.button != 0) {
        return;
    }

    e.evt.preventDefault();
    konva.setPositions({
        X1: konva.stage.getRelativePointerPosition().x,
        Y1: konva.stage.getRelativePointerPosition().y,
        X2: konva.stage.getRelativePointerPosition().x,
        Y2: konva.stage.getRelativePointerPosition().y
    })

    konva.selectionRectangle.width(0);
    konva.selectionRectangle.height(0);
    konva.selectionRectangle.moveUp();
    konva.setSelecting(true);
});

konva.stage.on('mousemove touchmove', (e) => {
    if (!konva.getSelecting()) {
        return;
    }

    e.evt.preventDefault();
    konva.setPositions({
        X1: konva.getPositions().X1,
        Y1: konva.getPositions().Y1,
        X2: konva.stage.getRelativePointerPosition().x,
        Y2: konva.stage.getRelativePointerPosition().y,
    });

    const { X1, Y1, X2, Y2 } = konva.getPositions();

    konva.selectionRectangle.setAttrs({
        visible: true,
        x: Math.min(X1, X2),
        y: Math.min(Y1, Y2),
        width: Math.abs(X2 - X1),
        height: Math.abs(Y2 - Y1),
    });
});

konva.stage.on('mouseup touchend', (e) => {
    konva.setSelecting(false);
    if (!konva.selectionRectangle.visible()) {
        return;
    }
    e.evt.preventDefault();
    konva.selectionRectangle.visible(false);
    var shapes = konva.stage.find('.shape' || '.text');
    var box = konva.selectionRectangle.getClientRect();
    var selected = shapes.filter((shape) =>
        Konva.Util.haveIntersection(box, shape.getClientRect())
    );
    konva.tr.nodes(selected);
});

konva.stage.on('click tap', function (e) {
    konva.setElements(konva.getElements().filter(item => item.attrs.name != "preview"));
    konva.layer.getChildren().forEach(element => {
        if(element.attrs.name == "preview"){
            element.destroy();
        }
    });

    if (e.target && e.target !== konva.stage) {
        States.StatesCursor.select = e.target;

        if (e.target instanceof Konva.Node){
            const transformer = new TransformerPoints(konva.stage, konva.layer, konva.layerUtilities, {
                arrowColor: 'white',
                borderArrowColor: '#80D0FF',
                anchorColor: 'white',
                borderColor: '#80D0FF',
                anchorSize: 5,
                enabledAnchors: ["left", "right", "top", "bottom"],
                proximityThreshold: 20,
            });

            transformer.attachTo(e.target);
            konva.layer.draw();
        }
    }

    if (States.StatesCursor.addShape && !States.StatesShapes.image) {
        let mousePos = konva.stage.getRelativePointerPosition();

        let shapeProperties = {
            x: mousePos.x,
            y: mousePos.y,
            font_size: 20,
            id_unique: GlobalFunctions.randomId()
        };

        let shape = addShape(shapeProperties);

        if(shape){
            konva.getElements().push(shape);
            konva.layer.add(shape);

            Object.keys(States.StatesShapes).forEach(key => {
                States.StatesShapes[key] = false;
            });

            States.StatesCursor.addShape = false;
            konva.tr.setAttr("visible", true);
            konva.tr.nodes([shape])
            konva.saveHistory(konva.stage.toJSON());

            konva.updateElementsEvent();
        }
    }

    if(States.StatesShapes.image){
        if(!States.StatesValues.image){
            return;
        }

        var image = new Image();
        let mousePos = konva.stage.getRelativePointerPosition();

        let widthDefault = 100;

        let shapeProperties = {
            x: mousePos.x - (widthDefault / 2),
            y: mousePos.y - (widthDefault / 2),
            image: image,
            width: widthDefault,
            height: widthDefault,
            id: "default",
            name: "shape",
            draggable: true,
            imagePath: States.StatesValues.image
        };

        image.onload = function () {
            var image = new Konva.Image({...shapeProperties});
            image.setAttr("_id", image._id);
            konva.getElements().push(image);
            konva.layer.add(image);
            konva.layer.draw();     
        };
        image.src = States.StatesValues.image;

        States.StatesCursor.addShape = false;
        States.StatesShapes.image = false;
        States.StatesValues.image = undefined;
    }

    if (konva.selectionRectangle.visible()) {
        return;
    }

    if (e.target instanceof Konva.Stage == true) {
        konva.tr.nodes([])
        return;
    }

    const parent = e.target.getParent();
    if (parent && parent instanceof Konva.Group) {
        konva.tr.moveToTop();
        konva.tr.nodes(parent.getChildren());
        return;
    }else if (!e.target.hasName("shape") && !e.target.hasName("text") && !e.target.hasName("image")) {
        return;
    }

    const metaPressed = e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey;
    const isSelected = konva.tr.nodes().indexOf(e.target) >= 0;

    if (!metaPressed && !isSelected) {
        konva.tr.moveToTop();
        konva.tr.nodes([e.target]);
    } else if (metaPressed && isSelected) {
        konva.tr.moveUp();
        const nodes = konva.tr.nodes().slice();
        nodes.splice(nodes.indexOf(e.target), 1);
        konva.tr.nodes(nodes);
    } else if (metaPressed && !isSelected) {
        konva.tr.moveUp();
        const nodes = konva.tr.nodes().concat([e.target]);
        konva.tr.nodes(nodes);
    }

});

konva.stage.on('dblclick dbltap', (e) => {
    konva.dbClickElement(e);
});

konva.stage.on('wheel', (e) => {
    e.evt.preventDefault();

    var oldScale = konva.stage.scaleX();
    var pointer = konva.stage.getPointerPosition();

    var mousePointTo = {
        x: (pointer.x - konva.stage.x()) / oldScale,
        y: (pointer.y - konva.stage.y()) / oldScale,
    };

    let direction = e.evt.deltaY > 0 ? 1 : -1;

    if (e.evt.ctrlKey) {
        direction = -direction;
    }

    var newScale = direction > 0 ? oldScale * konva.getScaleBy() : oldScale / konva.getScaleBy();

    if(newScale > 8 || newScale < .3){
        return;
    }

    konva.stage.scale({ x: newScale, y: newScale });

    var newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
    };
    konva.stage.position(newPos);
    konva.bg.absolutePosition({ x: 0, y: 0 });
    konva.stage.batchDraw();
});

konva.stage.on("mousemove", (e) => {
    if(!konva.getIsDrag()){
        return;
    }

    konva.stage.setAttr("draggable", true)
    konva.stage.startDrag();
});

konva.stage.on("mousedown", (e) => {
    if(e.evt.button == 1){
        konva.stage.setAttr("draggable", false)
        konva.stage.startDrag();
        konva.setIsDrag(false);
    }
});