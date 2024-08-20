import * as konva from "./KonvaLogic";
import Konva from "konva";
import * as States from "./StatesLogic";

export function downloadURI(uri, name) {
    var link = document.createElement('a');
    link.download = name;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    return true;
}

export function getLineGuideStops(skipShape) {
    var vertical = [0, konva.stage.width() / 2, konva.stage.width()];
    var horizontal = [0, konva.stage.height() / 2, konva.stage.height()];

    konva.stage.find('.shape').forEach((guideItem) => {
        if (guideItem === skipShape) {
            return;
        }
        var box = guideItem.getClientRect();
        vertical.push([box.x, box.x + box.width, box.x + box.width / 2]);
        horizontal.push([box.y, box.y + box.height, box.y + box.height / 2]);
    });
    return {
        vertical: vertical.flat(),
        horizontal: horizontal.flat(),
    };
}

export function getObjectSnappingEdges(node) {
    var box = node.getClientRect();
    var absPos = node.absolutePosition();

    return {
        vertical: [
            {
                guide: Math.round(box.x),
                offset: Math.round(absPos.x - box.x),
                snap: 'start',
            },
            {
                guide: Math.round(box.x + box.width / 2),
                offset: Math.round(absPos.x - box.x - box.width / 2),
                snap: 'center',
            },
            {
                guide: Math.round(box.x + box.width),
                offset: Math.round(absPos.x - box.x - box.width),
                snap: 'end',
            },
        ],
        horizontal: [
            {
                guide: Math.round(box.y),
                offset: Math.round(absPos.y - box.y),
                snap: 'start',
            },
            {
                guide: Math.round(box.y + box.height / 2),
                offset: Math.round(absPos.y - box.y - box.height / 2),
                snap: 'center',
            },
            {
                guide: Math.round(box.y + box.height),
                offset: Math.round(absPos.y - box.y - box.height),
                snap: 'end',
            },
        ],
    };
}

export function getGuides(lineGuideStops, itemBounds) {
    var resultV = [];
    var resultH = [];

    lineGuideStops.vertical.forEach((lineGuide) => {
        itemBounds.vertical.forEach((itemBound) => {
            var diff = Math.abs(lineGuide - itemBound.guide);
            if (diff < konva.getGuideline()) {
                resultV.push({
                    lineGuide: lineGuide,
                    diff: diff,
                    snap: itemBound.snap,
                    offset: itemBound.offset,
                });
            }
        });
    });

    lineGuideStops.horizontal.forEach((lineGuide) => {
        itemBounds.horizontal.forEach((itemBound) => {
            var diff = Math.abs(lineGuide - itemBound.guide);
            if (diff < konva.getGuideline()) {
                resultH.push({
                    lineGuide: lineGuide,
                    diff: diff,
                    snap: itemBound.snap,
                    offset: itemBound.offset,
                });
            }
        });
    });

    var guides = [];

    var minV = resultV.sort((a, b) => a.diff - b.diff)[0];
    var minH = resultH.sort((a, b) => a.diff - b.diff)[0];
    if (minV) {
        guides.push({
            lineGuide: minV.lineGuide,
            offset: minV.offset,
            orientation: 'V',
            snap: minV.snap,
        });
    }
    if (minH) {
        guides.push({
            lineGuide: minH.lineGuide,
            offset: minH.offset,
            orientation: 'H',
            snap: minH.snap,
        });
    }
    return guides;
}

export function drawGuides(guides) {
    guides.forEach((lg) => {
        if (lg.orientation === 'H') {
            var line = new Konva.Line({
                points: [-6000, 0, 6000, 0],
                stroke: 'rgb(0, 161, 255)',
                strokeWidth: 1,
                name: 'guid-line',
                dash: [4, 6],
            });
            konva.layer.add(line);
            line.absolutePosition({
                x: 0,
                y: lg.lineGuide,
            });
        } else if (lg.orientation === 'V') {
            var line = new Konva.Line({
                points: [0, -6000, 0, 6000],
                stroke: 'rgb(0, 161, 255)',
                strokeWidth: 1,
                name: 'guid-line',
                dash: [4, 6],
            });
            konva.layer.add(line);
            line.absolutePosition({
                x: lg.lineGuide,
                y: 0,
            });
        }
    });
}

export function randomId(){
    return Math.random().toString(36).substr(2, 9);
}

export function showBarTool(nodes) {
    const barTool = document.querySelector("#BarTool");
    const stage = konva.stage;
    let target = States.StatesCursor.select;
    let boundingRect;

    if (!target && (!nodes || nodes.length === 0)) return;

    if (nodes && nodes.length > 0) {
        boundingRect = createBoundingRectForNodes(nodes);
        target = boundingRect;
    } else {
        initializeBarTool(target, barTool);
    }

    initializeBarTool(target, barTool);
    setUpEventListeners(target, barTool, stage, nodes);

    function createBoundingRectForNodes(nodes) {
        const boundingRect = new Konva.Rect({
            fill: 'rgba(0, 0, 0, 0)',
            strokeWidth: 1,
            listening: false,
        });

        konva.layer.add(boundingRect);
        updateBoundingRect(boundingRect, nodes);
        konva.layer.draw();

        nodes.forEach(node => {
            node.on("dragmove transform", () => {
                target.setAttr("barToolSelected", true);
                updateBoundingRect(boundingRect, nodes);
                updateBarToolPosition(target, barTool);
            });
        });

        stage.on("dragmove wheel", () => {
            target.setAttr("barToolSelected", true);
            updateBoundingRect(boundingRect, nodes);
            updateBarToolPosition(target, barTool);
        })

        return boundingRect;
    }

    function updateBoundingRect(rect, nodes) {
        let maxX = 0, maxY = 0, minX = Infinity, minY = Infinity;

        nodes.forEach(node => {
            const nodeX = node.x();
            const nodeY = node.y();

            if (nodeX + node.width() > maxX) maxX = nodeX + node.width();
            if (nodeY + node.height() > maxY) maxY = nodeY + node.height();
            if (nodeX < minX) minX = nodeX;
            if (nodeY < minY) minY = nodeY;
        });

        rect.position({ x: minX, y: minY });
        rect.size({ width: maxX - minX, height: maxY - minY });
    }

    function initializeBarTool(target, barTool) {
        target.setAttr("barToolSelected", true);
        barTool.style.display = 'flex';
        updateBarToolPosition(target, barTool);
    }

    function setUpEventListeners(target, barTool, stage, nodes) {
        target.on("dragstart", () => onDragStart(target, barTool));
        target.on("dragmove transform", () => updateBarToolPosition(target, barTool));
        target.on("dragend", () => onDragEnd(target, barTool));
        stage.on("wheel", () => updateBarToolPosition(target, barTool));
        stage.on("dragmove transform", () => updateBarToolPosition(target, barTool));
        stage.on("click tap", (e) => onStageClick(e, target, barTool, nodes));
    }

    function onDragStart(target, barTool) {
        if (!target.getAttr("barToolSelected")) return;
        barTool.style.opacity = 0;
        barTool.style.pointerEvents = "none";
    }

    function onDragEnd(target, barTool) {
        if (!target.getAttr("barToolSelected")) return;
        barTool.style.opacity = 1;
        barTool.style.pointerEvents = "auto";
        updateBarToolPosition(target, barTool);
    }

    function onStageClick(e, target, barTool, nodes) {
        if (e.target !== target) {
            target.setAttr("barToolSelected", false);
            let isNodeElement = false;

            if (nodes && nodes.length > 0 && boundingRect) {
                nodes.forEach(node => {
                    if (node === e.target) {
                        isNodeElement = true;
                    }
                });

                if (!isNodeElement) {
                    boundingRect.destroy();
                    konva.layer.draw();
                } else {
                    barTool.style.opacity = 1;
                    barTool.style.pointerEvents = "auto";
                }
            }

            if (e.target instanceof Konva.Stage) {
                barTool.style.opacity = 0;
                barTool.style.pointerEvents = "none";
            }
        } else {
            updateBarToolPosition(target, barTool);
        }
    }

    function isBarToolInsideTarget(barToolRect, targetX, targetY, targetWidth, targetHeight) {
        const targetRight = targetX + targetWidth;
        const targetBottom = targetY + targetHeight;
    
        const barToolLeft = barToolRect.left;
        const barToolRight = barToolRect.left + barToolRect.width;
        const barToolTop = barToolRect.top;
        const barToolBottom = barToolRect.top + barToolRect.height;
    
        const isInsideHorizontally = (barToolLeft >= targetX) && (barToolRight <= targetRight);
        const isInsideVertically = (barToolTop >= targetY) && (barToolBottom <= targetBottom);
    
        return isInsideHorizontally && isInsideVertically;
    }

    function updateBarToolPosition(target, barTool) {
        if (!target.getAttr("barToolSelected")) return;
    
        const { x, y } = target.absolutePosition();
        const scaleX = target.scaleX() * stage.scaleX();
        const scaleY = target.scaleY() * stage.scaleY();
        const width = target instanceof Konva.Rect ? target.width() * scaleX : target.radius() * scaleX;
        const height = target instanceof Konva.Rect ? target.height() * scaleY : target.radius() * scaleY;
    
        const barToolRect = barTool.getBoundingClientRect();
        const barToolShape = {
            width: parseFloat(window.getComputedStyle(barTool).width) || barToolRect.width || 0,
            height: parseFloat(window.getComputedStyle(barTool).height) || barToolRect.height || 0,
            originalWidth: konva.getWidthBarTool(),
            originalHeight: konva.getHeightBarTool(),
            scaleX: stage.scaleX() < 0.5 ? 0.5 : stage.scaleX() > 0.6 ? 0.6 : stage.scaleX(),
            scaleY: stage.scaleY() < 0.4 ? 0.4 : stage.scaleY() > 0.5 ? 0.5 : stage.scaleY(),
            x: barToolRect.left,
            y: barToolRect.top,
        }
        const barToolHalfWidth = barToolRect.width / 2;
        const barToolHalfHeight = barToolRect.height / 2;
    
        let leftTarget , topTarget;
        // console.log("stage", stage.scaleX(), stage.scaleY());
        // console.log("barToolShape", barToolShape.scaleX, barToolShape.scaleY);

        if(target instanceof Konva.Rect){
            topTarget = y - height / 4;
            leftTarget = x - barToolHalfWidth + width / 2;
        }else{
            topTarget = y - barToolHalfHeight - height;
            leftTarget = x - barToolHalfWidth;
        }
    
        const headerHeight = parseFloat(window.getComputedStyle(document.querySelector("#header-konva")).height);
        let adjustedBarToolTop = topTarget <= headerHeight ? (y + height + barToolShape.height) + (height / 3): topTarget;
        let adjustedBarToolLeft = leftTarget <= 0 ? barToolHalfHeight : leftTarget > window.innerWidth - barToolShape.width ? window.innerWidth - barToolShape.width - barToolHalfHeight : leftTarget;

        adjustedBarToolTop = adjustedBarToolTop < headerHeight ? headerHeight + barToolHalfHeight : adjustedBarToolTop > window.innerHeight - barToolShape.height ? window.innerHeight - barToolShape.height * 2: adjustedBarToolTop;

        barTool.style.opacity = 1;
        barTool.style.pointerEvents = "auto";
        barTool.style.top = `${adjustedBarToolTop}px`;
        barTool.style.left = `${adjustedBarToolLeft}px`;
        barTool.style.width = `${barToolShape.originalWidth * barToolShape.scaleX}px`;
        barTool.style.height = `${barToolShape.originalHeight * barToolShape.scaleY}px`;
        barTool.style.border = `${1 * barToolShape.scaleX}px solid rgba(255, 255, 255, .2)`;
        document.querySelector("#font_size").style.fontSize = `${14 * barToolShape.scaleX}px`;
        document.querySelector("#font_family").style.fontSize = `${14 * barToolShape.scaleX}px`;

        const BarToolColor = document.querySelector("#BarToolColor")
        const BarToolColorShape = {
            width: parseFloat(window.getComputedStyle(BarToolColor).width) || BarToolColor.width || 0,
            height: parseFloat(window.getComputedStyle(BarToolColor).height) || BarToolColor.height || 0,
            originalWidth: konva.getWidthBarToolColor(),
            originalHeight: konva.getHeightBarToolColor(),
        }

        console.log("BarToolColorShape", BarToolColorShape);
        console.log("width scale", BarToolColorShape.originalWidth * barToolShape.scaleX);
        console.log("height scale", BarToolColorShape.originalHeight * barToolShape.scaleY);

        if(BarToolColor){
            // BarToolColor.style.width = `${BarToolColorShape.originalWidth * barToolShape.scaleX}px`;
            BarToolColor.style.height = `${BarToolColorShape.originalHeight * barToolShape.scaleY}px`;
            BarToolColor.style.border = `${1 * barToolShape.scaleX}px solid rgba(255, 255, 255, .2)`;
            document.querySelector("#nameBar").querySelector("#name").style.fontSize = `${24 * barToolShape.scaleX}px`;
            // document.querySelector("#nameBar").querySelector("#chevron").style.width = `${24 * barToolShape.scaleX}px`;
            // document.querySelector("#nameBar").querySelector("#chevron").style.height = `${24 * barToolShape.scaleY}px`;
            document.querySelector("#style_color").style.padding = `${8 * barToolShape.scaleX}px`;
            document.querySelector("#style_color").style.gap = `${8 * barToolShape.scaleX} 0 px`;
            BarToolColor.querySelectorAll("#input_color").forEach(child => {
                child.style.width = `${36 * barToolShape.scaleX}px`;
                child.style.height = `${36 * barToolShape.scaleX}px`;
                child.style.borderRadius = `${6 * barToolShape.scaleX}px`;
            })
            console.log(BarToolColor.querySelectorAll("#input_color"));
        }

        document.querySelectorAll(".childBarTool").forEach(child => {
            child.style.padding = `${8 * barToolShape.scaleY}px ${8 * barToolShape.scaleX}px`;
        })
    }
    
}
